## encodeState

```go
const startDetectingCyclesAfter = 1000
type encodeState struct {
	bytes.Buffer // accumulated output

	// Keep track of what pointers we've seen in the current recursive call
	// path, to avoid cycles that could lead to a stack overflow. Only do
	// the relatively expensive map operations if ptrLevel is larger than
	// startDetectingCyclesAfter, so that we skip the work if we're within a
	// reasonable amount of nested pointers deep.
	ptrLevel uint
	ptrSeen  map[any]struct{}
}

type Buffer struct {
    buf      []byte // contents are the bytes buf[off : len(buf)]
    off      int    // read at &buf[off], write at &buf[len(buf)]
    lastRead readOp // last read operation, so that Unread* can work correctly.
  
    // Copying and modifying a non-zero Buffer is prone to error,
    // but we cannot employ the noCopy trick used by WaitGroup and Mutex,
    // which causes vet's copylocks checker to report misuse, as vet
    // cannot reliably distinguish the zero and non-zero cases.
    // See #26462, #25907, #47276, #48398 for history.
}
```

1. 有个匿名嵌套字段，存储最终 JSON 字节流的物理容器
2. `ptrSeen` 用来模拟 set 数据结构，其中 key 存储的是内存指针，避免循环应用导致死循环
3. `ptrLevel` 是为了减少 map 中对 key 执行的hash、位置计算的操作，如果 ptrLevel 超过 `startDetectingCyclesAfter`后才会用`ptrSeen`判断是否有死循环

## newEncodeState

```go
func newEncodeState() *encodeState {
	if v := encodeStatePool.Get(); v != nil {
		e := v.(*encodeState)
		e.Reset()
		if len(e.ptrSeen) > 0 {
			panic("ptrEncoder.encode should have emptied ptrSeen via defers")
		}
		e.ptrLevel = 0
		return e
	}
	return &encodeState{ptrSeen: make(map[any]struct{})}
}
```

1. 之所以使用 `sync.Pool` 是了避免频繁在堆上开辟空间（`Marshal`中有使用到动态函数，导致对象被移动到堆上）

### 内存逃逸

1. 突破原本的作用域

```go
package main

func escapePointer() *int {
	// 语法：在当前函数的栈帧上声明局部变量 x
	x := 42 
	// 语法：使用 & 符号获取 x 的内存地址，并作为返回值抛出函数外部
	return &x 
}
// 这是因为函数一旦执行完毕，它对应的“栈帧”就会被操作系统立刻回收销毁。如果 x 留在栈上，外部拿到的就是一个指向已销毁内存的“野指针（Dangling Pointer）”。为了保护这个指针的有效性，编译器在编译期就会把 x 的内存强制开辟在堆上
func main() {
	_ = escapePointer()
}
```

2. 分配内存超出64kb

```go
package main

func main() {
	// 1. 刚好 64KB (64 * 1024)
	// 判决：does not escape (留在栈上)
	s1 := make([]byte, 65536)
	s1[0] = 1

	// 2. 突破临界点，多加 1 个字节：64KB + 1 Byte
	// 判决：escapes to heap (逃逸到堆上)
	s2 := make([]byte, 65537)
	s2[0] = 1
}
```

3. 闭包
4. 函数装箱：将具体类型赋值给 `any` / `interface{}`，并将该接口传给外部函数。这是因为接口的底层结构 `eface` 强制使用 `unsafe.Pointer` 存储真实数据，这要求数据必须有独立的内存地址。当包含此指针的接口被传给外部函数时，编译器失去了对该 `unsafe.Pointer` 生命周期的追踪能力（无法预判外部函数会不会把指针存起来）。为了防御潜在的野指针，编译器强制将其背后的数据分配在堆上

```go
package main

import "fmt"

type User struct {
	Name string
}

func escapeBoxing() {
	u := User{Name: "Alice"}

	fmt.Println(u)
}

func main() {
	escapeBoxing()
}
```

5. 动态函数

```go
func escapeByMap() {
	// 语法与操作：局部声明 d1
	d1 := Data{Value: 10}

	// 从 Map 中取出函数。由于 Map 的读取发生在运行期，
	// 编译器无法在编译时知道 f 具体指向哪段代码。
	f := funcRegistry["add"]

	// 致命调用：编译器对 f 的内部行为彻底失明，强制 d1 逃逸！
	f(&d1)
}
```

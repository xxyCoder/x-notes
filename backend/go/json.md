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

## Marshal

```go
func Marshal(v any) ([]byte, error) {
    e := newEncodeState()
    defer encodeStatePool.Put(e)
    
    err := e.marshal(v, encOpts{escapeHTML: true})
    if err != nil {
    return nil, err
    }
    buf := append([]byte(nil), e.Bytes()...)
    
    return buf, nil
}

func (e *encodeState) marshal(v any, opts encOpts) (err error) {
    defer func() {
        if r := recover(); r != nil {
            if je, ok := r.(jsonError); ok {
                err = je.error
            } else {
                panic(r)
            }
        }
    }()
	// reflect.ValueOf(v) 会把空接口 v 拆开，提取出它底层的真实数据和类型指针
	val := reflect.ValueOf(v)
    typeEncoder(val.Type())(e, val, opts)
    return nil
}

func typeEncoder(t reflect.Type) encoderFunc {
    if fi, ok := encoderCache.Load(t); ok {
        return fi.(encoderFunc)
    }
	
    indirect := sync.OnceValue(func() encoderFunc {
        return newTypeEncoder(t, true)
    })
    fi, loaded := encoderCache.LoadOrStore(t, encoderFunc(func(e *encodeState, v reflect.Value, opts encOpts) {
        indirect()(e, v, opts)
	}))
    if loaded {
        return fi.(encoderFunc)
    }
    
    f := indirect()
    encoderCache.Store(t, f)
    return f
}

func newTypeEncoder(t reflect.Type, allowAddr bool) encoderFunc {
    // If we have a non-pointer value whose type implements
    // Marshaler with a value receiver, then we're better off taking
    // the address of the value - otherwise we end up with an
    // allocation as we cast the value to an interface.
    if t.Kind() != reflect.Pointer && allowAddr && reflect.PointerTo(t).Implements(marshalerType) {
        return newCondAddrEncoder(addrMarshalerEncoder, newTypeEncoder(t, false))
    }
    if t.Implements(marshalerType) {
        return marshalerEncoder
    }
    if t.Kind() != reflect.Pointer && allowAddr && reflect.PointerTo(t).Implements(textMarshalerType) {
        return newCondAddrEncoder(addrTextMarshalerEncoder, newTypeEncoder(t, false))
    }
    if t.Implements(textMarshalerType) {
        return textMarshalerEncoder
    }
    
    switch t.Kind() {
        case reflect.Bool:
            return boolEncoder
        case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
            return intEncoder
        case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
            return uintEncoder
        case reflect.Float32:
            return float32Encoder
        case reflect.Float64:
            return float64Encoder
        case reflect.String:
            return stringEncoder
        case reflect.Interface:
            return interfaceEncoder
        case reflect.Struct:
            return newStructEncoder(t)
        case reflect.Map:
            return newMapEncoder(t)
        case reflect.Slice:
            return newSliceEncoder(t)
        case reflect.Array:
            return newArrayEncoder(t)
        case reflect.Pointer:
            return newPtrEncoder(t)
        default:
            return unsupportedTypeEncoder
    }
}

func newStructEncoder(t reflect.Type) encoderFunc {
    se := structEncoder{fields: cachedTypeFields(t)}
    return se.encode
}
```

1. 昂贵反射算出来的全套字段信息，全都存进 se 这个实例里，然后将`se.encode`存储在`map`中从而实现“记忆类型”，后续相同的类型调用`Marshal`方法都可以避免重复序列化

## Unmarshal

```go
func Unmarshal(data []byte, v any) error {
    // 1. 声明工作台
    var d decodeState
    
    // 2. 纯词法扫描（防爆炸）：不分配任何内存，只跑状态机，确保大括号闭合。
    err := checkValid(data, &d.scan)
    if err != nil {
       return err
    }

    // 3. 把字节流 data 喂进工作台
    d.init(data)
    
    // 4. 下发给内部解包函数
    return d.unmarshal(v)
}

func (d *decodeState) unmarshal(v any) error {
    // 1. 获取反射对象（此时 rv 代表整个 &u 指针）
    rv := reflect.ValueOf(v)
    
    // 2. 死亡审判：如果不是指针，或者是个空指针，直接报错。
    // 因为传值会导致修改的全是临时拷贝，外面的 u 根本不会变。
    if rv.Kind() != reflect.Pointer || rv.IsNil() {
    return &InvalidUnmarshalError{reflect.TypeOf(v)}
    }
    
    d.scan.reset()
    d.scanWhile(scanSkipSpace) // 跳过 JSON 开头的空格
    
    // 3. 第一次分发！拿着合法的整体指针 rv，送入中央路由器
    err := d.value(rv)
    // ...
    return d.savedError
}

func (d *decodeState) value(v reflect.Value) error {
    switch d.opcode {
    // ...
    // 扫描器看到了 `{"age": 10}` 的第一个字符 `{`，状态机给出的 opcode 就是 scanBeginObject
    case scanBeginObject:
        if v.IsValid() {
        // 路由器搞不定对象，直接把整个指针 v 传给对象处理器！
        if err := d.object(v); err != nil {
            return err
        }
        } else {
            d.skip()
        }
        d.scanNext()
    // ...
    }
    return nil
}

func (d *decodeState) object(v reflect.Value) error {
    // 1. 剥开指针，拿到 User 真实的反射实体 pv 和 类型 t
    u, ut, pv := indirect(v, false)
    // ...
    v = pv
    t := v.Type()
    
    var fields structFields
    
    // 2. 在看 JSON 键值对之前，先去解析 User 结构体！
    switch v.Kind() {
    // ...
    case reflect.Struct:
    // 极其关键！cachedTypeFields 会算出 Age 字段的内存偏移量，
    // 并生成一个带有快速查找字典的 fields 对象。
    fields = cachedTypeFields(t)
    // ...
}

func cachedTypeFields(t reflect.Type) structFields {
    if f, ok := fieldCache.Load(t); ok {
        return f.(structFields)
    }
    f, _ := fieldCache.LoadOrStore(t, typeFields(t))
    return f.(structFields)
}
```

1. 先通过状态机完成零分配词法扫描，随后利用反射开启递归下降解析；在处理结构体时，预先提取并缓存各字段的物理内存偏移量，进而在循环读取 JSON 键值对时，精准算出目标字段的绝对内存地址，最后调用底层反射接口将字面量直接覆写进该区块

## Encoder

```go
type Encoder struct {
	w          io.Writer
	err        error
	escapeHTML bool

	indentBuf    []byte
	indentPrefix string
	indentValue  string
}

// NewEncoder returns a new encoder that writes to w.
func NewEncoder(w io.Writer) *Encoder {
	return &Encoder{w: w, escapeHTML: true}
}

func (enc *Encoder) Encode(v any) error {
    if enc.err != nil {
        return enc.err
    }

    e := newEncodeState()
    defer encodeStatePool.Put(e)

    err := e.marshal(v, encOpts{escapeHTML: enc.escapeHTML})
    if err != nil {
        return err
    }

    // Terminate each value with a newline.
    // This makes the output look a little nicer
    // when debugging, and some kind of space
    // is required if the encoded value was a number,
    // so that the reader knows there aren't more
    // digits coming.
    e.WriteByte('\n')

    b := e.Bytes()
    if enc.indentPrefix != "" || enc.indentValue != "" {
        enc.indentBuf, err = appendIndent(enc.indentBuf[:0], b, enc.indentPrefix, enc.indentValue)
        if err != nil {
            return err
        }
        b = enc.indentBuf
    }
    if _, err = enc.w.Write(b); err != nil {
        enc.err = err
	}
    return err
}
```

1. 流程和`Marshal`类似，数据流向`w`
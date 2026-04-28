## 1. 泛型是什么

泛型可以理解为：把“类型”也变成参数。

普通函数的参数是值：

```go
func PrintName(name string) {
	fmt.Println(name)
}
```

泛型函数除了接收普通值参数，还可以接收类型参数：

```go
func Print[T any](v T) {
	fmt.Println(v)
}
```

这里的 `T` 就是一个类型占位符。调用函数时，`T` 可以变成 `int`、`string`、`bool`、结构体等具体类型。

泛型解决的核心问题是：

- 写一份逻辑
- 适配多种类型
- 仍然保留静态类型检查

## 2. 最核心的语法

泛型函数的基本格式：

```go
func 函数名[类型参数 约束](普通参数) 返回值 {
	// ...
}
```

例如：

```go
func Echo[T any](v T) T {
	return v
}
```

可以拆开看：

```text
Echo       函数名
[T any]    类型参数列表
T          类型参数名
any        类型约束
v T        普通参数 v，类型是 T
T          返回值类型也是 T
```

一句话记住：

```text
方括号 [] 里面写类型参数。
小括号 () 里面写普通参数。
```

## 3. T 是什么

`T` 不是关键字，只是一个名字。它代表“某个具体类型”。

```go
func Echo[T any](v T) T {
	return v
}
```

调用：

```go
x := Echo(100)
```

此时 Go 会推导出：

```text
T = int
```

所以这次调用可以理解成：

```go
func Echo(v int) int {
	return v
}
```

再调用：

```go
s := Echo("hello")
```

此时：

```text
T = string
```

这次调用又可以理解成：

```go
func Echo(v string) string {
	return v
}
```

所以 `T` 本质上就是一个类型占位符。

类型参数名可以不叫 `T`，也可以叫 `E`、`K`、`V`、`Item` 等：

```go
func First[Item any](items []Item) Item {
	return items[0]
}
```

常见命名习惯：

- `T`：普通类型参数。
- `E`：元素类型，常用于 slice、list。
- `K`：key 类型，常用于 map。
- `V`：value 类型，常用于 map。

## 4. any 是什么

```go
func Echo[T any](v T) T {
	return v
}
```

`any` 表示任意类型。

它其实是 `interface{}` 的别名：

```go
type any = interface{}
```

所以：

```go
[T any]
```

可以读成：

```text
T 可以是任意类型。
```

例如这些都可以：

```go
Echo(1)
Echo("go")
Echo(true)
Echo([]int{1, 2, 3})
```

## 5. 为什么需要约束

不是所有类型都支持同样的操作。

例如下面这个函数不能通过编译：

```go
func Add[T any](a, b T) T {
	return a + b
}
```

原因是 `any` 太宽泛了。`T` 可能是 `int`，也可能是 `bool`、`struct`、`[]int`。

但不是所有类型都能使用 `+`。

例如：

```go
1 + 2           // 可以
"a" + "b"       // 可以
true + false    // 不可以
[]int{} + []int{} // 不可以
```

所以如果函数里要使用某种操作，就要用约束告诉 Go：`T` 只能是支持这些操作的类型。

## 6. 类型集合约束

泛型里的接口可以用来表示类型集合。

```go
type Number interface {
	int | int64 | float64
}
```

这里的意思是：

```text
Number 约束允许 int、int64、float64。
```

然后就可以写：

```go
func Add[T Number](a, b T) T {
	return a + b
}
```

使用：

```go
Add(1, 2)
Add(int64(1), int64(2))
Add(1.2, 3.4)
```

不能使用：

```go
Add(true, false)
```

也可以把约束直接写在函数里：

```go
func Add[T int | int64 | float64](a, b T) T {
	return a + b
}
```

但如果这个约束会被多处复用，建议单独定义成接口：

```go
type Number interface {
	int | int64 | float64
}
```

## 7. comparable 约束

如果类型参数需要使用 `==` 或 `!=`，就要用 `comparable`。

```go
func Equal[T comparable](a, b T) bool {
	return a == b
}
```

可以使用：

```go
Equal(1, 2)
Equal("a", "b")
Equal(true, false)
```

不可以使用：

```go
Equal([]int{1}, []int{1})
```

因为 slice 不能直接用 `==` 比较。

`comparable` 常见于 `map key`、`Set`、去重等场景。

例如：

```go
type Set[T comparable] map[T]struct{}

func (s Set[T]) Add(v T) {
	s[v] = struct{}{}
}

func (s Set[T]) Has(v T) bool {
	_, ok := s[v]
	return ok
}
```

使用：

```go
ids := Set[int]{}
ids.Add(1)

names := Set[string]{}
names.Add("go")
```

## 8. ~ 的作用

`~` 表示“底层类型是某个类型”。

先看一个自定义类型：

```go
type MyInt int
```

`MyInt` 是一个新类型，但它的底层类型是 `int`。

如果约束这样写：

```go
type Integer interface {
	int
}
```

它只接受真正的 `int`，不接受 `MyInt`。

如果约束这样写：

```go
type Integer interface {
	~int
}
```

意思是：

```text
只要底层类型是 int 就可以。
```

示例：

```go
type MyInt int

func Double[T ~int](v T) T {
	return v * 2
}

func main() {
	var x MyInt = 10
	fmt.Println(Double(x))
}
```

可以这样记：

```text
int  只要 int 本身
~int 包括 int，也包括底层类型是 int 的自定义类型
```

## 9. 泛型结构体

普通结构体只能固定字段类型：

```go
type IntBox struct {
	value int
}
```

如果想让盒子既能装 `int`，也能装 `string`，可以写泛型结构体：

```go
type Box[T any] struct {
	value T
}
```

使用：

```go
b1 := Box[int]{value: 123}
b2 := Box[string]{value: "hello"}
```

可以理解为 Go 根据使用场景生成了不同版本：

```go
type BoxInt struct {
	value int
}

type BoxString struct {
	value string
}
```

但代码只需要写一份。

## 10. 泛型方法

如果结构体本身有类型参数，方法接收者也要带上类型参数。

```go
type Stack[T any] struct {
	items []T
}

func (s *Stack[T]) Push(v T) {
	s.items = append(s.items, v)
}

func (s *Stack[T]) Pop() (T, bool) {
	var zero T

	if len(s.items) == 0 {
		return zero, false
	}

	last := s.items[len(s.items)-1]
	s.items = s.items[:len(s.items)-1]
	return last, true
}
```

注意接收者这里：

```go
func (s *Stack[T]) Push(v T)
```

不能写成：

```go
func (s *Stack) Push(v T)
```

因为 `Stack` 本身需要知道它里面装的是什么类型。

使用：

```go
var s Stack[int]

s.Push(1)
s.Push(2)

v, ok := s.Pop()
fmt.Println(v, ok)
```

此时 `T` 就是 `int`。

## 11. 多个类型参数

类型参数可以有多个。

```go
func ToMap[K comparable, V any](items []V, keyFn func(V) K) map[K]V {
	result := make(map[K]V)

	for _, item := range items {
		key := keyFn(item)
		result[key] = item
	}

	return result
}
```

这里：

```text
K comparable 表示 K 可以作为 map 的 key。
V any        表示 V 可以是任意类型。
```

使用：

```go
type User struct {
	ID   int
	Name string
}

users := []User{
	{ID: 1, Name: "Tom"},
	{ID: 2, Name: "Jerry"},
}

userMap := ToMap(users, func(u User) int {
	return u.ID
})
```

此时：

```text
K = int
V = User
```

## 12. 类型推导

调用泛型函数时，很多情况下不需要手动写类型参数。

完整写法：

```go
Echo[int](100)
Echo[string]("hello")
```

通常可以省略：

```go
Echo(100)
Echo("hello")
```

Go 会根据普通参数推导类型参数。

但有些情况下 Go 推导不出来，就需要显式写：

```go
func NewBox[T any]() Box[T] {
	return Box[T]{}
}

b := NewBox[int]()
```

因为 `NewBox()` 没有普通参数，Go 无法从参数里推导 `T` 是什么。

## 13. 泛型和 interface{} 的区别

以前为了接收任意类型，常用 `interface{}`：

```go
func Print(v interface{}) {
	fmt.Println(v)
}
```

问题是：`interface{}` 会丢失具体类型信息，后续经常需要类型断言。

```go
func Get(v interface{}) {
	s, ok := v.(string)
	if !ok {
		return
	}

	fmt.Println(s)
}
```

泛型会保留类型信息：

```go
func Identity[T any](v T) T {
	return v
}
```

调用：

```go
x := Identity(123)   // x 是 int
s := Identity("go")  // s 是 string
```

所以泛型更适合“输入是什么类型，输出还要保持同样类型”的场景。

## 14. 泛型适合的场景

泛型适合写类型安全的通用逻辑，例如：

- `Stack[T]`
- `Queue[T]`
- `Set[T]`
- `Map[K, V]`
- `Cache[K, V]`
- `Option[T]`
- `Result[T]`
- slice 工具函数
- 通用查找、过滤、映射逻辑

例如：

```go
func Filter[T any](items []T, keep func(T) bool) []T {
	result := make([]T, 0, len(items))

	for _, item := range items {
		if keep(item) {
			result = append(result, item)
		}
	}

	return result
}
```

使用：

```go
nums := []int{1, 2, 3, 4}

even := Filter(nums, func(n int) bool {
	return n%2 == 0
})
```

## 15. 什么时候不适合用泛型

泛型不是为了替代接口。

如果你抽象的是“行为”，接口通常更自然：

```go
type Writer interface {
	Write([]byte) (int, error)
}
```

如果你抽象的是“同一份逻辑适配多种类型”，泛型更自然：

```go
func Contains[T comparable](items []T, target T) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}

	return false
}
```

简单判断：

```text
关心对象能做什么：用 interface。
关心数据是什么类型，并且想保留类型：用泛型。
```

## 16. 常用语法速记

任意类型：

```go
func F[T any](v T) {}
```

可比较类型：

```go
func F[T comparable](a, b T) bool {
	return a == b
}
```

指定几个类型：

```go
func F[T int | int64 | float64](v T) T {
	return v
}
```

底层类型匹配：

```go
func F[T ~int](v T) T {
	return v
}
```

泛型结构体：

```go
type Box[T any] struct {
	value T
}
```

泛型 map：

```go
type Map[K comparable, V any] map[K]V
```

泛型方法：

```go
func (b Box[T]) Value() T {
	return b.value
}
```

## 17. 一句话总结

泛型就是：

```text
用 [] 声明类型参数，让一份代码可以安全地适配多种类型。
```

最重要的是先记住这三个：

```go
[T any]        // T 可以是任意类型
[T comparable] // T 可以用 == 和 !=
[T ~int]       // T 的底层类型是 int
```

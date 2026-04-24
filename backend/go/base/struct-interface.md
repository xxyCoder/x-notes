# Go struct / interface 重要知识点

本文整理 Go 中 `struct` 和 `interface` 的常用知识点、底层模型和容易踩坑的地方。

## 1. struct 是什么

`struct` 是 Go 中组织数据的核心方式。

```go
type User struct {
	ID   int
	Name string
	Age  int
}
```

它描述的是一组字段的集合。Go 没有传统面向对象语言里的继承，通常通过：

- `struct` 表示数据
- 方法表示行为
- 组合表示复用
- `interface` 表示抽象

## 2. struct 的底层内存结构

`struct` 在内存中基本是一段连续内存，字段按照声明顺序排列。

```go
type User struct {
	ID   int64
	Name string
	Age  int8
}
```

可以粗略理解为：

```text
User memory:
+------+--------+-----+
| ID   | Name   | Age |
+------+--------+-----+
```

但真实情况还要考虑内存对齐。字段之间可能出现 padding。

例如：

```go
type A struct {
	X int8
	Y int64
	Z int8
}

type B struct {
	Y int64
	X int8
	Z int8
}
```

`A` 和 `B` 字段类型一样，但大小可能不同。因为 `int64` 通常需要 8 字节对齐。

`A` 的内存可能类似：

```text
X padding padding padding padding padding padding padding Y Z padding...
```

`B` 的内存可能更紧凑：

```text
Y X Z padding...
```

所以在大量对象、性能敏感场景下，字段顺序会影响内存占用。

一般建议：

- 大字段放前面，小字段放后面，通常更容易减少 padding。
- 不要为了微小优化牺牲代码可读性。
- 只有结构体数量很大或性能敏感时，才重点关注字段排列。

可以用 `unsafe.Sizeof` 查看大小：

```go
fmt.Println(unsafe.Sizeof(A{}))
fmt.Println(unsafe.Sizeof(B{}))
```

## 3. struct 初始化

推荐使用字段名初始化：

```go
u := User{
	ID:   1,
	Name: "Tom",
	Age:  18,
}
```

不太推荐按顺序初始化：

```go
u := User{1, "Tom", 18}
```

原因是字段顺序一旦变化，代码容易出错。

如果字段没有赋值，会使用零值：

```go
type User struct {
	Name string
	Age  int
}

u := User{Name: "Tom"}

// u.Age == 0
```

## 4. 字段可见性

Go 通过首字母大小写控制可见性。

```go
type User struct {
	Name string // 包外可访问
	age  int    // 仅当前包可访问
}
```

这在写库、SDK、API 返回结构时很常用。

## 5. struct tag

struct tag 常用于 JSON、数据库、表单绑定等。

```go
type User struct {
	ID   int    `json:"id"`
	Name string `json:"name,omitempty"`
}
```

`omitempty` 表示字段为零值时序列化时省略。

常见零值：

- `0`
- `""`
- `false`
- `nil`
- 长度为 0 的 slice、map

注意：tag 本质是字符串，写错了编译器通常不报错。

## 6. struct 组合

Go 没有继承，但可以用组合。

```go
type Address struct {
	City string
}

type User struct {
	Name string
	Address
}
```

这里的 `Address` 是匿名字段，也叫嵌入字段。

底层上，它仍然是 `User` 的一个字段。

```text
User {
	Name
	Address {
		City
	}
}
```

所以：

```go
u.City
```

只是语法糖，等价于：

```go
u.Address.City
```

### 嵌入值和嵌入指针

嵌入值：

```go
type User struct {
	Address
}
```

`Address` 的内容直接嵌在 `User` 的内存中。

嵌入指针：

```go
type User struct {
	*Address
}
```

`User` 里面存的是一个指针，真正的 `Address` 对象在别处。

嵌入指针要注意 nil：

```go
var u User
fmt.Println(u.City) // 如果 u.Address == nil，会 panic
```

## 7. 组合中的字段和方法提升

嵌入字段的字段和方法可以被提升。

```go
type Address struct {
	City string
}

func (a Address) Full() string {
	return a.City
}

type User struct {
	Address
}

func main() {
	u := User{Address: Address{City: "Shanghai"}}

	fmt.Println(u.City)   // 等价于 u.Address.City
	fmt.Println(u.Full()) // 等价于 u.Address.Full()
}
```

注意：提升不是继承。`User` 不是 `Address` 的子类，只是 Go 帮你省略了一层选择器。

## 8. 组合中的冲突规则

组合中查找字段或方法时，可以记住一句话：

> 优先找最近的一层；同一层有多个同名成员就冲突；浅层成员会遮蔽深层成员。

### 同一层字段冲突

```go
type A struct {
	Name string
}

type B struct {
	Name string
}

type User struct {
	A
	B
}
```

这时：

```go
u.Name
```

会编译错误，因为 `A.Name` 和 `B.Name` 在同一层，Go 不知道要选哪个。

必须显式指定：

```go
u.A.Name
u.B.Name
```

### 同一层方法冲突

```go
type A struct{}

func (A) Print() {}

type B struct{}

func (B) Print() {}

type User struct {
	A
	B
}
```

这时：

```go
u.Print()
```

会编译错误。

必须写：

```go
u.A.Print()
u.B.Print()
```

这个冲突还会影响接口实现。

```go
type Printer interface {
	Print()
}

var _ Printer = User{} // 编译不通过
```

因为 `User` 没有一个明确的、可提升的 `Print` 方法。

### 不同层字段冲突

如果不同层次有同名字段，浅层优先。

```go
type A struct {
	Name string
}

type B struct {
	A
	Name string
}

type User struct {
	B
}
```

此时：

```go
u.Name
```

访问的是：

```go
u.B.Name
```

更深层的：

```go
u.B.A.Name
```

被遮蔽了，但仍然可以显式访问。

### 不同层方法冲突

方法也是同样规则。

```go
type A struct{}

func (A) Run() {}

type B struct {
	A
}

func (B) Run() {}

type User struct {
	B
}
```

此时：

```go
u.Run()
```

调用的是：

```go
u.B.Run()
```

而不是：

```go
u.B.A.Run()
```

### 字段和方法同名

字段和方法共用 selector 名字空间。

```go
type A struct{}

func (A) Name() string {
	return "A"
}

type User struct {
	A
	Name string
}
```

此时：

```go
u.Name
```

优先是 `User.Name` 字段。

如果名字冲突导致歧义，就需要显式选择。

## 9. struct 的值接收者和指针接收者

方法可以定义在结构体值或结构体指针上。

```go
type User struct {
	Name string
}

func (u User) DisplayName() string {
	return u.Name
}

func (u *User) Rename(name string) {
	u.Name = name
}
```

值接收者：

- 会复制一份接收者。
- 不能修改原对象。
- 适合小结构体、不可变语义的方法。

指针接收者：

- 不复制整个结构体。
- 可以修改原对象。
- 适合大结构体、需要修改对象、包含锁等不能复制的字段。

常见经验：

- 如果某些方法需要指针接收者，通常这个类型的其他方法也统一用指针接收者。
- 包含 `sync.Mutex`、`sync.Once`、`sync.WaitGroup` 等字段时，通常不要使用值接收者。

## 10. struct 比较

如果结构体的所有字段都可比较，那么结构体也可比较。

```go
type Point struct {
	X int
	Y int
}

p1 := Point{1, 2}
p2 := Point{1, 2}

fmt.Println(p1 == p2) // true
```

如果字段包含 slice、map、func，则结构体不能直接比较。

```go
type User struct {
	Tags []string
}

// User{} == User{} // 编译错误
```

这时可以：

- 自己写比较逻辑
- 使用 `slices.Equal`
- 使用 `maps.Equal`
- 在测试场景中使用 `reflect.DeepEqual` 或第三方断言库

## 11. interface 是什么

`interface` 描述的是行为。

```go
type Reader interface {
	Read(p []byte) (n int, err error)
}
```

只要某个类型实现了接口要求的所有方法，它就自动实现了这个接口，不需要显式声明。

```go
type File struct{}

func (f File) Read(p []byte) (int, error) {
	return 0, nil
}
```

此时 `File` 自动实现 `Reader`。

这是 Go 的隐式接口实现。

## 12. interface 底层结构

接口值不是一个单纯的指针。

它可以粗略理解为两部分：

```text
interface value = 类型信息 + 数据指针
```

### 空接口

空接口 `interface{}`，Go 1.18 以后也可以写成 `any`。

运行时大致类似：

```go
type eface struct {
	typ  *type
	data unsafe.Pointer
}
```

其中：

- `typ` 表示动态类型。
- `data` 指向动态值。

例如：

```go
var x any = 123
```

可以粗略理解为：

```text
x = {
	type: int,
	data: pointer to 123,
}
```

### 非空接口

非空接口，例如：

```go
type Reader interface {
	Read([]byte) (int, error)
}
```

运行时大致类似：

```go
type iface struct {
	tab  *itab
	data unsafe.Pointer
}
```

`itab` 里包含：

- 接口类型信息
- 具体类型信息
- 方法表

所以非空接口不仅要知道“里面是什么类型”，还要知道“这个类型如何调用接口要求的方法”。

可以理解为：

```text
interface {
	具体类型是谁
	具体值在哪里
	如何调用接口方法
}
```

## 13. nil interface 陷阱

这是 Go interface 最常见的坑之一。

先定义一个错误类型：

```go
type MyError struct {
	Msg string
}

func (e *MyError) Error() string {
	return e.Msg
}
```

注意：

```go
var e *MyError = nil
```

这里的 `e` 不是 interface。

它是一个 `*MyError` 类型的指针变量。

`MyError` 是 struct 类型，`e` 是指向这个 struct 的指针。

真正的问题发生在它被赋值给 interface 时：

```go
func foo() error {
	var e *MyError = nil
	return e
}
```

`error` 本身是 interface：

```go
type error interface {
	Error() string
}
```

所以：

```go
return e
```

等价于：

```go
var e *MyError = nil
var err error = e
return err
```

此时 `err` 这个接口值变成：

```text
动态类型: *MyError
动态值: nil
```

一个 interface 只有在“动态类型”和“动态值”都为 nil 时，才等于 nil。

真正的 nil interface 是：

```text
动态类型: nil
动态值: nil
```

例如：

```go
var err error = nil
fmt.Println(err == nil) // true
```

但下面这个不是 nil interface：

```go
var e *MyError = nil
var err error = e

fmt.Println(err == nil) // false
```

因为它是：

```text
动态类型: *MyError
动态值: nil
```

可以把 interface 想象成一个盒子：

```text
err = [类型标签: *MyError, 值: nil]
```

盒子里面装的是 nil 指针，但盒子本身不是空的，因为它已经带了类型标签。

### nil interface 的危险

如果 `Error` 方法访问了接收者字段：

```go
func (e *MyError) Error() string {
	return e.Msg
}
```

当 `e == nil` 时，调用 `err.Error()` 可能 panic。

更安全的写法：

```go
func foo() error {
	var e *MyError = nil
	if e == nil {
		return nil
	}
	return e
}
```

经验原则：

- 返回 `error` 时，不要把带类型的 nil 指针返回成 interface。
- 如果没有错误，直接 `return nil`。
- 如果函数内部使用具体错误指针，返回前先判断是否为 nil。

## 14. 类型断言和 type switch

从接口中取出具体类型，需要类型断言。

```go
var x any = "hello"

s, ok := x.(string)
if ok {
	fmt.Println(s)
}
```

不建议在不确定时直接断言：

```go
s := x.(string) // 类型不匹配会 panic
```

可以使用 type switch：

```go
func Print(v any) {
	switch x := v.(type) {
	case string:
		fmt.Println("string:", x)
	case int:
		fmt.Println("int:", x)
	default:
		fmt.Println("unknown")
	}
}
```

## 15. 指针接收者影响接口实现

这个规则没有被“修复”，它是 Go 方法集规则的一部分。

Go 确实会在某些方法调用场景中自动取地址或自动解引用。

例如：

```go
type User struct{}

func (u *User) Save() {}

func main() {
	u := User{}
	u.Save() // 可以
}
```

这里 `u.Save()` 可以编译，是因为 `u` 是可寻址变量，编译器会帮你改成：

```go
(&u).Save()
```

但这只是方法调用时的语法糖。

接口实现判断看的是方法集，不看“调用时能不能自动取地址”。

```go
type Saver interface {
	Save()
}

type User struct{}

func (u *User) Save() {}
```

此时：

```go
var s Saver

s = &User{} // OK
s = User{}  // 编译错误
```

因为：

```text
User  的方法集: 没有 Save
*User 的方法集: 有 Save
```

方法集规则：

```go
func (u User) Foo()
```

则：

```text
User  有 Foo
*User 有 Foo
```

但：

```go
func (u *User) Bar()
```

则：

```text
User  没有 Bar
*User 有 Bar
```

完整例子：

```go
type T struct{}

func (T) A() {}
func (*T) B() {}
```

方法集：

```text
T:  A
*T: A, B
```

所以：

```go
var _ interface{ A() } = T{}  // OK
var _ interface{ A() } = &T{} // OK

var _ interface{ B() } = T{}  // 编译错误
var _ interface{ B() } = &T{} // OK
```

一句话总结：

> 自动取地址只发生在可寻址变量的方法调用上，不发生在接口实现判断上。

## 16. 小接口原则

Go 推荐小接口。

```go
type Reader interface {
	Read([]byte) (int, error)
}

type Writer interface {
	Write([]byte) (int, error)
}
```

常见标准库小接口：

- `io.Reader`
- `io.Writer`
- `fmt.Stringer`
- `error`

小接口的好处：

- 更容易复用
- 更容易测试
- 降低耦合
- 调用方只依赖自己真正需要的能力

## 17. interface 通常定义在使用方

Go 中常见建议：

> interface 通常由使用方定义，而不是由实现方定义。

例如 service 只需要仓库有一个查询方法：

```go
type UserRepository interface {
	FindByID(id int64) (*User, error)
}

type UserService struct {
	repo UserRepository
}
```

具体实现可以是 MySQL、Redis、HTTP API 或测试 mock。

```go
type MySQLUserRepository struct{}

func (r *MySQLUserRepository) FindByID(id int64) (*User, error) {
	return nil, nil
}
```

使用方不需要依赖具体实现。

## 18. 编译期检查接口实现

可以用下面方式确保某个类型实现了接口：

```go
var _ io.Reader = (*MyReader)(nil)
```

如果 `*MyReader` 没有实现 `io.Reader`，会编译失败。

如果是值类型实现：

```go
var _ io.Reader = MyReader{}
```

这个写法常用于：

- 库代码
- 复杂接口
- 防止重构时破坏接口实现

## 19. struct 和 interface 的典型搭配

常见依赖注入写法：

```go
type User struct {
	ID   int64
	Name string
}

type UserRepository interface {
	FindByID(id int64) (*User, error)
}

type UserService struct {
	repo UserRepository
}

func NewUserService(repo UserRepository) *UserService {
	return &UserService{repo: repo}
}

func (s *UserService) GetUser(id int64) (*User, error) {
	return s.repo.FindByID(id)
}
```

好处：

- 业务逻辑不依赖具体数据库。
- 测试时可以传 mock。
- 替换实现比较方便。

## 20. 常用经验总结

- `struct` 表示数据，`interface` 表示行为。
- `struct` 底层是一段连续内存，字段顺序和对齐会影响大小。
- 组合本质上还是字段，只是嵌入字段的字段和方法可以被提升。
- 组合不是继承，Go 没有子类关系。
- 同一层嵌入字段或方法冲突时，必须显式选择。
- 不同层次冲突时，浅层遮蔽深层。
- 字段和方法共用 selector 名字空间。
- 需要修改对象或避免复制大对象时，用指针接收者。
- 包含锁等不能复制的字段时，通常用指针接收者。
- interface 值底层包含类型信息和数据指针。
- nil interface 必须是动态类型和动态值都为 nil。
- `var e *MyError = nil` 本身不是 interface，但赋值给 `error` 时会变成带类型的 nil interface。
- 自动取地址只发生在可寻址变量的方法调用中，不影响接口实现判断。
- 指针接收者方法只属于指针类型的方法集。
- 接口尽量小，优先定义在使用方。
- 不要过早抽象 interface，先有真实需求再抽象。
- 使用 `var _ Interface = (*Type)(nil)` 做编译期接口实现检查。

一句话记忆：

> `struct` 负责“有什么数据”，`interface` 负责“能做什么行为”。Go 的组合和接口都很轻，但规则非常明确：组合看 selector 查找，接口看方法集，nil interface 看动态类型和动态值。

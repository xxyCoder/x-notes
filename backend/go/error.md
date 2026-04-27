## 总模型：error 是一棵可以被遍历的树

Go 的 `error` 表面上只是一个接口：

```go
type error interface {
	Error() string
}
```

但是 `errors.Is`、`errors.As`、`errors.AsType` 真正依赖的不是字符串，而是错误对象额外实现的这些方法：

```go
Error() string          // 给人看的错误文本
Unwrap() error          // 单链包装：一个错误包住另一个错误
Unwrap() []error        // 多分支包装：一个错误包含多个子错误
Is(target error) bool   // 自定义“我是否算作 target”
As(target any) bool     // 自定义“我是否能转成 target 类型”
```

所以要把 error 记成一棵树：

```text
普通错误
  没有 Unwrap

fmt.Errorf("... %w ...", err)
  一个 %w
  -> *fmt.wrapError
  -> Unwrap() error
  -> 单链

fmt.Errorf("... %w ... %w ...", err1, err2)
  多个 %w，Go 1.20+
  -> *fmt.wrapErrors
  -> Unwrap() []error
  -> 多叉树

errors.Join(err1, err2)
  -> *errors.joinError
  -> Unwrap() []error
  -> 多叉树
```

记忆口诀：

```text
New 造错，%w 包错，多个 %w / Join 并错；
Is 查身份，As / AsType 查类型；
Is / As 会遍历错误树，Unwrap 只拆单链。
```

## fmt.Errorf("%w")：wrapError 与 wrapErrors

`fmt.Errorf` 遇到 `%w` 时，不只是拼字符串，而是返回带 `Unwrap` 能力的错误对象。

核心分支可以理解为：

```go
switch len(p.wrappedErrs) {
case 0:
	err = errors.New(s)
case 1:
	err = &wrapError{msg: s, err: p.wrappedErrs[0]}
default:
	err = &wrapErrors{msg: s, errs: p.wrappedErrs}
}
```

### 一个 %w：单链

```go
type wrapError struct {
	msg string
	err error
}

func (e *wrapError) Error() string {
	return e.msg
}

func (e *wrapError) Unwrap() error {
	return e.err
}
```

例子：

```go
err := fmt.Errorf("query user: %w", ErrNotFound)
```

内部形状：

```text
*fmt.wrapError("query user: not found")
  |
  +-- Unwrap() error
      |
      +-- ErrNotFound
```

所以：

```go
errors.Is(err, ErrNotFound) // true
```

如果写成 `%v`，就只剩字符串，底层错误身份会丢失：

```go
fmt.Errorf("query user: %v", ErrNotFound) // 没有 Unwrap
```

### 多个 %w：多叉树

Go 1.20+ 支持多个 `%w`：

```go
err := fmt.Errorf("save failed: db=%w cache=%w", dbErr, cacheErr)
```

内部不是链：

```text
err -> dbErr -> cacheErr
```

而是树：

```text
*fmt.wrapErrors("save failed: db=... cache=...")
  |
  +-- Unwrap() []error
      |
      +-- dbErr
      +-- cacheErr
```

对应类型：

```go
type wrapErrors struct {
	msg  string
	errs []error
}

func (e *wrapErrors) Error() string {
	return e.msg
}

func (e *wrapErrors) Unwrap() []error {
	return e.errs
}
```

所以：

```go
errors.Is(err, dbErr)    // true
errors.Is(err, cacheErr) // true
```

多个 `%w` 和 `errors.Join` 都会生成 `Unwrap() []error`，区别主要是：

```text
多个 %w：
  Error() 字符串完全由 fmt.Errorf 的格式化结果决定，适合写一条上下文明确的错误消息。

errors.Join：
  Error() 字符串通常是多个错误用换行拼起来，适合把多个独立错误合并返回。
```

## As

核心作用是从一个错误树中，找到第一个匹配特定类型的错误，并将其提取出来赋值给目标变量

```go
var errorType = reflectlite.TypeOf((*error)(nil)).Elem()

func As(err error, target any) bool {
    // 1. 如果原始错误本身就是 nil，直接返回 false，无需查找。
    if err == nil {
       return false
    }
    
    // 2. 目标变量 target 绝对不能为 nil，否则引发 panic。
    if target == nil {
       panic("errors: target cannot be nil")
    }
    
    // 3. 引入底层轻量级反射库 reflectlite 来获取 target 的值 (Value) 和类型 (Type)
    val := reflectlite.ValueOf(target)
    typ := val.Type()
    
    // 4. 【关键校验】target 必须是一个非空的指针 (Pointer)
    // 为什么？因为 Go 函数传参是“值传递”。如果传值，函数内部只能修改副本。
    // 为了把找到的底层错误赋值给外部的 target，必须传入 target 的内存地址（指针）。
    if typ.Kind() != reflectlite.Ptr || val.IsNil() {
       panic("errors: target must be a non-nil pointer")
    }
    
    // 5. 获取 target 指针所指向的实际数据类型 (Elem)
    targetType := typ.Elem()
    
    // 6. 【关键校验】target 指向的类型必须是 接口(Interface) 或者 实现了 error 接口的具体结构体
    // 因为 As 的目的是提取错误，如果传入一个普通类型的指针（如 *int），是没有意义的。
    if targetType.Kind() != reflectlite.Interface && !targetType.Implements(errorType) {
       panic("errors: *target must be interface or implement error")
    }
    
    // 7. 校验全部通过，进入实际的遍历与匹配逻辑
    return as(err, target, val, targetType)
}

func as(err error, target any, targetVal reflectlite.Value, targetType reflectlite.Type) bool {
    for {
        // --- 【阶段一：尝试匹配当前错误】 ---
        
        // 规则 1：如果当前的 err 类型，可以直接赋值给 target 指向的类型
        if reflectlite.TypeOf(err).AssignableTo(targetType) {
            // 利用反射机制，将当前 err 的值写入到 target 所在的内存地址中
            targetVal.Elem().Set(reflectlite.ValueOf(err))
            return true
        }
        
        // 规则 2：允许自定义错误类型拦截并重写 As 行为
        // 如果当前的 err 自己实现了 `As(any) bool` 方法，就调用它自己的逻辑。
        if x, ok := err.(interface{ As(any) bool }); ok && x.As(target) {
            return true
        }
        
        // --- 【阶段二：如果不匹配，尝试拆包进入下一层】 ---
        switch x := err.(type) {
        
        // 场景 A：单重包装错误 (实现了 Unwrap() error)
        case interface{ Unwrap() error }:
            err = x.Unwrap() // 拨开一层洋葱皮
            if err == nil {
                return false // 到底了，没找到
            }
            // 因为有外层的 for {} 死循环，这里不需要递归，直接进行下一次循环检查拨开后的 err 
			
		//场景 B：多重包装错误 (实现了 Unwrap() []error，如 errors.Join 产生的错误)
        case interface{ Unwrap() []error }:
            // 遇到树的分叉了，遍历每一个子分支
            for _, err := range x.Unwrap() {
                if err == nil {
                    continue
                }
                // 【核心原理】：这里发生了递归调用 as()。
                // 如果一个子节点还有它自己的子节点，程序会一直往深处找，找完一条完整的分支再找下一条，这就是经典的“深度优先遍历”。
                if as(err, target, targetVal, targetType) {
                    return true
                }
            }
            return false
        
        // 场景 C：既不是预期类型，也无法继续 Unwrap 拆包（即这是一个最底层的原生错误）
        default:
            return false
        }
    }
}
```

## AsType

AsType 的核心目标和 As 一样：在错误树中找到特定类型的错误。

```go
// [E error] 是泛型类型约束，表示类型参数 E 必须实现了 error 接口。
// 返回值直接返回具体的类型 E 和一个布尔值，不再需要传入目标变量的指针。
func AsType[E error](err error) (E, bool) {
	// 1. 如果原始错误为 nil，直接返回类型 E 的零值和 false。
	if err == nil {
		var zero E // 声明类型 E 的零值变量
		return zero, false
	}

	// 2. 【核心巧思：延迟初始化】声明一个指向 E 的指针，但先不分配内存 (此时 pe == nil)
	var pe *E

	// 3. 将 err 和 pe 的内存地址 (也就是指向指针的指针 **E) 传入实际处理逻辑
	return asType(err, &pe)
}

// 注意这里的参数 ppe 是 **E (指向指针的指针)
func asType[E error](err error, ppe **E) (_ E, _ bool) {
	for {
		// --- 【阶段一：尝试匹配当前错误】 ---

		// 规则 1：【核心性能来源：类型断言】
		// err.(E) 叫做“类型断言 (Type Assertion)”。
		// 它是在 Go runtime 级别直接比对接口底层的类型元数据，是 O(1) 级别的极速操作。
		// 这彻底替代了老版本 As 中沉重的 reflectlite.TypeOf(err).AssignableTo(targetType) 反射调用。
		if e, ok := err.(E); ok {
			return e, true
		}

		// 规则 2：处理自定义了 As(any) bool 方法的错误
		if x, ok := err.(interface{ As(any) bool }); ok {
			// 到了这里，说明必须调用自定义的 As 方法了，而 As 方法需要一个接口/指针作为参数。
			// 此时检查 *ppe (也就是外层的 pe) 是否为空。
			if *ppe == nil {
				*ppe = new(E) // 【触发延迟初始化】：在这里才真正分配内存！
			}
			// 调用自定义的 As 方法，看它是否愿意将自身转换为 *ppe 指定的类型
			if x.As(*ppe) {
				return **ppe, true // 提取成功，解引用返回具体的错误实体
			}
		}

		// --- 【阶段二：拆包与遍历错误树】 ---
		// 这里的逻辑与旧版的 as 完全一致，都是拨洋葱或遍历多重树枝。
		switch x := err.(type) {
		case interface{ Unwrap() error }: // 单一链条拆包
			err = x.Unwrap()
			if err == nil {
				return
			}
		case interface{ Unwrap() []error }: // 多重树枝拆包 (Go 1.20 errors.Join)
			for _, err := range x.Unwrap() {
				if err == nil {
					continue
				}
				// 递归调用自身，继续向树的深处寻找
				if x, ok := asType(err, ppe); ok {
					return x, true
				}
			}
			return
		default: // 原生底层错误，无法拆包，当前分支寻找失败
			return
		}
	}
}
```

## Is

核心作用是从错误树中判断是否存在某个目标错误。它和 `As` 的遍历方式一致，都会识别：

```go
Unwrap() error
Unwrap() []error
```

区别是：

```text
As / AsType：查类型，找到后把错误对象取出来
Is：查身份，判断错误树里是否存在 target
```

源码流程可以理解为：

```go
func Is(err, target error) bool {
	if err == nil || target == nil {
		return err == target
	}

	isComparable := reflectlite.TypeOf(target).Comparable()
	return is(err, target, isComparable)
}

func is(err, target error, targetComparable bool) bool {
	for {
		// 规则 1：如果 target 的动态类型可比较，就直接用 == 判断。
		// 这一步用于匹配 sentinel error，例如 io.EOF、fs.ErrNotExist、自定义的 ErrNotFound。
		if targetComparable && err == target {
			return true
		}

		// 规则 2：允许当前错误自己声明“我是否算作 target”。
		if x, ok := err.(interface{ Is(error) bool }); ok && x.Is(target) {
			return true
		}

		// 规则 3：没有匹配时，继续拆包。
		switch x := err.(type) {
		case interface{ Unwrap() error }:
			err = x.Unwrap()
			if err == nil {
				return false
			}

		case interface{ Unwrap() []error }:
			for _, err := range x.Unwrap() {
				if is(err, target, targetComparable) {
					return true
				}
			}
			return false

		default:
			return false
		}
	}
}
```

遍历顺序：

```text
1. 当前 err == target 吗？
2. 当前 err 自己实现了 Is(target) 吗？
3. 有 Unwrap() error 吗？有就沿单链往下走
4. 有 Unwrap() []error 吗？有就深度优先遍历每个子错误
5. 都没有，返回 false
```

### Is 的“身份匹配”

在 Go 的底层实现中，接口值可以粗略理解成两个部分：

```text
类型信息：这个接口里装的动态类型是什么
数据信息：这个动态值具体是什么
```

`errors.Is` 里的 `err == target` 是严格匹配：动态类型要匹配，具体值也要匹配。对常见 sentinel error 来说，通常就是同一个错误变量：

```go
var ErrNotFound = errors.New("not found")

err := fmt.Errorf("repo: %w", ErrNotFound)

errors.Is(err, ErrNotFound)           // true
errors.Is(err, errors.New("not found")) // false，不是同一个错误值
```

所以 sentinel error 必须定义成包级变量并复用，不要每次临时 `errors.New("not found")`。

### 自定义 Is

如果一个错误没有真的包住 `target`，但想让 `errors.Is` 认为它等价于某个错误，可以实现 `Is(error) bool`：

```go
type PermissionError struct{}

func (PermissionError) Error() string {
	return "permission denied"
}

func (PermissionError) Is(target error) bool {
	return target == fs.ErrPermission
}

errors.Is(PermissionError{}, fs.ErrPermission) // true
```

这时命中的是自定义 `Is`，不是 `Unwrap`。

### Is 和 As 的底层差异

```text
Is：
  主要用 == 判断“是不是同一个错误值”
  target 必须可比较时才直接比较
  适合判断 sentinel error

As / AsType：
  判断当前错误能不能赋值给目标类型
  适合提取结构化错误，例如 *fs.PathError、*os.SyscallError
```

一句话：

```text
Is 看身份，As 看类型。
```

## joinError

`errors.Join` 用来把多个独立错误合并成一个错误。它和多个 `%w` 一样，都会产生 `Unwrap() []error`，因此都会让错误结构变成多叉树。

典型使用场景：一个函数执行了多个清理动作，希望把所有失败都返回，而不是只保留最后一个错误。

```go
func closeAll(a, b io.Closer) error {
	return errors.Join(a.Close(), b.Close())
}
```

源码核心：

```go
func Join(errs ...error) error {
	n := 0
	for _, err := range errs {
		if err != nil {
			n++
		}
	}
	if n == 0 {
		return nil
	}
	e := &joinError{
		errs: make([]error, 0, n),
	}
	for _, err := range errs {
		if err != nil {
			e.errs = append(e.errs, err)
		}
	}
	return e
}

type joinError struct {
	errs []error
}

func (e *joinError) Error() string {
	// Since Join returns nil if every value in errs is nil,
	// e.errs cannot be empty.
	if len(e.errs) == 1 {
		return e.errs[0].Error()
	}

	b := []byte(e.errs[0].Error())
	for _, err := range e.errs[1:] {
		b = append(b, '\n')
		b = append(b, err.Error()...)
	}
	// At this point, b has at least one byte '\n'.
	return unsafe.String(&b[0], len(b))
}

func (e *joinError) Unwrap() []error {
	return e.errs
}
```

需要注意：

```text
1. Join 会过滤 nil。
2. 如果所有参数都是 nil，Join 返回 nil。
3. joinError.Error() 会把多个错误字符串用换行拼起来。
4. joinError.Unwrap() 返回 []error，所以 errors.Is / errors.As 会遍历每个子错误。
5. errors.Unwrap 不会拆 joinError，因为 errors.Unwrap 只认 Unwrap() error。
```

## New

创建一个新error，实际就是保存了传进来的文本，调用`Error`方法时将其返回

```go
func New(text string) error {
	return &errorString{text}
}

// errorString is a trivial implementation of error.
type errorString struct {
	s string
}

func (e *errorString) Error() string {
	return e.s
}
```

## Unwrap

如果错误实现了 `Unwrap() error` 则调用，否则返回 nil。

注意：`errors.Unwrap` 只认单链包装，不认 `Unwrap() []error`。也就是说，它可以拆一个 `%w` 产生的 `*fmt.wrapError`，但不能直接拆 `errors.Join` 或多个 `%w` 产生的多分支错误。

```go
func Unwrap(err error) error {
	u, ok := err.(interface {
		Unwrap() error
	})
	if !ok {
		return nil
	}
	return u.Unwrap()
}
```

对比：

```go
single := fmt.Errorf("outer: %w", io.EOF)
errors.Unwrap(single) // io.EOF

multi := errors.Join(io.EOF, fs.ErrNotExist)
errors.Unwrap(multi) // nil

multi2 := fmt.Errorf("a=%w b=%w", io.EOF, fs.ErrNotExist)
errors.Unwrap(multi2) // nil
```

但是 `errors.Is`、`errors.As`、`errors.AsType` 会识别 `Unwrap() []error`：

```go
errors.Is(multi, io.EOF)       // true
errors.Is(multi2, io.EOF)      // true
errors.Is(multi2, fs.ErrNotExist) // true
```

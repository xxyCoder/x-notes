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

底层思想和`As`方法一致，只不过`As`用的是`AssignableTo`，而`Is`用的是`Comparable`

在 Go 的底层实现中，任何接口（比如 error）在内存里其实是一个包含两个指针的结构体（无方法的叫 eface，有方法的叫 iface）：

_type 指针：指向这个变量的动态类型信息（比如“我是一个 *fs.PathError”）。

data 指针：指向这个变量具体的底层数据内存地址（比如“我的路径字段是 /tmp/a.txt”）。

errors.Is 的底层逻辑 (==)：它要求两个接口的 _type 必须相同，且 data 指针指向的值也必须相同（除非你重写了自定义的 Is 方法）。它是一个极其严格的“完全匹配”。

errors.As 的底层逻辑 (AssignableTo / 类型断言)：它只看 _type 指针！只要类型元数据匹配，它根本不在乎底层的 data 是什么，直接把数据所在的内存地址拿过来，赋值给你的目标变量。

## joinError

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

如果错误实现了`Unwrap`则调用，否则返回nil

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
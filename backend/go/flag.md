## FlagSet

```go
type FlagSet struct {
	// Usage is the function called when an error occurs while parsing flags.
	// The field is a function (not a method) that may be changed to point to
	// a custom error handler. What happens after Usage is called depends
	// on the ErrorHandling setting; for the command line, this defaults
	// to ExitOnError, which exits the program after calling Usage.
	Usage func()

	name          string
	parsed        bool // 状态机：标记是否已经执行过 Parse()
	actual        map[string]*Flag
	formal        map[string]*Flag
	args          []string  // 解析完标志后，剩下的非标志参数
	errorHandling ErrorHandling  // 错误处理策略（继续、退出程序、或者 Panic）
	output        io.Writer         // 输出流，默认是 os.Stderr
	undef         map[string]string  // 记录“在定义之前就被 Set”的异常标志
}

type Flag struct {
    Name     string // name as it appears on command line
    Usage    string // help message
    Value    Value  // value as set
    DefValue string // default value (as text); for usage message
}
```

1. `formal` 指的是你在代码中通过声明注册的标志
2. `actual` 指的是用户在命令行中真正输入并生效的标志

## Parse

```go
func (f *FlagSet) Parse(arguments []string) error {
    f.parsed = true        // 1. 状态锁：标记该 FlagSet 已经被解析过，常用于后续 Parsed() 方法的检查
    f.args = arguments     // 2. 初始化“待解析池”。注意这里的名词区分：通常外部传入的是 os.Args[1:]（排除了程序名本身）
    
    for {
        // 3. 核心调用：尝试解析一个标志
        seen, err := f.parseOne()
        
        if seen {
            continue // 成功解析了一个标志，进入下一轮循环，继续榨干 f.args
        }
        if err == nil {
            break    // seen 为 false 且没有报错，说明正常的标志已经全部解析完毕（比如遇到了非标志参数），跳出循环
        }
        
        // 4. 错误处理策略分发
        switch f.errorHandling {
        case ContinueOnError:
            return err      // 交给开发者自己处理
        case ExitOnError:
            if err == ErrHelp {
                os.Exit(0)  // 特判：如果是用户输入了 -h 触发的帮助，属于正常退出，状态码为 0
            }
            os.Exit(2)      // 解析错误属于用户输入错误，按照 Unix 惯例，退出码为 2
        case PanicOnError:
            panic(err)      // 极端严格模式，直接宕机
        }
    }
    return nil
}
```

### parseOne

1. 边界条件与终止符拦截

```go
    if len(f.args) == 0 {
       return false, nil // 池子空了，解析自然结束
    }
    s := f.args[0]       // 永远只盯着当前池子的第一个元素
    if len(s) < 2 || s[0] != '-' {
       return false, nil // 核心规则：遇到第一个不以 "-" 开头的参数，立刻停止解析！
    }
    
    numMinuses := 1
    if s[1] == '-' {
       numMinuses++
       if len(s) == 2 { // 特殊终止符 "--" 的判断
          f.args = f.args[1:] // 吃掉 "--" 本身
          return false, nil   // 停止解析
       }
    }
```

2. 语法校验与键值拆包

```go
    name := s[numMinuses:] // 剥离前缀，拿到纯名字（比如 "port" 或 "port=8080"）
    if len(name) == 0 || name[0] == '-' || name[0] == '=' {
       return false, f.failf("bad flag syntax: %s", s) // 拦截 "---" 或 "-=" 这种畸形输入
    }

    f.args = f.args[1:] // 语法没问题，正式“吃掉”当前这个参数 token

    hasValue := false
    value := ""
    for i := 1; i < len(name); i++ { // 扫描等号 '='
       if name[i] == '=' {
          value = name[i+1:] // 等号右边是值
          hasValue = true
          name = name[0:i]   // 等号左边是名
          break
       }
    }
```

3. 字典查表与内置 Help 拦截

```go
    flag, ok := f.formal[name] // 去上一回合讲到的 formal 注册表里查
    if !ok {
       if name == "help" || name == "h" { // 标准库自带的温情：拦截 -h 或 --help
          f.usage()
          return false, ErrHelp
       }
       return false, f.failf("flag provided but not defined: -%s", name)
    }
```

4. 类型断言与取值逻辑

```go
// 语法：通过类型断言，检查当前 flag.Value 的底层实现是否不仅满足 Value 接口，还满足 boolFlag 接口
    if fv, ok := flag.Value.(boolFlag); ok && fv.IsBoolFlag() { 
       // 【布尔标志的分支】
       if hasValue { // 用户写了 "-b=false"
          if err := fv.Set(value); err != nil { ... }
       } else {      // 用户只写了 "-b"，没有等号
          if err := fv.Set("true"); err != nil { ... } // 底层强制塞入 "true"
       }
    } else {
       // 【非布尔标志的分支】(比如 Int, String)
       if !hasValue && len(f.args) > 0 { // 如果没有等号，就向后“偷”一个参数作为值
          hasValue = true
          // 连等号赋值：value 拿到下一个参数，f.args 切片整体再向后挪一位（又吃掉一个）
          value, f.args = f.args[0], f.args[1:] 
       }
       if !hasValue { // 如果连下一个参数都没有了（比如 "-port" 放到了命令行最后一位）
          return false, f.failf("flag needs an argument: -%s", name)
       }
       if err := flag.Value.Set(value); err != nil { ... } // 调用具体类型的 Set 方法转换并赋值
    }
```

5. 登记

```go
if f.actual == nil {
       f.actual = make(map[string]*Flag)
    }
    f.actual[name] = flag // 登记造册，证明这个标志在本次运行中实际被用户触发了
    return true, nil
```

## TypeVar

将命令行传入的值，绑定（注入）到你提前准备好的现有变量指针上

StringVar、IntVar、Int64Var、Float64Var、UintVar、Uint64Var底层都是调用`Value`

```go
func (f *FlagSet) Var(value Value, name string, usage string) {
	// Flag must not begin "-" or contain "=".
	if strings.HasPrefix(name, "-") {
		panic(f.sprintf("flag %q begins with -", name))
	} else if strings.Contains(name, "=") {
		panic(f.sprintf("flag %q contains =", name))
	}

	// Remember the default value as a string; it won't change.
	flag := &Flag{name, usage, value, value.String()}
	_, alreadythere := f.formal[name]
	if alreadythere {
		var msg string
		if f.name == "" {
			msg = f.sprintf("flag redefined: %s", name)
		} else {
			msg = f.sprintf("%s flag redefined: %s", f.name, name)
		}
		panic(msg) // Happens only if flags are declared with identical names
	}
	if pos := f.undef[name]; pos != "" {
		panic(fmt.Sprintf("flag %s set at %s before being defined", name, pos))
	}
	if f.formal == nil {
		f.formal = make(map[string]*Flag)
	}
	f.formal[name] = flag // 注册参数
}
```

## Type

它底层就是帮你 new 了一个指针，然后复用了 TypeVar 的逻辑

```go
func (f *FlagSet) Int(name string, value int, usage string) *int {
	p := new(int)
	f.IntVar(p, name, value, usage)
	return p
}
```

## Var

允许你让命令行接收任意格式的数据（如 JSON、逗号分隔符、IP 地址等）

只需要实现了`Value`接口即可

```go
type Value interface {
	String() string
	Set(string) error
}
```

### 示例

```go
import (
    "flag"
    "fmt"
    "strings"
)

// 1. 定义我们自己的底层类型
type stringSlice []string

// 2. 实现 flag.Value 接口的 String 方法（用于打印默认值和帮助信息）
func (s *stringSlice) String() string {
    return fmt.Sprintf("%v", *s)
}

// 3. 实现 flag.Value 接口的 Set 方法（核心逻辑：决定如何将终端输入的字符串变成切片）
// 当用户输入 -hosts a.com,b.com 时，s 参数接收到的就是 "a.com,b.com"
func (s *stringSlice) Set(val string) error {
    // 语法操作：按逗号切分字符串，并追加到当前的切片指针指向的底层数组中
    *s = strings.Split(val, ",")
    return nil
}

func main() {
    // 准备一个空切片作为接收容器
    var hosts stringSlice
    
    // 4. 调用 Var 方法注册。因为 *stringSlice 实现了 Value 接口，所以可以作为第一个参数传入
    flag.Var(&hosts, "hosts", "comma-separated list of hostnames")
    flag.Parse()

    // 此时，hosts 已经是一个优雅的 Go 切片了，可以直接遍历
    fmt.Printf("Parsed hosts: %q\n", hosts) // 输出示例: Parsed hosts: ["a.com" "b.com"]
}
```
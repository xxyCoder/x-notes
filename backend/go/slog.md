## Logger

```go
type Handler interface {
    Enabled(context.Context, Level) bool
    Handle(context.Context, Record) error
    WithAttrs(attrs []Attr) Handler
    WithGroup(name string) Handler
}

type Logger struct {
	handler Handler // for structured logging
}

func New(h Handler) *Logger {
    if h == nil {
        panic("nil Handler")
    }
    return &Logger{handler: h}
}
```

1. Logger 是前端（Frontend API）： 负责提供给开发者友好、丰富的调用方法（如 Info(), Debug(), With()）。它负责捕获时间、调用栈上下文等。
2. Handler 是后端（Backend Engine）： 真正的苦力。负责决定这条日志要不要被过滤掉、长什么样、输出到哪里。

## Log

```go
func (l *Logger) Log(ctx context.Context, level Level, msg string, args ...any) {
	l.log(ctx, level, msg, args...)
}

func (l *Logger) log(ctx context.Context, level Level, msg string, args ...any) {
    if ctx == nil {
        ctx = context.Background()
    }
    // 1. 性能优化的第一道防线
    if !l.Enabled(ctx, level) {
        return
    }
    
    var pc uintptr
    // 2. 捕获调用者信息 (Program Counter)
    if !internal.IgnorePC {
    var pcs [1]uintptr
        // skip [runtime.Callers, this function, this function's caller]
        runtime.Callers(3, pcs[:])
        pc = pcs[0]
    }
    
    // 3. 构建核心数据结构 Record
    r := NewRecord(time.Now(), level, msg, pc)
    r.Add(args...)
    
    // 4. 委派给 Handler 处理
    _ = l.Handler().Handle(ctx, r)
}
```

## Record

```go
const nAttrsInline = 5

type Record struct {
    Time time.Time
    Message string
    Level Level
    PC uintptr

    // 性能优化的核心：内联数组
    front [nAttrsInline]Attr 
    nFront int               

    // 溢出切片
    back []Attr              
}

type Attr struct {
    Key   string
    Value Value
}
```

1. 前 5 个属性：直接塞进 front 数组，完全在栈上分配，零内存逃逸，零 GC 压力；超过 5 个的属性：才会使用 back 切片进行动态扩容（走堆内存分配）

```go
func (r *Record) AddAttrs(attrs ...Attr) {
    var i int
    // 步骤 1：先填满 front 数组
    for i = 0; i < len(attrs) && r.nFront < len(r.front); i++ {
       a := attrs[i]
       if a.Value.isEmptyGroup() {
          continue
       }
       r.front[r.nFront] = a
       r.nFront++ // 记录当前 front 使用到了第几个槽位
    }
    
    // ... 省略安全检查代码 ...

    // 步骤 2：如果 attrs 还有剩余，全塞进 back 切片
    ne := countEmptyGroups(attrs[i:])
    r.back = slices.Grow(r.back, len(attrs[i:])-ne)
    for _, a := range attrs[i:] {
       if !a.Value.isEmptyGroup() {
          r.back = append(r.back, a)
       }
    }
}
```
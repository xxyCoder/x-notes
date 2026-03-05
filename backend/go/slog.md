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

Info、InfoContext、Warn、WarnContext、Error、ErrorContext、Debug、DebugContext本质都是`l.log(ctx, LevelInfo, msg, args...)`

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

## TextHandler

```go
func NewTextHandler(w io.Writer, opts *HandlerOptions) *TextHandler {
	if opts == nil {
		opts = &HandlerOptions{}
	}
	return &TextHandler{
		&commonHandler{
			json: false,
			w:    w,
			opts: *opts,
			mu:   &sync.Mutex{},
		},
	}
}
```

### WithGroup

让后续所有的日志属性都默认带上某个命名空间

```go
func (h *TextHandler) WithGroup(name string) Handler {
	return &TextHandler{commonHandler: h.commonHandler.withGroup(name)}
}

func (h *commonHandler) withGroup(name string) *commonHandler {
    h2 := h.clone() // 派生新的handler，隔离父子logger
    h2.groups = append(h2.groups, name)
    return h2
}

func (s *handleState) openGroups() {
    for _, n := range s.h.groups[s.h.nOpenGroups:] {
        s.openGroup(n)
    }
}

func (s *handleState) openGroup(name string) {
        if s.h.json {
        s.appendKey(name)
        s.buf.WriteByte('{')
        s.sep = ""
    } else {
        s.prefix.WriteString(name)
        s.prefix.WriteByte(keyComponentSep) // 点号
    }
    // Collect group names for ReplaceAttr.
    if s.groups != nil {
        *s.groups = append(*s.groups, name)
    }
}
```

### WithAttrs

普通的属性是在打日志那一刻（Handle）才去转成字符串的。但是 withAttrs 绑定的属性是全局/模块级的，每次打日志都会带上。为了不浪费 CPU 每次都去解析它们，withAttrs 会直接在内存里把它们序列化成一段死字节流，塞进 preformattedAttrs 这个字段里

```go
func (h *TextHandler) WithAttrs(attrs []Attr) Handler {
    return &TextHandler{commonHandler: h.commonHandler.withAttrs(attrs)}
}

// withAttrs 接收一组属性，并返回一个新的、包含了这些属性的子 Handler。
// 它的核心任务是：把传入的 attributes 提前序列化成“死字节流”，存入 h2.preformattedAttrs 中。
func (h *commonHandler) withAttrs(as []Attr) *commonHandler {
    // 1. 边界防御：如果传进来的全是空的属性（比如空的 Group），
    // 没必要费劲派生新的 Handler，直接把原来的自己返回去就行。
    if countEmptyGroups(as) == len(as) {
       return h
    }
    
    // 2. 隔离状态：克隆出一个全新的 Handler 实例。
    // 这保证了后续追加的属性和字节流，只会影响当前派生出来的子 Logger，不会污染父 Logger。
    h2 := h.clone()
    
    // 3. 建立“烤箱” (重定向输出流)：
    // 注意看这里，newHandleState 正常情况下是接收 buffer.New() 用于打印日志到终端的。
    // 但这里非常 Hack！它把 h2.preformattedAttrs（也就是这个新 Handler 专属的字节切片）
    // 强行转换成了 *buffer.Buffer 传了进去。
    // 意味着接下来所有的 append 操作，都会直接写入这段内存缓存中！
    state := h2.newHandleState((*buffer.Buffer)(&h2.preformattedAttrs), false, "")
    defer state.free() // 执行完后释放相关临时变量，但不释放 preformattedAttrs 的底层数组
    
    // 4. 继承前缀 (针对 Text 模式)：
    // 把父 Handler 已经算好的前缀（比如 "req.db."）先写进当前 state 的缓存里。
    state.prefix.WriteString(h.groupPrefix)
    
    // 5. 处理分隔符逻辑：
    // 如果 preformattedAttrs 里面已经有之前“烤”好的历史属性了...
    if pfa := h2.preformattedAttrs; len(pfa) > 0 {
       state.sep = h.attrSep() // 默认准备加一个分隔符（JSON是逗号",", Text是空格" "）
       
       // 极致细节：如果是 JSON 模式，且上一个字符刚好是左大括号 '{'（说明刚打开了一个 Group），
       // 那么紧接着的第一个属性前面绝对不能加逗号，否则 JSON 格式就坏了（变成 {"req":{,"ip":"..."} ）。
       if h2.json && pfa[len(pfa)-1] == '{' {
          state.sep = ""
       }
    }
    
    // 6. 记录存档点 (Savepoint)：
    // 记录下当前“烤箱”(Buffer)里已经写了多少个字节。
    // 为什么？因为传进来的属性 as 虽然有长度，但可能全是空值（被 elide 掉）。
    // 如果最后发现什么实质性内容都没写，我们需要回滚撤销！
    pos := state.buf.Len()
    
    // 7. 把累积的 Group 状态固化进去！
    // 遍历当前 h2.groups 里尚未被固化的组名，把它们转换成 "groupName": { 或者 groupName. 写进去。
    // 这就是为什么 WithGroup 必须在 WithAttrs 之前调用才能包裹住这些属性的原因！
    state.openGroups()
    
    // 8. 真正执行序列化：
    // 遍历传入的属性 as，把它们解析成 "key":"value" 写进 Buffer 里。
    // appendAttrs 返回 false 说明传进来的属性全被忽略了（都是空值）。
    if !state.appendAttrs(as) {
       // 9. 回滚操作：
       // 如果发现没写进去任何有用的东西，把 Buffer 截断回第 6 步记录的位置 pos。
       // 相当于撤销了第 7 步 openGroups 写入的那些左括号和前缀。
       state.buf.SetLen(pos)
    } else {
       // 10. 状态更新 (极其关键)：
       // 既然成功把新属性“烤”进字节流了，我们需要更新两个游标/状态：
       
       // (a) 更新 Text 模式的前缀缓存。比如从 "req." 变成了 "req.db."
       h2.groupPrefix = state.prefix.String()
       
       // (b) 更新 nOpenGroups 游标！
       // len(h2.groups) 代表当前所有的嵌套层级。
       // 把 nOpenGroups 设为它，等于告诉后续打日志的 Handle 方法：
       // “当前这几个 Group 已经被我提前序列化进 preformattedAttrs 里了，
       // 你真正打日志遍历 groups 数组输出时，直接跳过它们，别再重复输出左括号了！”
       h2.nOpenGroups = len(h2.groups)
    }
    
    // 返回这个内部自带了半成品 JSON/Text 字节流的新 Handler！
    return h2
}
```

## Handle

将内容进行输出

```go
// handle 是 TextHandler 和 JSONHandler 内部真正调用的核心实现
func (h *commonHandler) handle(r Record) error {
    // 1. 【拿个空盘子】：从 sync.Pool 里捞一个复用的 Buffer 出来
    state := h.newHandleState(buffer.New(), true, "")
    defer state.free() // 函数结束时，把盘子洗干净还给 Pool

    if h.json {
       state.buf.WriteByte('{') // JSON 起手式
    }

    // --- 2. 【先放主菜】：内置字段 ---
    // 按顺序把 time, level, source, msg 写进 Buffer
    // (这部分为了不被自定义 Group 影响，甚至先把 state.groups 临时设为了 nil)
    // ... (省略了 built-in 属性的拼装代码)

    // --- 3. 【再放配菜和预制菜】：非内置字段 ---
    // 调用 appendNonBuiltIns：
    // a) 先把 WithAttrs 提前烤好的“预制菜” preformattedAttrs 直接倒进 Buffer。
    // b) 再把当前这条日志附带的临时 Attrs (r.Attrs) 挨个写进 Buffer。
    // c) 最后，根据打开的组数量，补齐对应数量的 '}' 右括号。
    state.appendNonBuiltIns(r)
    
    // 给整条日志收个尾：加个换行符
    state.buf.WriteByte('\n')

    // --- 4. 【上菜！】：加锁，写入目的地 ---
    h.mu.Lock()
    defer h.mu.Unlock()
    _, err := h.w.Write(*state.buf)
    
    return err
}
```
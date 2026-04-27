# Go defer / panic / recover

## 1. 总览

`defer`、`panic`、`recover` 是 Go 中一组配套机制：

- `defer`：注册一个延迟调用，在当前函数返回前执行。
- `panic`：让当前 goroutine 进入 panic 状态，并开始沿调用栈向外展开。
- `recover`：只能在 deferred function 中生效，用来停止当前 goroutine 中正在展开的 panic。

日常使用时，可以先记住一句话：

> defer 负责收尾，panic 负责异常展开，recover 只应该在边界层兜底。

从实现角度看：

- 每个 goroutine 都维护自己的 defer 链和 panic 链。
- panic 只在当前 goroutine 的调用栈中传播。
- recover 只能恢复当前 goroutine 中某个函数栈帧正在处理的 panic，不能跨 goroutine。

## 2. defer 的语义

### 2.1 基本用法

`defer` 常用于资源释放、解锁、恢复状态、日志统计：

```go
f, err := os.Open("a.txt")
if err != nil {
    return err
}
defer f.Close()
```

```go
mu.Lock()
defer mu.Unlock()
```

```go
start := time.Now()
defer func() {
    log.Println("cost:", time.Since(start))
}()
```

### 2.2 执行顺序：后进先出

同一个函数中注册多个 defer 时，执行顺序是 LIFO：

```go
func f() {
    defer fmt.Println("1")
    defer fmt.Println("2")
    defer fmt.Println("3")
}
```

输出：

```text
3
2
1
```

这是因为 runtime 逻辑上把 defer 挂在当前 goroutine 的 defer 链表头部，后注册的先执行。

### 2.3 参数立即求值

`defer` 后面的函数调用，其参数会在执行到 `defer` 语句时立即求值。

```go
func f() {
    x := 1
    defer fmt.Println(x)

    x = 2
}
```

输出：

```text
1
```

因为 `fmt.Println(x)` 中的 `x` 在注册 defer 时已经求值。

但是闭包读取的是变量本身：

```go
func f() {
    x := 1
    defer func() {
        fmt.Println(x)
    }()

    x = 2
}
```

输出：

```text
2
```

### 2.4 defer 可以修改命名返回值

命名返回值在 `return` 语句执行时先被赋值，然后再执行 defer，最后函数真正返回。

```go
func f() (err error) {
    defer func() {
        if err != nil {
            err = fmt.Errorf("wrap: %w", err)
        }
    }()

    return errors.New("bad")
}
```

执行顺序可以理解为：

```text
return errors.New("bad")
    -> 先把返回值 err 设置为 errors.New("bad")
    -> 执行 defer
    -> defer 修改 err
    -> 函数真正返回
```

所以这个函数最终返回的是包装后的 error。

## 3. defer 的三种实现

Go 语言层面的 defer 语义比较稳定，但编译器和 runtime 的实现不断优化。

目前常说的 defer 有三种实现：

```text
defer
├── heap-allocated defer
├── stack-allocated defer
└── open-coded defer
```

### 3.1 heap-allocated defer

这是较早的通用实现，也常用于动态数量的 defer。

典型场景：

```go
func f(files []string) {
    for _, name := range files {
        file, err := os.Open(name)
        if err != nil {
            continue
        }
        defer file.Close()
    }
}
```

循环里的 defer 数量运行时才知道，编译器通常无法简单展开。此时会走 runtime defer 机制。

简化理解，编译器会在 defer 处插入类似调用：

```go
runtime.deferproc(fn)
```

`runtime.deferproc` 会创建一个 `_defer` 记录，并挂到当前 goroutine 的 defer 链表上。

简化结构：

```go
type _defer struct {
    heap bool
    sp   uintptr
    pc   uintptr
    fn   func()
    link *_defer
}
```

当前 goroutine 中大致有：

```go
gp._defer -> d3 -> d2 -> d1 -> nil
```

后注册的 defer 在链表头部，所以执行时天然是后进先出。

注意：实际实现中 `_defer` 不一定每次都真正堆分配，runtime 会使用 defer pool 复用对象。但从分类上，动态 defer 常被称为 heap-allocated defer，因为 `_defer` 不是当前栈帧里的固定对象。

### 3.2 stack-allocated defer

如果编译器能确定 defer 数量，但又不能使用 open-coded defer，它可以把 `_defer` 记录放在当前函数栈帧里。

简化理解，编译器会生成一个栈上的 `_defer` 对象，然后调用：

```go
runtime.deferprocStack(&d)
```

它也会把 defer 挂到当前 goroutine 的 defer 链表上：

```text
gp._defer -> 当前栈帧上的 _defer -> ...
```

优点是避免了堆分配或 pool 分配，成本比 heap-allocated defer 低。

### 3.3 open-coded defer

Go 1.14 引入了 open-coded defer，这是普通 defer 变快的关键。

对于简单、固定数量的 defer，编译器可以不走 runtime defer 链表，而是把 defer 逻辑直接展开到函数返回路径上。

例如：

```go
func f() {
    defer a()
    defer b()
    return
}
```

可以粗略理解为编译器生成类似代码：

```go
hasA := false
hasB := false

// defer a()
hasA = true

// defer b()
hasB = true

// return 前
if hasB {
    hasB = false
    b()
}
if hasA {
    hasA = false
    a()
}
return
```

真实实现中，编译器会：

- 用栈槽保存 deferred function 和参数；
- 用 bitmask 记录哪些 defer 已经注册；
- 在函数正常 return 路径插入代码，按照 bitmask 逆序执行 defer。

所以普通场景下：

```go
defer file.Close()
```

已经非常便宜，不需要因为老版本中 defer 较慢的印象而过度手写清理逻辑。

但是 open-coded defer 也需要配合 panic。正常 return 时编译器展开即可；如果发生 panic，runtime 仍然要通过编译器生成的元数据找到该栈帧中的 open-coded defer，然后按正确顺序执行。

### 3.4 编译器如何选择三种 defer

编译器选择 defer 实现时，先做函数级判断，再做单条 defer 判断。

可以先记这个决策树：

```go
if 整个函数可以使用 open-coded defer {
    // 这个函数里的 defer 全部 open-coded
    // 不会出现前几个 open-coded、后几个 stack 的混合
} else {
    for 每一条 defer {
        if 这条 defer 可以把 _defer record 放在当前栈帧 {
            stack-allocated defer
        } else {
            heap-allocated defer
        }
    }
}
```

### 3.4.1 open-coded defer 允许的场景

open-coded defer 是函数级优化。只要当前函数满足条件，这个函数里的 defer 都会走 open-coded；只要当前函数被判定为不能 open-coded，这个函数里的 defer 都不会 open-coded。

典型允许场景：

```text
编译优化开启，也就是没有使用 -N
defer 总数 <= 8
所有 defer 都是普通 defer，不需要 deferprocat
所有 defer 都不在循环或回跳结构中
return 出口数量和 defer 数量不至于让展开代码太大
没有 race return instrumentation 这类额外返回插桩冲突
不处在当前编译器暂不支持的特殊平台 / 链接模式组合
返回值布局能被 open-coded defer 的恢复路径处理
```

普通小函数通常可以：

```go
func f() {
    defer a()
    defer b()
}
```

open-coded defer 的实现方式是：

```text
为每条 defer 准备栈槽，保存函数值 / 参数
用 deferBits 记录哪些 defer 已经执行到并注册
在每个 return 出口插入检查 deferBits 并逆序执行 defer 的代码
panic 时 runtime 通过 funcdata 找到 deferBits 和栈槽，执行对应 defer
```

所以它的限制都围绕一件事：编译器能不能用有限的 bit、栈槽、出口代码和 panic 元数据，把这个函数里的 defer 静态展开清楚。

### 3.4.2 为什么 defer 数量不能超过 8

当前 open-coded defer 用一个 `uint8` 风格的 `deferBits` bitmask 记录哪些 defer 已经注册。

```text
bit 0 -> 第 1 条 defer 是否已注册
bit 1 -> 第 2 条 defer 是否已注册
...
bit 7 -> 第 8 条 defer 是否已注册
```

一个 byte 只有 8 个 bit，所以当前实现最多支持 8 条 open-coded defer。

超过 8 个时不是“前 8 个 open-coded，剩下的 stack”，而是：

```text
只要函数中的 defer 总数超过 8 个
    -> 当前函数整体禁止 open-coded defer
    -> 函数里的所有 defer 再按 stack / heap 规则处理
```

例如：

```go
func f() {
    defer a()
    defer a()
    defer a()
    defer a()
    defer a()
    defer a()
    defer a()
    defer a()
    defer a()
}
```

这 9 条 defer 都不会 open-coded。由于它们都不在循环里，通常会全部变成 stack-allocated defer。

### 3.4.3 为什么循环里的 defer 不能 open-coded

open-coded defer 给每条静态 defer 语句准备一个 bit 和一个固定栈槽。它适合“这条 defer 语句最多执行一次”的情况。

条件分支可以：

```go
func f(cond bool) {
    if cond {
        defer a()
    }
}
```

这条 defer 最多注册一次，可以用一个 bit 表示：

```text
0 -> 没执行到 defer
1 -> 已执行到 defer
```

循环不可以：

```go
func f(n int) {
    for i := 0; i < n; i++ {
        defer a()
    }
}
```

同一条 defer 语句可能执行多次：

```text
第 1 次循环 -> defer record 1
第 2 次循环 -> defer record 2
第 3 次循环 -> defer record 3
```

一个 bit 和一个固定栈槽不能表示多个同时活跃的 defer record，所以不能 open-coded。带回跳的 `goto` 形成循环时也是同理。

### 3.4.4 什么是 deferprocat 特殊场景

`deferprocat` 不是普通代码里经常直接接触的东西，它主要来自 range-over-func 的编译器改写。

先看普通循环：

```go
func outer(xs []int) {
    for _, x := range xs {
        defer fmt.Println(x)
    }
}
```

普通 `for` / `range slice` 的循环体本来就在 `outer` 这个函数的栈帧里执行。循环体里的 `defer` 自然就注册到 `outer` 这个函数上，等 `outer` 返回时再执行。

普通 defer 可以理解为：

```go
defer print("A")
```

降低成：

```go
runtime.deferproc(func() { print("A") })
```

但是 range-over-func 不一样。range-over-func 指的是对函数进行 range，例如这个 `f` 本身是一个函数：

```go
func outer(f func(func(int) bool)) {
    for x := range f {
        defer fmt.Println(x)
    }
}
```

它大致会被编译器改写成回调形式：

```go
func outer(f func(func(int) bool)) {
    f(func(x int) bool {
        defer fmt.Println(x)
        return true
    })
}
```

这时问题来了：如果回调里的 `defer` 只是普通 defer，它会挂到这个回调函数上，在每次回调返回时执行。但语言语义要求它表现得像普通 range 循环体里的 defer：注册到外层 `outer` 上，等 `outer` 返回时再执行。

所以编译器会引入一个额外 token，把这些 defer 归到外层函数的 defer 组中：

```go
var #defers = runtime.deferrangefunc()
f(func() {
    runtime.deferprocat(func() { print("A") }, #defers)
})
```

这就是 `DeferAt` / `deferprocat` 这类特殊路径。它需要 runtime 用额外 token 组织 defer record，不是普通的 open-coded 或 `deferprocStack` 路径。

所以 range-over-func 和普通循环的区别是：

```text
普通循环：
    循环体就在当前函数里
    defer 自然挂到当前函数

range-over-func：
    循环体会被改写成回调函数
    defer 不能简单挂到回调函数
    需要 deferprocat 把 defer 归到外层函数的 defer 组
```

### 3.4.5 为什么 return 数量 * defer 数量 > 15 会禁用 open-coded

open-coded defer 要在 return 出口生成执行 defer 的代码。

这里的 `return 数量` 指当前函数里的显式 `return` 语句数量，也就是编译器 IR 中的 `ORETURN` 节点数量。它不是运行时返回多少次，不是调用者数量，也不是 goroutine 退出次数。

例如：

```go
func f(x int) {
    defer a()

    if x < 0 {
        return // 第 1 个显式 return
    }
    if x == 0 {
        return // 第 2 个显式 return
    }
    return // 第 3 个显式 return
}
```

这里 `return 数量` 是 3。

这个函数虽然也会“正常结束”：

```go
func f() {
    defer a()
}
```

但源码中没有显式 `return` 语句，`NumReturns` 不按“函数有一个出口”来理解。

如果有 1 个 return、2 个 defer，展开成本很小：

```text
return 出口 1:
    检查 defer 2
    检查 defer 1
```

如果有 5 个 return、4 个 defer，编译器大致要在多个出口都安排 defer-exit 逻辑：

```text
5 个 return * 4 个 defer = 20 份检查/调用逻辑的规模
```

这会让代码体积明显膨胀。open-coded defer 本来主要是优化小函数的普通 defer，所以当前编译器用了一个启发式限制：

```text
显式 return 数量 * defer 数量 > 15
    -> 放弃 open-coded defer
```

这不是语义上做不到，而是编译器为了控制代码膨胀做的取舍。

### 3.4.6 什么是 return instrumentation 场景

instrumentation 指编译器为了工具功能插入额外代码。

典型是 race detector：

```bash
go test -race
```

开启 race 后，编译器需要在函数进入 / 退出时插入类似 `racefuncenter` / `racefuncexit` 的逻辑，用来让 race detector 正确追踪函数边界和内存访问归属。

open-coded defer 会生成额外的 defer-return 代码段，尤其 recover 后会跳到特殊的返回流程。当前编译器没有在这种额外 defer-return 片段里生成对应的 return instrumentation，所以为了保持 race detector 的正确性，会禁用 open-coded defer。

所以这里不是 defer 语义冲突，而是：

```text
工具插桩需要完整掌控函数返回路径
open-coded defer 会制造额外返回路径
当前编译器不组合这两套机制
```

### 3.4.7 什么是平台 / 链接模式限制

这个限制非常窄。当前源码中特别提到的是：

```text
386 架构
并且使用 shared library 或 dynlink
```

这种模式下，链接器会因为 GOT 等机制在 `deferreturn/ret` 附近插入额外代码。open-coded defer 的 panic/recover 路径需要精确知道 defer-return 相关位置，当前实现没有正确追踪这段额外代码的偏移，所以禁用 open-coded defer。

日常在 amd64 / arm64 上写普通程序，基本不用把这个当成主要判断条件。

### 3.4.8 为什么返回值不在栈上会禁用 open-coded

这里说的不是普通返回值，而是函数的 result parameter 在编译后被放到了堆上。

正常返回时，Go 后端要把返回值放到 ABI 规定的返回位置。open-coded defer 又会引入特殊返回路径，尤其是 recover 后会从 defer-return 位置继续完成返回。

如果某些 result parameter 已经 heap-allocated，返回时还需要额外的 copy-back：

```text
堆上的 result parameter
    -> 拷回返回值槽位 / 栈槽
    -> 再按 ABI 返回给调用者
```

当前 open-coded defer 的额外返回路径不处理这种组合，所以编译器看到有 heap-allocated result parameter 时，会直接禁用 open-coded defer。

这也是实现限制，不是语言语义限制。

### 3.4.9 stack-allocated defer 允许的场景

如果整个函数不能 open-coded，编译器会逐条 defer 判断能不能 stack-allocated。

SSA 生成阶段可以简化为：

```go
if hasOpenDefers {
    openDeferRecord(...)
} else {
    if defer.Esc() == EscNever && defer.DeferAt == nil {
        call runtime.deferprocStack
    } else {
        call runtime.deferproc
    }
}
```

`EscNever && DeferAt == nil` 翻译成人话：

```text
EscNever:
    这条 defer 的 _defer record 可以放在当前函数栈帧

DeferAt == nil:
    这条 defer 是普通 defer，不需要 deferprocat 特殊机制
```

所以 stack-allocated defer 的常见场景是：

```text
整个函数不能 open-coded
但这条 defer 不在循环 / 回跳结构中
也不是 range-over-func deferprocat 特殊 defer
```

例如 9 条普通 defer：

```go
func f() {
    defer a()
    defer b()
    defer c()
    defer d()
    defer e()
    defer f1()
    defer g()
    defer h()
    defer i()
}
```

函数整体因为超过 8 条 defer 不能 open-coded，但每条 defer 都最多执行一次，所以这些 `_defer record` 可以放在当前函数栈帧里，通常是 stack-allocated defer。

再比如 return 出口太多：

```go
func f(x int) {
    defer a()
    defer b()
    defer c()
    defer d()

    if x == 1 { return }
    if x == 2 { return }
    if x == 3 { return }
    if x == 4 { return }
    return
}
```

`return 数量 * defer 数量` 太大，函数不能 open-coded；但 defer 本身是普通非循环 defer，所以通常会 stack-allocated。

### 3.4.10 heap-allocated defer 允许的场景

heap-allocated defer 是最后兜底：

```text
函数不能 open-coded
并且某条 defer 不能 stack-allocated
    -> heap-allocated defer
```

常见场景：

```text
defer 在 for / range 循环中
defer 在带回跳 goto 形成的循环结构中
range-over-func 中需要 deferprocat 的 defer
其他无法把 _defer record 固定放在当前函数栈帧的情况
```

例如：

```go
func f(n int) {
    for i := 0; i < n; i++ {
        defer a()
    }
}
```

同一条 defer 语句可能执行 N 次，每次都要有一个独立 `_defer record`。当前函数栈帧大小是编译期固定的，不能预留运行时才知道的 N 个 record，所以走 heap-allocated defer。

注意：这里的 heap-allocated 说的是 `_defer record` 的存放方式，不等于闭包捕获的变量一定都在堆上。闭包捕获变量是否逃逸，是另一套逃逸分析问题。

### 3.4.11 混合情况

如果函数可以 open-coded，那么这个函数里的 defer 都 open-coded。

如果函数不能 open-coded，那么每条 defer 单独判断 stack 还是 heap，所以可能混合：

```go
func f(n int) {
    defer a() // 非循环，可能 stack

    for i := 0; i < n; i++ {
        defer b() // 循环中，通常 heap
    }
}
```

这里循环里的 defer 会让整个函数不能 open-coded。之后 `defer a()` 可能 stack-allocated，`defer b()` 通常 heap-allocated。

### 3.5 如何观察 defer 类型

可以用编译器 debug 参数查看每个 defer 的实现方式：

```bash
go build -gcflags=-d=defer main.go
```

输出中会看到类似：

```text
open-coded defer
stack-allocated defer
heap-allocated defer
```

例如在 Go 1.25.3 中观察：

```go
func fixedOne() {
    defer a()
}
```

通常输出：

```text
open-coded defer
```

如果一个函数中写 9 个 defer：

```text
stack-allocated defer
stack-allocated defer
...
```

如果 defer 在循环里：

```text
heap-allocated defer
```

实践上可以这样记：

```text
小函数 + 固定少量 defer + return 出口不多
    -> open-coded defer

普通非循环 defer，但因为超过 8 个、return 出口过多等原因不能 open-code
    -> 多数情况下 stack-allocated defer

循环里的 defer / DeferAt 特殊 defer / defer record 不能 EscNever
    -> heap-allocated defer
```

因此“固定数量”只是 open-coded 的必要直觉，不是充分条件；“动态数量”也只是 heap-allocated defer 的常见原因，不是完整定义。真正落到编译器上，open-coded 看函数级限制，stack-vs-heap 看单个 defer 的 `EscNever` 和 `DeferAt`。

## 4. defer 在正常 return 时如何执行

对于非 open-coded defer，编译器会在函数返回路径插入类似：

```go
runtime.deferreturn()
```

`deferreturn` 只负责执行当前函数栈帧中的 defer。

也就是说：

```go
func main() {
    defer fmt.Println("main defer")
    f()
}

func f() {
    defer fmt.Println("f defer")
}
```

`f` 正常返回时，只执行 `f defer`。等 `main` 自己返回时，才执行 `main defer`。

正常 return 不会展开调用栈，它只是当前函数走返回流程。

## 5. panic 的语义

调用：

```go
panic(x)
```

会让当前 goroutine 进入 panic 状态。

panic 后发生的事情：

```text
当前函数停止正常执行
    -> 执行当前函数中已注册的 defer
    -> 如果没人 recover，panic 继续向调用者传播
    -> 调用者也执行自己的 defer
    -> 一路向外展开
    -> 如果最终没人 recover，程序崩溃退出
```

例子：

```go
func main() {
    defer fmt.Println("main defer")
    f()
}

func f() {
    defer fmt.Println("f defer")
    g()
}

func g() {
    defer fmt.Println("g defer")
    panic("boom")
}
```

输出大致是：

```text
g defer
f defer
main defer
panic: boom
```

注意：未恢复的 panic 不是只结束当前 goroutine，而是会导致整个 Go 程序崩溃退出。

## 6. panic 的 runtime 实现

用户写：

```go
panic(x)
```

编译器会调用 runtime：

```go
runtime.gopanic(x)
```

runtime 中有一个 `_panic` 结构，简化后可以理解为：

```go
type _panic struct {
    arg       any
    link      *_panic
    recovered bool

    // 当前正在扫描的栈帧信息
    sp uintptr
    pc uintptr

    // open-coded defer 相关信息
    deferBitsPtr *uint8
    slotsPtr     unsafe.Pointer
}
```

每个 goroutine 中大致有：

```go
gp._panic -> 当前 panic -> 上一个 panic -> nil
gp._defer -> 当前 defer 链表
```

`gopanic` 的核心流程可以粗略写成：

```go
func gopanic(e any) {
    p := _panic{arg: e}
    p.link = gp._panic
    gp._panic = &p

    p.start()
    for {
        fn, ok := p.nextDefer()
        if !ok {
            break
        }
        fn()
    }

    fatalpanic(&p)
}
```

真实代码更复杂，因为涉及栈扫描、调度器、open-coded defer、栈增长、系统栈切换等。但主线就是：

```text
创建 _panic
    -> 挂到当前 goroutine
    -> 找下一个 defer
    -> 执行 defer
    -> 重复
    -> 没有 recover 则 fatalpanic
```

### 6.1 nextDefer 做什么

panic 展开时，runtime 需要找“下一个应该执行的 defer”。

这个逻辑大致在 `nextDefer` 中完成。

它会处理两类 defer：

1. 当前栈帧中的 open-coded defer；
2. 当前 goroutine defer 链表中的 `_defer`。

对 open-coded defer：

```text
读取当前栈帧的 defer bitmask
    -> 找到最高位中仍然有效的 defer
    -> 清掉这一位
    -> 从栈槽中取出函数和参数
    -> 返回该 defer 函数
```

对 runtime defer 链：

```text
查看 gp._defer 链表头
    -> 如果这个 defer 属于当前正在展开的栈帧
    -> 从链表中弹出
    -> 返回该 defer 函数
```

每次执行 defer 前，runtime 都会先把该 defer 标记为已执行，或者从 defer 链中弹出。这样即使 defer 中又发生 panic，也不会重复执行同一个 defer。

## 7. recover 的语义

`recover` 用来停止当前 goroutine 中正在展开的 panic。

它有几个关键限制：

1. 必须在 deferred function 中调用；
2. 必须是由 panic 直接调用的 deferred function 中调用；
3. 只能恢复当前 goroutine 的 panic；
4. recover 成功后，不会回到 panic 发生的位置继续执行。

### 7.1 正确用法

```go
func f() {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recovered:", r)
        }
    }()

    panic("boom")
}
```

### 7.2 直接 deferred function 调用 recover

下面这样可以：

```go
func handleRecover() {
    if r := recover(); r != nil {
        fmt.Println("recovered:", r)
    }
}

func f() {
    defer handleRecover()
    panic("boom")
}
```

因为 `handleRecover` 本身就是被 panic 直接调用的 deferred function。

下面这样不行：

```go
func handleRecover() {
    recover()
}

func f() {
    defer func() {
        handleRecover()
    }()

    panic("boom")
}
```

因为真正被 panic 直接调用的是外层匿名 deferred function，而 `recover` 发生在它内部再次调用的 `handleRecover` 中。此时 `recover` 不满足直接调用条件，返回 `nil`，panic 继续传播。

## 8. recover 的 runtime 实现

用户写：

```go
recover()
```

编译器会调用：

```go
runtime.gorecover()
```

`gorecover` 会检查当前 goroutine 中是否存在正在处理的 panic：

```go
p := gp._panic
```

然后还会检查调用关系，确认当前 recover 是否发生在“panic 正在直接调用的 deferred function”中。

如果条件不满足：

```go
return nil
```

如果条件满足：

```go
p.recovered = true
return p.arg
```

也就是说，`recover` 本身做的事情很少：

- 返回 panic 参数；
- 把当前 `_panic` 标记为 recovered。

真正复杂的是：deferred function 返回后，runtime 看到 `p.recovered = true`，要把程序控制流恢复到正确的位置。

## 9. recover 成功后到底继续执行什么

这是最容易误解的点。

recover 成功后：

- 当前 deferred function 会继续执行完；
- 当前 panic 停止继续向外传播；
- runtime 会跳回“注册该 defer 的函数”的返回流程；
- 该函数中还没执行的 defer 会继续执行；
- 该函数正常返回给调用者；
- goroutine 不会结束，而是继续执行调用者后面的代码。

不是：

```text
recover 后执行所有 defer，然后结束 goroutine
```

而是：

```text
recover 后停止当前 panic
    -> 执行恢复点函数中剩余的 defer
    -> 该函数正常返回
    -> 调用者继续执行
```

看例子：

```go
func main() {
    fmt.Println("main begin")
    f()
    fmt.Println("main after f")
}

func f() {
    defer fmt.Println("f defer 1")

    defer func() {
        fmt.Println("f defer 2 begin")
        r := recover()
        fmt.Println("recover:", r)
        fmt.Println("f defer 2 end")
    }()

    defer fmt.Println("f defer 3")

    g()

    fmt.Println("f after g")
}

func g() {
    defer fmt.Println("g defer 1")
    panic("boom")
}
```

输出：

```text
main begin
g defer 1
f defer 3
f defer 2 begin
recover: boom
f defer 2 end
f defer 1
main after f
```

逐步分析：

```text
g panic
    -> 执行 g defer 1
    -> panic 传播到 f

f 中 defer 按 LIFO 执行
    -> 先执行 f defer 3
    -> 再执行 f defer 2
    -> f defer 2 中 recover 成功
    -> f defer 2 自己继续执行完

runtime 发现 panic 已 recovered
    -> 不再继续向 main 传播
    -> 跳回 f 的 deferreturn 流程
    -> 执行 f defer 1
    -> f 正常返回

main 继续执行
    -> 打印 main after f
```

其中：

- `f after g` 不会执行；
- `main after f` 会执行；
- goroutine 没有结束。

### 9.1 为什么 f after g 不会执行

因为 panic 发生后，`g()` 这次调用已经不是“正常返回”。

recover 成功后，runtime 恢复的是包含 recover 的函数 `f` 的返回流程，而不是恢复到 panic 发生的那一行，也不是恢复到 `g()` 调用之后。

可以理解为：

```text
panic 之后，g() 以下的普通执行路径已经被放弃
recover 只是让 f 不再继续向外 panic，而是正常返回
```

### 9.2 为什么 f defer 1 还会执行

因为 `f defer 1` 是 `f` 中尚未执行的 defer。

recover 成功后，runtime 会安排程序回到 `f` 的 defer-return 位置。`f` 仍然要完成自己的返回流程，因此剩余 defer 继续执行。

## 10. recover 与 goroutine

recover 只能恢复同一个 goroutine 中的 panic。

这个抓不到：

```go
func main() {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recover:", r)
        }
    }()

    go func() {
        panic("boom")
    }()

    time.Sleep(time.Second)
}
```

外层 defer 属于 main goroutine，新启动的 goroutine 有自己的调用栈、自己的 defer 链、自己的 panic 链。

正确兜底方式：

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("panic: %v\n%s", r, debug.Stack())
        }
    }()

    work()
}()
```

## 11. 常见注意点

### 11.1 不要用 panic 代替 error

普通可预期错误应该返回 error：

```go
if err != nil {
    return err
}
```

不要写成：

```go
if err != nil {
    panic(err)
}
```

`panic` 更适合：

- 程序员错误；
- 不变量被破坏；
- 初始化失败且程序无法继续；
- `MustXxx` 风格函数；
- 包内部深层控制流，但对外边界转成 error；
- goroutine / HTTP middleware / job runner 的顶层兜底。

### 11.2 循环中 defer 要谨慎

不要在大循环中随手写：

```go
for _, name := range files {
    f, err := os.Open(name)
    if err != nil {
        return err
    }
    defer f.Close()
}
```

这些文件会等整个外层函数返回时才关闭，而不是每轮循环结束关闭。

更好的方式：

```go
for _, name := range files {
    if err := processFile(name); err != nil {
        return err
    }
}

func processFile(name string) error {
    f, err := os.Open(name)
    if err != nil {
        return err
    }
    defer f.Close()

    // process file
    return nil
}
```

### 11.3 os.Exit 不会执行 defer

```go
func main() {
    defer fmt.Println("bye")
    os.Exit(1)
}
```

不会输出：

```text
bye
```

因为 `os.Exit` 直接终止进程，不走 Go 函数返回流程，也不会触发 defer。

### 11.4 recover 不要静默吞 panic

不推荐：

```go
defer func() {
    recover()
}()
```

至少应该记录 panic 值和堆栈：

```go
defer func() {
    if r := recover(); r != nil {
        log.Printf("panic: %v\n%s", r, debug.Stack())
    }
}()
```

### 11.5 panic(nil) 不推荐

很多代码会用：

```go
if r := recover(); r != nil {
    // handle panic
}
```

`panic(nil)` 会让语义变得混乱。实际工程中不要这样写。

## 12. 一个完整的心智模型

正常 return：

```text
函数准备返回
    -> 执行当前函数中已注册的 defer，LIFO
    -> 函数真正返回
```

panic 且无人 recover：

```text
当前 goroutine panic
    -> 执行当前函数 defer
    -> 展开到调用者
    -> 执行调用者 defer
    -> 一路向外
    -> 没有 recover
    -> fatalpanic
    -> 打印 panic 和堆栈
    -> 程序退出
```

panic 被 recover：

```text
当前 goroutine panic
    -> 执行沿途 defer
    -> 某个 deferred function 直接调用 recover
    -> 当前 panic 标记为 recovered
    -> 这个 deferred function 继续执行完
    -> runtime 停止 panic 展开
    -> 回到包含该 defer 的函数的返回流程
    -> 执行该函数剩余 defer
    -> 该函数正常返回
    -> 调用者继续执行
```

一句话总结：

> recover 不是让代码回到 panic 的位置继续跑，而是让包含 recover defer 的那个函数完成 defer-return 流程并正常返回。

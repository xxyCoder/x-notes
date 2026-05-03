## 1. 先记住核心问题

Go 程序里可以创建很多 goroutine：

```go
go f()
go g()
go h()
```

goroutine 可以有成千上万个，但 CPU 核心和操作系统线程是有限的。

Go runtime 要解决的问题是：

```text
如何把大量 goroutine，高效地分配到少量 OS 线程上执行。
```

GMP 就是 Go runtime 的调度模型。

```text
G = goroutine，要执行的任务和执行上下文。
M = machine，操作系统线程，真正执行机器指令。
P = processor，Go runtime 的调度上下文和本地资源。
```

一句话：

```text
M 执行代码，G 提供代码和栈，P 提供调度队列和运行 Go 代码需要的本地资源。
```

## 2. G、M、P 分别是什么

### 2.1 G：goroutine 的运行上下文

`G` 不是函数本身，而是 runtime 对 goroutine 的描述。

它里面大致有：

```text
要执行的函数入口
goroutine 栈
pc/sp 等调度现场
当前状态
等待原因
绑定的 M
defer / panic 链
```

源码结构里典型字段：

```go
type g struct {
    stack       stack
    m           *m
    sched       gobuf
    atomicstatus atomic.Uint32
    waitreason  waitReason
    startpc     uintptr
}
```

`g.sched` 很关键，里面保存的是 goroutine 被切换时的执行现场，比如 `pc`、`sp`。

所以调度 G，本质不是“调用一个函数”这么简单，而是：

```text
切换到这个 G 保存的栈和 pc/sp，让它从之前的位置继续执行。
```

### 2.2 M：操作系统线程

`M` 对应 OS thread。

真正执行指令的是 M。

runtime 调度代码也是 M 执行的，一般运行在当前 M 的 `g0` 栈上。

典型字段：

```go
type m struct {
    g0    *g
    curg  *g
    p     puintptr
    nextp puintptr
    oldp  puintptr
}
```

几个字段的意思：

```text
m.g0    当前 M 专门用于执行 runtime 调度逻辑的 goroutine
m.curg  当前 M 正在执行的用户 G
m.p     当前 M 绑定的 P
m.nextp 即将交给这个 M 的 P
m.oldp  syscall 前原来绑定的 P
```

### 2.3 P：调度上下文，不是执行者

`P` 不是线程，不执行代码。

P 没有自己的：

```text
栈
pc
sp
寄存器现场
执行入口
```

所以严格说：

```text
P 不运行。
M 才运行。
调度代码也是 M 在运行。
```

P 是 runtime 的数据结构，保存调度和运行 Go 代码所需的本地资源。

典型字段：

```go
type p struct {
    id     int32
    status uint32
    m      muintptr

    runqhead uint32
    runqtail uint32
    runq     [256]guintptr
    runnext  guintptr

    mcache *mcache
    gcw    gcWork
}
```

P 主要保存：

```text
本地 goroutine 队列
runnext 快速通道
内存分配缓存 mcache
timer
GC work 缓存
一些 runtime 本地缓存
```

所以更准确的说法是：

```text
M 绑定 P 后，使用 P 的调度队列和本地资源来执行 G。
```

不是：

```text
P 运行 G
```

而是：

```text
M 使用 P 选择 G，然后 M 执行 G。
```

## 3. M 和 P 的真实绑定

口语里常说：

```text
M 拿到 P
```

这个说法不是虚假概念，源码里确实有绑定字段。

绑定 P 时大致是：

```go
m.p = p
p.m = m
p.status = _Prunning
```

释放 P 时反过来：

```go
m.p = nil
p.m = nil
p.status = _Pidle
```

所以真实关系是：

```text
M.p  <-> P.m
M.curg <-> G.m
P.runq / P.runnext 存待运行的 G
```

`GOMAXPROCS` 控制的是 P 的数量：

```text
P 的数量 = 同时执行 Go 代码的最大并行度
```

注意：

```text
GOMAXPROCS 不是 goroutine 数量。
GOMAXPROCS 也不是 OS thread 数量。
```

M 可以比 P 多，比如 syscall、cgo、`runtime.LockOSThread` 都可能让 M 增多。

但同一时刻真正执行 Go 代码的 M 数量，最多不超过 P 的数量。

## 4. 为什么需要 P

先假设没有 P，只有 G 和 M。

最简单模型是：

```text
所有 runnable G -> 一个全局队列 -> 多个 M 抢着取 G 执行
```

这能工作，但有严重问题：

```text
所有 M 都抢同一个全局队列
全局锁竞争很重
缓存局部性差
调度成本高
```

所以 Go 引入 P。

每个 P 有自己的本地队列：

```text
P1.runq
P2.runq
P3.runq
P4.runq
```

M 绑定 P 后，优先从当前 P 的本地队列取 G。

这样大多数调度都发生在本地：

```text
M1 + P1 -> P1.runq
M2 + P2 -> P2.runq
M3 + P3 -> P3.runq
```

好处：

```text
减少全局锁竞争
提高缓存局部性
让调度更快
把一个全局热点拆成多个本地队列
```

## 5. 为什么既有本地队列，又有全局队列

本地队列负责性能。

全局队列负责兜底和公平。

如果只有全局队列：

```text
所有 M 抢一个队列，锁竞争重。
```

如果只有本地队列：

```text
某些 P 可能很忙，某些 P 可能没活。
某些 G 可能没有合适的本地 P 可放。
本地队列满了也需要溢出位置。
全局 runnable G 可能长期没人处理。
```

所以两者分工是：

```text
本地队列：日常主力，快，少锁。
全局队列：兜底，协调，公平。
```

比如：

```text
P1.runq 很多 G
P2.runq 空了
```

P2 对应的 M 不会直接睡觉，它会尝试：

```text
看全局队列
从其他 P 偷 G
```

这就是局部和全局同时存在的原因。

## 6. runnext 和 runq

每个 P 里有两个重要位置：

```go
runnext guintptr
runq    [256]guintptr
```

`runq` 是普通本地队列。

`runnext` 是单槽位的快速通道。

取 G 时通常优先：

```text
P.runnext -> P.runq
```

`runnext` 的作用是降低协作型 goroutine 的调度延迟。

比如当前 G 唤醒了另一个 G，runtime 希望被唤醒的 G 尽快接着跑，就可能把它放到 `runnext`。

为什么 `runnext` 只能放一个？

因为它不是队列，而是一次优先运行机会。

如果 `runnext` 能放很多个，就变成了第二个高优先级队列，容易导致一批互相唤醒的 G 长期插队，影响公平性。

如果多个 G 同时就绪：

```text
一个可能进入 runnext
其他进入 P.runq
P.runq 满了，再溢出到 global runq
```

如果 `runnext` 已经有 G，又来了一个新的 `runnext`：

```text
新的放入 runnext
旧的被挤到普通 runq
```

所以可以这样理解：

```text
runnext 解决低延迟。
runq 解决常规排队。
global runq 解决兜底和公平。
```

## 7. goroutine 创建后怎么入队

执行：

```go
go f()
```

runtime 会创建一个新的 G，并把它设置为 runnable：

```text
_Gdead / 新分配 -> _Grunnable
```

然后优先放到当前 P：

```text
优先尝试 P.runnext
否则放 P.runq
如果 P.runq 满了，部分 G 转移到 global runq
```

为什么新 G 优先放当前 P？

```text
不用抢全局锁
创建者和新 G 可能有数据关联，缓存局部性更好
调度延迟低
```

如果当前没有足够的 M 在工作，runtime 还会尝试唤醒或创建 M 来处理 runnable G。

## 8. 调度算法内部流程

调度的核心不是一个单纯的 FIFO 队列，而是一组策略：

```text
本地优先
全局兜底
周期性公平检查
netpoll 唤醒 IO goroutine
work stealing 负载均衡
有限 spinning 降低唤醒延迟
无活时休眠避免空转
```

### 8.1 当前 G 为什么会进入调度

当前 G 可能因为这些原因停下来：

```text
函数执行结束
channel 阻塞
mutex 阻塞
time.Sleep
syscall
主动 Gosched
被抢占
panic 退出
```

当前 G 停下后，M 不会继续在用户 G 的栈上调度。

M 会切到自己的 `g0` 栈：

```text
用户 G 栈 -> M.g0 栈 -> runtime 调度逻辑
```

原因是：

```text
调度器属于 runtime，不应该依赖用户 G 的栈空间和状态。
g0 是每个 M 专门用于 runtime 调度、系统调用、栈管理等工作的栈。
```

### 8.2 找下一个 G 的大致顺序

假设当前 M 已经绑定了 P：

```text
M.p = P
P.m = M
```

接下来 M 在 g0 栈上使用当前 P 找下一个 runnable G。

大致流程：

```text
1. 处理 runtime 内部任务
2. 偶尔检查 global runq
3. 检查 P.runnext
4. 检查 P.runq
5. 检查 global runq
6. 检查 netpoll
7. 从其他 P 偷 G
8. 实在没活，释放 P，M 休眠
```

### 8.3 为什么先处理 runtime 内部任务

调度器会先关注一些 runtime 任务：

```text
GC 是否需要 stop
safe point
timer 是否到期
GC worker
trace reader
```

原因：

```text
这些任务关系到 runtime 的正确性和整体进度。
如果 GC、安全点、timer 长期得不到处理，程序行为会出问题。
```

### 8.4 为什么偶尔检查 global runq

调度器不是每次都先查全局队列。

因为全局队列需要锁，频繁访问会增加竞争。

但也不能永远不查，否则可能出现：

```text
当前 P 本地队列一直有 G
global runq 里的 G 长期没人执行
```

所以 runtime 会周期性检查 global runq，保证公平。

可以理解为：

```text
本地优先是为了性能。
偶尔查全局是为了防止饿死。
```

### 8.5 为什么先查 P.runnext

`runnext` 是优先运行位。

它通常表示：

```text
当前 G 刚唤醒或创建的一个 G，适合马上接着跑。
```

比如两个 goroutine 通过 channel 频繁协作：

```text
G1 唤醒 G2
G2 立刻运行
```

这样可以减少调度延迟，提高通信链路的吞吐。

### 8.6 为什么再查 P.runq

本地 `runq` 是最常见的调度来源。

原因：

```text
访问快
锁竞争低
缓存局部性好
```

这也是引入 P 的主要收益。

### 8.7 为什么还要查 global runq

如果本地没有 G，就查全局队列。

从全局队列取 G 时，runtime 通常不只是取一个，而是：

```text
取一个马上执行
再批量拿一部分放到当前 P.runq
```

原因：

```text
减少反复抢全局锁的次数
给当前 P 补充本地任务
提高后续调度效率
```

### 8.8 netpoll 在调度里做什么

很多 Go 程序是 IO 密集型，比如网络服务。

当 goroutine 执行网络读写时：

```go
conn.Read(buf)
```

如果数据没准备好，G 会阻塞，但不一定占着 M 一直等。

runtime 会把 fd 交给 netpoll。

等内核通知 fd 就绪后，netpoll 能找到对应的 G，把它重新变成 runnable。

调度器检查 netpoll 的原因是：

```text
IO ready 的 G 应该尽快回到运行队列。
否则网络服务延迟会变高。
```

### 8.9 work stealing 为什么存在

如果当前 P 没活，但其他 P 很忙：

```text
P1.runq 空
P2.runq 很多 G
P3.runq 很多 G
```

P1 对应的 M 不能直接闲着。

它会尝试从其他 P 的本地队列偷一部分 G。

这叫 work stealing。

目的：

```text
负载均衡
避免某些 P 忙，某些 P 闲
提高 CPU 利用率
```

一般不是只偷一个，而是偷一部分。

原因：

```text
偷任务本身也有成本。
一次偷一批，可以减少频繁偷任务的开销。
```

### 8.10 没有 G 时为什么 M 要休眠

如果：

```text
本地没有
全局没有
netpoll 没有
偷也偷不到
```

M 会释放 P，然后自己休眠。

原因：

```text
不能一直空转找任务，否则会浪费 CPU。
```

但 runtime 也不会简单地让所有 M 都睡死。

它会保留有限的 spinning M。

spinning M 的作用是：

```text
短时间内主动找活，减少新任务到来时的唤醒延迟。
```

但是 spinning M 数量会受限制。

原因：

```text
太多 spinning M 会浪费 CPU。
太少 spinning M 会增加任务唤醒延迟。
```

所以这里是一个折中：

```text
少量空转换取低延迟。
大量无活时及时休眠省 CPU。
```

## 9. 找到 G 后如何真正执行

调度器找到一个 runnable G 后，会建立 M 和 G 的关系：

```text
M.curg = G
G.m = M
G.status = _Grunning
```

然后切换到 G 的执行现场：

```text
gogo(&G.sched)
```

`G.sched` 里保存了这个 G 的 `pc/sp` 等信息。

所以执行过程是：

```text
M 在 g0 栈上执行调度逻辑
        ↓
找到 runnable G
        ↓
设置 M.curg / G.m
        ↓
切换到 G 的栈和 pc/sp
        ↓
M 开始执行用户 Go 代码
```

这就是为什么说：

```text
P 不运行代码。
M 用 P 找 G。
M 切到 G 的上下文执行代码。
```

## 10. 阻塞时 GMP 怎么变化

### 10.1 channel / mutex / sleep 阻塞

普通 runtime 可感知的阻塞，比如：

```go
<-ch
mu.Lock()
time.Sleep(time.Second)
```

大致行为：

```text
当前 G -> _Gwaiting
M.curg 清空
M 继续持有 P
M 继续调度其他 G
```

也就是说：

```text
G 阻塞，不代表 M 阻塞。
```

这是 goroutine 高并发的关键。

### 10.2 syscall 阻塞

系统调用可能让 OS thread 进入内核并阻塞。

这时 M 可能真的卡住。

如果 M 卡住时还占着 P，会导致 P 上其他 G 没法运行。

所以 runtime 会让 M 进入 syscall 前交出 P：

```text
M 带着 G 进入 syscall
P 从 M 上摘下来
P 可以交给其他 M 继续调度 G
```

源码字段上可以理解为：

```text
M.oldp = P
M.p = nil
P.m = nil
P.status = _Psyscall
```

syscall 返回后：

```text
M 尝试重新拿回 oldp
拿不到就尝试拿其他 idle P
还拿不到，就把 G 放回 runnable 队列，M 休眠
```

这解释了为什么：

```text
M 数量可能大于 P 数量。
```

因为有些 M 可能阻塞在 syscall/cgo 里，runtime 需要其他 M 绑定 P 来继续执行 Go 代码。

## 11. 抢占和公平性

Go 调度不是严格 FIFO。

原因：

```text
runnext 会插队
本地队列优先
全局队列只是周期性检查
work stealing 有随机性
netpoll 就绪也会插入调度
```

所以不要依赖 goroutine 的执行顺序。

比如：

```go
go f1()
go f2()
```

不保证：

```text
f1 先执行
f1 先完成
f2 后执行
```

Go runtime 还会通过抢占避免某个 G 长时间霸占 M/P。

抢占的目的：

```text
防止长时间运行的 G 饿死其他 G
帮助 GC 到达安全点
提高整体公平性
```

## 12. 从数据结构和算法看注意点

### 12.1 G 多不等于并行多

可以创建很多 G，但真正同时执行 Go 代码的并行度受 P 限制：

```text
并行执行 Go 代码的上限 ≈ GOMAXPROCS
```

大量 goroutine 大多数时候是在：

```text
等待
排队
阻塞
被调度
```

### 12.2 M 多不代表 Go 代码并行度更高

M 是 OS 线程。

M 可以因为 syscall/cgo 增多。

但如果没有绑定 P，这个 M 不能执行普通 Go 代码。

```text
M 多 ≠ Go 代码并行度高
P 多才影响 Go 代码并行度上限
```

### 12.3 P 是调度资源，不是 CPU

P 不是 CPU 核。

P 是 runtime 里的调度上下文。

`GOMAXPROCS` 通常设置得接近 CPU 核心数，是为了让 Go 代码并行度和硬件能力匹配。

但概念上：

```text
CPU 核心是硬件。
M 是 OS thread。
P 是 Go runtime 调度资源。
G 是 goroutine。
```

### 12.4 不要依赖调度顺序

由于：

```text
runnext
本地队列
全局队列
netpoll
work stealing
抢占
```

调度顺序不是稳定语义。

如果需要顺序，要自己用：

```text
channel
mutex
WaitGroup
context
atomic
```

### 12.5 goroutine 必须有退出条件

G 一旦进入 waiting，如果没有唤醒条件，就可能永远存在。

比如：

```go
go func() {
    <-ch
}()
```

如果没人发送，也没人关闭 `ch`，这个 G 就泄漏了。

好的 goroutine 应该有明确退出条件：

```go
select {
case v := <-ch:
    _ = v
case <-ctx.Done():
    return
}
```

### 12.6 阻塞类型会影响调度行为

runtime 可感知阻塞：

```text
channel
mutex
timer
netpoll
```

通常是：

```text
G 挂起，M 继续调度其他 G。
```

可能阻塞 OS 线程的操作：

```text
syscall
cgo
LockOSThread 场景
```

可能导致：

```text
M 被占住，P 被交给其他 M。
```

### 12.7 全局队列不是主路径

性能主路径是本地队列。

如果所有调度都走全局队列，就会退化成多线程抢锁。

所以 global runq 的角色更像：

```text
溢出区
公平性兜底
跨 P 协调点
```

### 12.8 runnext 不是公平队列

`runnext` 是低延迟优化。

它只放一个 G，避免形成一条长期插队的高优先级队列。

所以看到某个 G 被很快调度，不代表调度器是 FIFO，也不代表所有就绪 G 都同等优先。

## 13. 完整流程图

```text
当前 G 阻塞 / 结束 / 让出 / 被抢占
        ↓
M 从用户 G 栈切到 M.g0 栈
        ↓
M 在 g0 栈上运行 runtime 调度逻辑
        ↓
M 使用当前绑定的 P 找 runnable G
        ↓
处理 GC / timer / safe point / trace 等 runtime 任务
        ↓
周期性检查 global runq，避免饿死
        ↓
检查 P.runnext
        ↓
检查 P.runq
        ↓
检查 global runq，批量搬一部分到本地
        ↓
检查 netpoll，拿 IO ready 的 G
        ↓
从其他 P 的 runq 偷 G
        ↓
如果还没活，M 释放 P 并休眠
        ↓
如果找到 G：
        M.curg = G
        G.m = M
        G.status = _Grunning
        切到 G.sched 的 pc/sp
        ↓
M 开始执行这个 G 的用户代码
```

## 14. 最终总结

GMP 的核心不是三个名词，而是一套调度分工：

```text
G 保存用户代码的执行上下文。
M 是真正执行代码的 OS 线程。
P 保存本地调度队列和运行 Go 代码需要的 runtime 资源。
```

调度器的核心策略：

```text
本地队列优先：性能好，少锁。
全局队列兜底：公平和协调。
runnext：给一个低延迟插队机会。
netpoll：让 IO ready 的 G 及时回来。
work stealing：让空闲 P 从忙碌 P 那里偷任务。
spinning / sleep：在低延迟和 CPU 浪费之间折中。
```

最准确的一句话：

```text
M 在自己的 g0 栈上执行调度代码，使用绑定的 P 选择 runnable G，然后切换到 G 的栈和 pc/sp 执行用户代码。
```

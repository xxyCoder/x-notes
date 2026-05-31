事件循环可以先理解成一个单线程调度器。它每一轮做三件事：

```text
1. 看有没有马上能执行的回调。
2. 看最近的定时器什么时候到期。
3. 等待 IO 事件，或者不等待，只轮询一下。
```

事件循环内部最核心的三个结构：

```text
ready:
  普通队列。
  保存马上可以执行的回调。

scheduled:
  小根堆。
  保存未来某个时间点要执行的定时器回调。

selector:
  IO 多路复用器。
  等待 socket / fd 变成可读、可写。
```

## 外层循环

事件循环外层大概是这样：

```text
function run_forever():
    mark_loop_as_running()

    while true:
        run_once()

        if stopping:
            break

    cleanup_running_loop()
```

真正关键的是 `run_once()`。

## 一轮 run_once 做什么

源码级别的主流程可以简化成：

```text
function run_once():
    cleanup_cancelled_timers()

    timeout = compute_timeout()

    events = selector.select(timeout)

    process_io_events(events)

    move_due_timers_to_ready()

    ntodo = ready.length()

    repeat ntodo times:
        handle = ready.pop_left()

        if handle.cancelled:
            continue

        handle.run()
```

注意这个顺序：

```text
清理取消的定时器
计算 selector 最多等多久
等待或者轮询 IO
把 IO 事件转成 ready 回调
把到期定时器转成 ready 回调
执行 ready 队列中的一批回调
```

所以 `run_once()` 不是一进来就执行 `ready`。

它会先调用一次 `selector.select(timeout)`。

但这不代表每一轮都会阻塞。

## timeout 规则

`timeout` 决定 `selector.select(timeout)` 最多等多久。

伪代码：

```text
function compute_timeout():
    if ready is not empty:
        return 0

    if stopping:
        return 0

    if scheduled is empty:
        return INFINITE

    delay = scheduled.peek().when - now()

    if delay < 0:
        return 0

    if delay > MAX_SELECT_TIMEOUT:
        return MAX_SELECT_TIMEOUT

    return delay
```

对应规则：

```text
ready 非空:
  timeout = 0
  selector.select(0)
  不阻塞，只快速检查有没有 IO 已经就绪。

ready 为空，但 scheduled 非空:
  timeout = 最近定时器到期时间 - 当前时间
  如果超过 MAX_SELECT_TIMEOUT，则最多只等 MAX_SELECT_TIMEOUT。

ready 为空，scheduled 也为空:
  timeout = INFINITE
  可以一直阻塞，直到有 IO 事件。

事件循环正在 stopping:
  timeout = 0
  不阻塞。
```

所以回答一个核心问题：

```text
每轮都会走 selector.select(timeout)，
但不一定阻塞。

只有 ready 为空时，事件循环才可能真正阻塞等待 IO 或定时器。
```

## ready 队列怎么执行

`run_once()` 不只是从 `ready` 里取一个回调。

它会取一批。

关键点是：

```text
ntodo = ready.length()
```

这个长度是在下面几步之后计算的：

```text
selector.select(timeout)
process_io_events(events)
move_due_timers_to_ready()
```

也就是说，本轮由 IO 和到期定时器产生的 ready 回调，会进入本轮执行。

例子：

```text
一轮开始前:
  ready = [A]
  scheduled = [T 已到期]
  selector 里有 IO 事件 I 已就绪

run_once:
  timeout = 0

  selector.select(0)
    得到 I

  process_io_events(I)
    ready = [A, I]

  move_due_timers_to_ready()
    ready = [A, I, T]

  ntodo = 3

  执行 A
  执行 I
  执行 T
```

但是，如果执行 `A` 的过程中又追加了 `C`：

```text
run A:
  call_soon(C)
```

那么：

```text
ready 原本是 [A, I, T]
ntodo = 3

执行 A:
  ready 变成 [I, T, C]

执行 I:
  ready 变成 [T, C]

执行 T:
  ready 变成 [C]

本轮结束。
```

`C` 不会在本轮继续执行。

它留到下一轮 `run_once()`。

因此，完整规则是：

```text
本轮执行阶段开始之前已经在 ready 中的回调，会在本轮执行。

本轮执行阶段中新增的 ready 回调，不会插队到本轮执行。

它们留到下一轮。
```

## selector 的作用

事件循环自己不负责“完成业务 IO”。

`selector` 只回答一件事：

```text
哪些 fd / socket 已经可读或可写？
```

伪代码：

```text
events = selector.select(timeout)
```

含义：

```text
最多等待 timeout 时间。

如果期间有 IO 就绪，提前返回。

如果 timeout 到了还没有 IO，也返回空列表。

如果 timeout = 0，立即返回。

如果 timeout = INFINITE，可以一直等到有 IO。
```

拿到 IO 事件后，事件循环会把它转成回调：

```text
function process_io_events(events):
    for event in events:
        if event.readable:
            ready.push_back(event.read_callback)

        if event.writable:
            ready.push_back(event.write_callback)
```

所以事件循环只管：

```text
IO 就绪了，把对应回调塞进 ready。
```

真正读写数据，是回调自己做。

## 定时器 scheduled

定时器放在小根堆里。

小根堆顶部永远是最近要到期的定时器。

```text
scheduled.peek()
```

可以拿到最近那个定时器。

新增定时器：

```text
function call_at(when, callback):
    timer = TimerHandle(when, callback)
    scheduled.heap_push(timer)
    return timer
```

每一轮 `run_once()` 中，事件循环会把已经到期的定时器搬到 `ready`：

```text
function move_due_timers_to_ready():
    end_time = now() + clock_resolution

    while scheduled is not empty:
        timer = scheduled.peek()

        if timer.when >= end_time:
            break

        scheduled.heap_pop()
        timer.scheduled = false
        ready.push_back(timer)
```

定时器规则：

```text
定时器到期后，只是进入 ready。

进入 ready 后，还要等 ready 执行阶段轮到它。

所以定时器不保证精确准点执行，只保证不会早于目标时间执行。
```

如果某个回调执行很久：

```text
handle.run() 卡住 10 秒
```

那么这 10 秒里：

```text
事件循环不能处理新的 IO
不能搬运到期定时器
不能执行其他 ready 回调
```

因此定时器可能明显延后。

## handle.run 的重要规则

事件循环是协作式调度，不是抢占式调度。

一旦开始执行：

```text
handle.run()
```

这个回调会一直运行到自己返回。

事件循环不会中途强行打断它。

所以：

```text
handle.run() 执行时间越长，
整个事件循环卡住越久。
```

这是理解事件循环最重要的实战规则之一。

## 为什么 ready 非空时还要 select(0)

如果 `ready` 已经有回调可执行，事件循环仍然会调用：

```text
selector.select(0)
```

这不是阻塞等待。

它只是顺手快速检查：

```text
有没有 IO 已经就绪？
```

如果有，就把 IO 回调也放进 `ready`，并在本轮一起执行。

这样事件循环不会因为已有 `ready` 任务，就完全忽略已经就绪的 IO。

## MAX_SELECT_TIMEOUT 的意义

假设最近的定时器在很久以后：

```text
next_timer.when - now() = 10 days
```

事件循环不会真的一次性睡 10 天。

它会限制：

```text
timeout = min(delay, MAX_SELECT_TIMEOUT)
```

这样做的目的不是提高普通业务性能，而是避免事件循环在底层系统调用里睡得过久。

醒来后会重新计算：

```text
ready 是否有东西？
timer 是否更近？
是否有 stopping？
```

## 一轮循环的完整推演

假设当前状态：

```text
ready = []
scheduled = [T1 三秒后到期]
selector 正在监听 socket S
```

进入 `run_once()`：

```text
ready 为空
scheduled 非空

timeout = 3 秒

selector.select(3)
```

情况一，1 秒后 socket 可读：

```text
selector 提前返回 S readable

process_io_events:
  ready.push(S_read_callback)

move_due_timers_to_ready:
  T1 还没到期，不动

ntodo = 1

执行 S_read_callback

run_once 结束
```

情况二，3 秒内没有 IO：

```text
selector 超时返回空列表

process_io_events:
  什么也不做

move_due_timers_to_ready:
  T1 到期
  ready.push(T1)

ntodo = 1

执行 T1

run_once 结束
```

情况三，进入本轮前 ready 已经有 A：

```text
ready = [A]

timeout = 0

selector.select(0)
  不阻塞，只 poll 一下

如果发现 socket S readable:
  ready = [A, S_read_callback]

如果 T1 也到期:
  ready = [A, S_read_callback, T1]

ntodo = ready.length()

执行这一批 ready 快照
```

## 最终记忆版

```text
事件循环每一轮：

1. 清理取消的定时器。
2. 根据 ready / scheduled / stopping 计算 timeout。
3. 调用 selector.select(timeout)。
4. 把 IO 事件转成 ready 回调。
5. 把到期定时器转成 ready 回调。
6. 记录 ready 当前长度 ntodo。
7. 执行这 ntodo 个回调。
8. 返回外层 run_forever，进入下一轮。
```

最核心的规则：

```text
ready 非空时，不阻塞，select(0)。

ready 为空但有定时器时，最多睡到最近定时器到期，且不超过 MAX_SELECT_TIMEOUT。

ready 为空且没有定时器时，可以一直阻塞等 IO。

run_once 执行的是 ready 的一批快照，不是只执行一个。

执行阶段中新加入 ready 的回调，留到下一轮。

handle.run 不会被事件循环抢占，必须自己返回。

定时器到期只是进入 ready，不代表马上执行。

selector 只判断 IO 是否就绪，不负责完成业务读写。
```

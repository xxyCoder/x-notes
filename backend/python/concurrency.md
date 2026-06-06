# Python asyncio

## 1. 异步语法

Python 异步相关的语言语法：

```python
async def
await
async with
async for
```

asyncio 模块中的函数和类属于 API：

```python
asyncio.run()
asyncio.create_task()
asyncio.gather()
asyncio.TaskGroup()
asyncio.as_completed()
asyncio.wait()
asyncio.sleep()
asyncio.timeout()
asyncio.wait_for()
asyncio.shield()
asyncio.to_thread()
asyncio.Queue()
asyncio.Semaphore()
asyncio.Lock()
asyncio.Event()
```

## 2. async def

`async def` 定义协程函数。

```python
async def f():
    return 1
```

调用协程函数不会立刻执行函数体。

```python
coro = f()
```

此时 `coro` 是一个 coroutine object。

```text
async def f(): ...

f() 产生 coroutine object
f() 本身不执行函数体
```

协程要被推进，常见方式有两种：

```python
result = await f()
```

或者：

```python
task = asyncio.create_task(f())
result = await task
```

例子：

```python
import asyncio

async def f():
    print("run f")
    return 1

async def main():
    coro = f()
    print(coro)

    result = await coro
    print(result)

asyncio.run(main())
```

执行到 `await coro` 时，`f()` 的函数体才会被推进。

## 3. await

语法：

```python
result = await awaitable
```

`await` 后面必须是 awaitable。

常见 awaitable：

```text
coroutine
Task
Future
```

`await` 的行为：

```text
1. 如果 awaitable 还没完成，当前协程挂起。
2. 当前协程把控制权还给事件循环。
3. 事件循环可以推进其他任务。
4. awaitable 完成后，当前协程从 await 位置恢复。
5. await 表达式返回结果，或者重新抛出异常。
```

示例：

```python
import asyncio

async def f():
    await asyncio.sleep(1)
    return 1

async def main():
    x = await f()
    print(x)

asyncio.run(main())
```

`await` 是挂起当前协程，不是阻塞线程。

挂起：

```python
await asyncio.sleep(1)
```

含义：

```text
当前协程暂停。
事件循环继续运行。
其他任务可以被推进。
```

阻塞：

```python
time.sleep(1)
```

含义：

```text
当前线程被卡住。
事件循环无法继续运行。
其他任务无法被推进。
```

异步函数中应避免同步阻塞调用：

```python
time.sleep()
requests.get()
同步数据库查询
长时间 CPU 循环
同步大文件读写
```

如果必须调用同步阻塞函数，可以放到线程中：

```python
result = await asyncio.to_thread(blocking_func, arg1, arg2)
```

## 4. async with

语法：

```python
async with expr as value:
    body
```

作用：

```text
管理异步资源的进入和退出。
```

语义展开：

```python
manager = expr
value = await manager.__aenter__()

try:
    body
finally:
    await manager.__aexit__(...)
```

普通 `with` 调用同步的 `__enter__` / `__exit__`。

`async with` 调用异步的 `__aenter__` / `__aexit__`。

典型用途：

```text
异步锁
异步 HTTP 客户端
异步数据库连接
异步事务
异步连接池
```

例子：异步锁。

```python
import asyncio

lock = asyncio.Lock()

async def update():
    async with lock:
        await do_update()
```

等价结构：

```python
await lock.acquire()

try:
    await do_update()
finally:
    lock.release()
```

`async with` 的价值：

```text
进入资源时可以 await。
退出资源时可以 await。
异常发生时仍能执行退出逻辑。
```

例子：异步 HTTP 客户端。

```python
import httpx

async def fetch(url):
    async with httpx.AsyncClient() as client:
        response = await client.get(url)
        return response.text
```

这里的 `async with` 通常负责连接池的初始化和关闭。

## 5. async for

语法：

```python
async for item in async_iterable:
    body
```

作用：

```text
从异步迭代器中逐个获取元素。
每次获取下一个元素时都可以 await。
```

语义展开：

```python
iterator = async_iterable.__aiter__()

while True:
    try:
        item = await iterator.__anext__()
    except StopAsyncIteration:
        break

    body
```

普通 `for`：

```python
for item in iterable:
    ...
```

要求每次取值是同步的。

`async for`：

```python
async for item in async_iterable:
    ...
```

允许每次取值时异步等待。

典型用途：

```text
WebSocket 持续接收消息
消息队列持续消费消息
数据库 cursor 异步逐行返回
异步文件流分块读取
分页接口流式拉取数据
```

例子：

```python
async for message in websocket:
    print(message)
```

含义：

```text
等待下一条消息。
拿到消息后执行循环体。
继续等待下一条消息。
```

异步迭代器示例：

```python
import asyncio

class AsyncCounter:
    def __init__(self, limit):
        self.current = 0
        self.limit = limit

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self.current >= self.limit:
            raise StopAsyncIteration

        await asyncio.sleep(1)
        self.current += 1
        return self.current

async def main():
    async for x in AsyncCounter(3):
        print(x)

asyncio.run(main())
```

输出间隔大约 1 秒：

```text
1
2
3
```

异步生成器：

```python
import asyncio

async def ticker():
    for i in range(3):
        await asyncio.sleep(1)
        yield i

async def main():
    async for x in ticker():
        print(x)

asyncio.run(main())
```

含义：

```text
async def 中可以使用 yield。
这种函数返回 async generator。
async generator 用 async for 消费。
每次 yield 之前都可以 await。
```

## 6. 协程、Future、Task

### coroutine

coroutine 是协程对象。

```python
async def f():
    return 1

coro = f()
```

`coro` 保存了一段可以暂停和恢复的计算。

它不是最终结果。

它需要被事件循环推进。

### Future

Future 是未来结果的容器。

它的核心状态：

```text
PENDING
FINISHED
CANCELLED
```

它的核心方法：

```python
future.done()
future.result()
future.exception()
future.cancel()
future.add_done_callback(callback)
```

概念模型：

```text
Future 表示一个还没完成、将来会完成的结果。
```

### Task

Task 是 Future 的子类。

```text
Task = 包装 coroutine 并负责推进它的 Future
```

概念上：

```python
class Task(Future):
    ...
```

Task 既是 Future，所以可以被 `await`。

Task 又包着 coroutine，所以事件循环可以推进它。

## 7. 事件循环

事件循环可以理解成单线程调度器。

它维护三类核心东西：

```text
ready:
  已经可以马上执行的回调队列。

scheduled:
  定时器队列。
  例如 asyncio.sleep() 对应的唤醒时间。

selector:
  IO 多路复用器。
  等待 socket / fd 变成可读或可写。
```

事件循环每一轮大致流程：

```text
1. 计算 selector 最多等待多久。
2. 等待 IO 事件，或者快速轮询。
3. 把就绪 IO 转成 ready 回调。
4. 把到期定时器转成 ready 回调。
5. 执行 ready 队列中的一批回调。
```

事件循环推进 Task 的过程：

```text
1. Task 推进内部 coroutine。
2. coroutine 运行到 await。
3. 如果 awaitable 未完成，coroutine 挂起。
4. Task 记录自己正在等待的 awaitable。
5. awaitable 完成后，Task 被重新放回 ready 队列。
6. 事件循环之后继续推进这个 Task。
```

## 8. asyncio.run

用法：

```python
asyncio.run(main())
```

作用：

```text
创建事件循环。
运行入口协程。
等待入口协程结束。
清理异步生成器。
关闭默认 executor。
关闭事件循环。
返回入口协程的结果。
```

例子：

```python
import asyncio

async def main():
    return 123

result = asyncio.run(main())
print(result)
```

输出：

```text
123
```

通常一个脚本只调用一次 `asyncio.run()`。

在已经有事件循环运行的环境中不能再调用它。

例如 Jupyter 中通常直接：

```python
await main()
```

## 9. asyncio.sleep

形态：

```python
await asyncio.sleep(seconds)
```

作用：

```text
让当前协程挂起一段时间。
把控制权还给事件循环。
让事件循环可以推进其他任务。
```

例子：

```python
import asyncio

async def job(name):
    print(name, "start")
    await asyncio.sleep(1)
    print(name, "end")

async def main():
    await asyncio.gather(
        job("A"),
        job("B"),
    )

asyncio.run(main())
```

使用场景：

```text
定时等待。
测试异步调度。
轮询之间暂停。
在示例中模拟 IO 等待。
```

注意：

```text
asyncio.sleep() 不阻塞线程。
time.sleep() 会阻塞线程。
async 函数中通常应该用 await asyncio.sleep()。
```

`await asyncio.sleep(0)` 的含义：

```text
主动让出一次控制权。
让事件循环有机会推进其他 ready 任务。
```

## 10. asyncio.create_task

用法：

```python
task = asyncio.create_task(coro)
```

作用：

```text
把 coroutine 包装成 Task。
把 Task 注册到当前运行的事件循环。
让它具备被事件循环调度推进的资格。
```

例子：

```python
task = asyncio.create_task(f())
```

此时 `f()` 产生的 coroutine 被包装成 Task。

Task 之后会被事件循环推进。

创建 Task 后要管理它的生命周期。

常见方式：

```python
task = asyncio.create_task(work())
result = await task
```

不要随手创建无人管理的后台任务：

```python
asyncio.create_task(work())
```

这种写法容易导致：

```text
任务异常无人处理。
程序退出时任务被取消。
资源清理不完整。
```

## 11. create_task 后为什么能并发推进

例子：

```python
import asyncio

async def job(name):
    print(name, "start")
    await asyncio.sleep(1)
    print(name, "end")
    return name

async def main():
    task_a = asyncio.create_task(job("A"))
    task_b = asyncio.create_task(job("B"))

    result_a = await task_a
    result_b = await task_b

    print(result_a, result_b)

asyncio.run(main())
```

执行过程：

```text
main 创建 task_a。
main 创建 task_b。

main 执行 await task_a。
main 挂起，等待 task_a 完成。

事件循环推进 task_a。
task_a 打印 A start。
task_a 执行 await asyncio.sleep(1)。
task_a 挂起，登记 1 秒后的定时器。

事件循环推进 task_b。
task_b 打印 B start。
task_b 执行 await asyncio.sleep(1)。
task_b 挂起，登记 1 秒后的定时器。

1 秒后，两个 sleep 到期。
task_a 和 task_b 会再次变成可推进状态。

事件循环恢复 task_a。
task_a 打印 A end，完成。

main 等待的 task_a 完成，main 恢复。
main 执行 await task_b。

如果 task_b 已经完成，马上取得结果。
如果 task_b 还没完成，main 继续挂起。
```

准确表述：

```text
多个 Task 在 await 挂起点之间交替推进。
等待时间可以重叠。
单线程事件循环里，同一瞬间只执行一段 Python 代码。
```

不准确表述：

```text
A 阻塞了，所以调用 B。
```

正确表述：

```text
A 遇到 await 后挂起，事件循环有机会推进 B。
```

如果 A 执行同步阻塞代码：

```python
import time

async def job(name):
    print(name, "start")
    time.sleep(1)
    print(name, "end")
```

那么事件循环被卡住，B 不能在这 1 秒内被推进。

## 12. 并发、并行、阻塞、挂起

asyncio 的并发模型：

```text
单线程协作式并发。
```

单线程：

```text
同一时刻只执行一段 Python 代码。
```

协作式：

```text
协程必须运行到 await，才会让出控制权。
```

并发：

```text
多个任务的等待时间可以重叠。
```

并行：

```text
多个任务在多个 CPU 核上同时执行。
```

asyncio 默认不是 CPU 并行工具。

适合 asyncio 的场景：

```text
HTTP 请求
数据库请求
Redis 请求
WebSocket
消息队列
定时任务
高并发 socket
爬虫
```

不适合直接放进事件循环的场景：

```text
大量 CPU 计算
图像处理
视频编码
机器学习推理
长时间纯 Python 循环
同步阻塞 I/O
```

## 13. asyncio.gather

用法：

```python
results = await asyncio.gather(
    coro1,
    coro2,
    coro3,
)
```

作用：

```text
批量等待多个 awaitable 完成。
```

如果传入 coroutine，`gather()` 会把它们包装成 Task。

返回结果顺序与传入顺序一致。

例子：

```python
import asyncio

async def job(name, delay):
    await asyncio.sleep(delay)
    return name

async def main():
    results = await asyncio.gather(
        job("A", 3),
        job("B", 1),
        job("C", 2),
    )

    print(results)

asyncio.run(main())
```

输出：

```python
["A", "B", "C"]
```

虽然 B 先完成，但结果仍按传入顺序排列。

`gather()` 与手写 `create_task + await` 的近似关系：

```python
task_a = asyncio.create_task(job("A", 3))
task_b = asyncio.create_task(job("B", 1))
task_c = asyncio.create_task(job("C", 2))

result_a = await task_a
result_b = await task_b
result_c = await task_c

results = [result_a, result_b, result_c]
```

但 `gather()` 不是语法糖。

它有自己的异常和取消规则：

```text
传入 coroutine 时会自动包装成 Task。
结果按传入顺序排列。
默认某个 awaitable 抛异常时，gather 向外抛异常。
return_exceptions=True 时，异常作为结果返回。
gather 自己被取消时，会取消内部未完成的 awaitable。
```

## 14. TaskGroup

Python 3.11+ 提供 `asyncio.TaskGroup`。

用法：

```python
import asyncio

async def job(name):
    await asyncio.sleep(1)
    return name

async def main():
    async with asyncio.TaskGroup() as tg:
        task_a = tg.create_task(job("A"))
        task_b = tg.create_task(job("B"))

    print(task_a.result())
    print(task_b.result())

asyncio.run(main())
```

特点：

```text
TaskGroup 把一组任务绑定在一个作用域里。
退出 async with 时，会等待组内任务完成。
如果某个任务失败，会取消同组其他任务。
错误会在退出 TaskGroup 时向外抛出。
```

`gather` 和 `TaskGroup` 的侧重点：

```text
gather:
  收集一组 awaitable 的结果。

TaskGroup:
  管理一组相关任务的生命周期。
```

## 15. asyncio.as_completed

形态：

```python
for done in asyncio.as_completed(tasks):
    result = await done
```

作用：

```text
按完成顺序处理一组 awaitable。
谁先完成，就先处理谁。
```

为什么需要它：

```text
gather() 会等全部任务结束，然后按传入顺序返回结果。
as_completed() 不要求等全部任务结束后再统一处理。
某个任务一完成，就可以立刻拿到它的结果。
```

使用场景：

```text
批量请求中，先返回的结果先处理。
下载多个文件，先下载完的先落盘。
调用多个服务，先拿到结果就先进入下一步。
需要边完成边消费，而不是最后统一消费。
```

例子：

```python
import asyncio

async def job(name, delay):
    await asyncio.sleep(delay)
    return name

async def main():
    tasks = [
        asyncio.create_task(job("A", 3)),
        asyncio.create_task(job("B", 1)),
        asyncio.create_task(job("C", 2)),
    ]

    for done in asyncio.as_completed(tasks):
        result = await done
        print(result)

asyncio.run(main())
```

输出大概率是：

```text
B
C
A
```

适合：

```text
哪个请求先完成，就先处理哪个结果。
```

注意：

```text
as_completed() 返回的不是最终结果列表。
它返回的是一个迭代器。
每次迭代得到一个可 await 的对象。
await 它之后才能得到对应任务的结果。
```

## 16. asyncio.wait

形态：

```python
done, pending = await asyncio.wait(
    tasks,
    timeout=3,
    return_when=asyncio.FIRST_COMPLETED,
)
```

作用：

```text
等待一组 Task，直到满足指定条件。
返回已经完成的 done 集合和尚未完成的 pending 集合。
```

`asyncio.wait()` 更偏底层控制。

它不直接返回任务结果。

它返回 Task 集合：

```text
done:
  已经完成的 Task。

pending:
  还没完成的 Task。
```

要取结果，需要对 `done` 中的 Task 调用：

```python
task.result()
```

或者：

```python
await task
```

为什么需要它：

```text
gather():
  适合等待全部任务，并收集全部结果。

as_completed():
  适合按完成顺序逐个处理结果。

wait():
  适合自己控制“等到什么程度就停”。
```

常见 `return_when`：

```python
asyncio.ALL_COMPLETED
asyncio.FIRST_COMPLETED
asyncio.FIRST_EXCEPTION
```

含义：

```text
ALL_COMPLETED:
  全部任务完成后返回。

FIRST_COMPLETED:
  任意一个任务完成后返回。

FIRST_EXCEPTION:
  任意一个任务抛异常后返回。
  如果没有任务抛异常，则等全部完成。
```

使用场景：

```text
只需要最快的一个结果。
等待一批任务，但最多等 N 秒。
等到第一个任务失败就停止观察。
拿到 done / pending 后自己决定取消、继续等待、重试。
```

例子：只取最快结果，并取消剩余任务。

```python
import asyncio

async def job(name, delay):
    await asyncio.sleep(delay)
    return name

async def main():
    tasks = {
        asyncio.create_task(job("A", 3)),
        asyncio.create_task(job("B", 1)),
        asyncio.create_task(job("C", 2)),
    }

    done, pending = await asyncio.wait(
        tasks,
        return_when=asyncio.FIRST_COMPLETED,
    )

    for task in done:
        print("first result:", task.result())

    for task in pending:
        task.cancel()

    await asyncio.gather(*pending, return_exceptions=True)

asyncio.run(main())
```

输出大概率是：

```text
first result: B
```

例子：最多等待 2 秒，处理已完成任务，取消未完成任务。

```python
import asyncio

async def job(name, delay):
    await asyncio.sleep(delay)
    return name

async def main():
    tasks = {
        asyncio.create_task(job("A", 1)),
        asyncio.create_task(job("B", 3)),
        asyncio.create_task(job("C", 5)),
    }

    done, pending = await asyncio.wait(tasks, timeout=2)

    for task in done:
        print("done:", task.result())

    for task in pending:
        print("cancel pending task")
        task.cancel()

    await asyncio.gather(*pending, return_exceptions=True)

asyncio.run(main())
```

关键点：

```text
wait(timeout=...) 超时后不会自动取消 pending。
pending 要不要取消，由调用方决定。
```

## 17. asyncio.timeout

Python 3.11+：

```python
import asyncio

async def slow():
    await asyncio.sleep(5)
    return "done"

async def main():
    try:
        async with asyncio.timeout(2):
            result = await slow()
            print(result)
    except TimeoutError:
        print("timeout")

asyncio.run(main())
```

含义：

```text
async with 代码块必须在 2 秒内完成。
否则抛出 TimeoutError。
```

超时通常通过取消实现。

协程中处理取消时，一般需要重新抛出 `CancelledError`：

```python
try:
    await work()
except asyncio.CancelledError:
    await cleanup()
    raise
```

## 18. asyncio.wait_for

形态：

```python
result = await asyncio.wait_for(awaitable, timeout=2)
```

作用：

```text
给单个 awaitable 加超时。
```

例子：

```python
import asyncio

async def slow():
    await asyncio.sleep(5)
    return "done"

async def main():
    try:
        result = await asyncio.wait_for(slow(), timeout=2)
        print(result)
    except TimeoutError:
        print("timeout")

asyncio.run(main())
```

使用场景：

```text
Python 3.10 及更早版本中常用。
给单个请求、单个任务、单个 awaitable 设置超时。
```

和 `asyncio.timeout()` 的区别：

```text
wait_for(awaitable, timeout):
  包住一个 awaitable。
  超时时取消这个 awaitable。

asyncio.timeout(seconds):
  包住一个 async with 代码块。
  更适合给一段异步流程设置统一超时。
```

## 19. 取消任务

```python
import asyncio

async def worker():
    try:
        while True:
            print("working")
            await asyncio.sleep(1)
    except asyncio.CancelledError:
        print("cleanup")
        raise

async def main():
    task = asyncio.create_task(worker())

    await asyncio.sleep(3)

    task.cancel()

    try:
        await task
    except asyncio.CancelledError:
        print("cancelled")

asyncio.run(main())
```

流程：

```text
task.cancel() 请求取消任务。
取消不是立刻杀死任务。
事件循环会在任务恢复时向协程注入 CancelledError。
协程可以捕获取消异常并清理资源。
清理后通常继续 raise。
```

## 20. asyncio.shield

形态：

```python
result = await asyncio.shield(task)
```

作用：

```text
保护某个 awaitable，不让外层取消直接取消它。
```

例子：

```python
import asyncio

async def save():
    await asyncio.sleep(2)
    print("saved")

async def main():
    task = asyncio.create_task(save())

    try:
        await asyncio.wait_for(asyncio.shield(task), timeout=1)
    except TimeoutError:
        print("outer timeout")

    await task

asyncio.run(main())
```

输出：

```text
outer timeout
saved
```

使用场景：

```text
外层请求超时或取消了，但某个收尾动作仍希望继续完成。
例如保存状态、提交日志、释放外部资源。
```

注意：

```text
shield 不是让任务不可取消。
如果直接 cancel 被保护的 task，它仍然会被取消。
shield 只是隔离外层 await 的取消传播。
```

## 21. asyncio.to_thread

形态：

```python
result = await asyncio.to_thread(func, *args, **kwargs)
```

作用：

```text
把同步阻塞函数放到线程中执行，避免卡住事件循环。
```

例子：

```python
import asyncio
import time

def blocking_io():
    time.sleep(2)
    return "done"

async def main():
    result = await asyncio.to_thread(blocking_io)
    print(result)

asyncio.run(main())
```

使用场景：

```text
必须调用同步文件 IO。
必须调用同步 HTTP / SDK / 数据库客户端。
某段旧代码暂时没有异步版本。
```

注意：

```text
to_thread 适合包装阻塞 IO。
CPU 密集计算不一定适合，因为 Python 线程仍受 GIL 影响。
CPU 密集任务通常考虑进程池、任务队列或外部服务。
```

## 22. Lock 和 Event

### asyncio.Lock

形态：

```python
async with lock:
    ...
```

作用：

```text
保护异步任务之间共享的临界区。
```

例子：

```python
import asyncio

counter = 0
lock = asyncio.Lock()

async def increment():
    global counter

    async with lock:
        value = counter
        await asyncio.sleep(0)
        counter = value + 1
```

使用场景：

```text
多个协程会修改同一份共享状态。
中间存在 await，可能发生交错执行。
需要保证某段代码同一时间只允许一个任务进入。
```

### asyncio.Event

形态：

```python
await event.wait()
event.set()
```

作用：

```text
让一批任务等待某个信号。
信号发生后，等待的任务继续执行。
```

例子：

```python
import asyncio

async def worker(event):
    print("wait start")
    await event.wait()
    print("start work")

async def main():
    event = asyncio.Event()

    task = asyncio.create_task(worker(event))

    await asyncio.sleep(1)
    event.set()

    await task

asyncio.run(main())
```

使用场景：

```text
服务启动完成后通知 worker 开始。
配置加载完成后通知其他任务继续。
收到停止信号后通知一组任务退出。
```

## 23. Semaphore 限制并发

```python
import asyncio

async def request(i):
    await asyncio.sleep(1)
    return i

async def limited_request(i, sem):
    async with sem:
        return await request(i)

async def main():
    sem = asyncio.Semaphore(5)

    tasks = [
        limited_request(i, sem)
        for i in range(100)
    ]

    results = await asyncio.gather(*tasks)
    print(results)

asyncio.run(main())
```

`Semaphore(5)` 表示：

```text
最多 5 个任务进入 async with sem 包裹的区域。
```

常见用途：

```text
限制 HTTP 并发请求数。
限制数据库并发查询数。
限制同时处理的后台任务数。
避免打爆远端服务或本地资源。
```

## 24. Queue 生产者消费者

```python
import asyncio

async def producer(queue):
    for i in range(5):
        await queue.put(i)
        print("produce", i)

    await queue.put(None)

async def consumer(queue):
    while True:
        item = await queue.get()

        try:
            if item is None:
                break

            print("consume", item)
            await asyncio.sleep(1)
        finally:
            queue.task_done()

async def main():
    queue = asyncio.Queue()

    p = asyncio.create_task(producer(queue))
    c = asyncio.create_task(consumer(queue))

    await p
    await queue.join()
    await c

asyncio.run(main())
```

相关方法：

```text
await queue.put(item):
  放入元素。
  如果队列满了，当前协程挂起。

await queue.get():
  取出元素。
  如果队列空了，当前协程挂起。

queue.task_done():
  告诉队列，某个取出的任务已经处理完。

await queue.join():
  等待所有 put 进去的任务都被 task_done。
```

适合：

```text
爬虫任务队列
后台 worker
日志处理流水线
消息消费
生产者消费者模型
```

## 25. 串行和并发的对比

串行：

```python
import asyncio

async def job(name, delay):
    print(name, "start")
    await asyncio.sleep(delay)
    print(name, "end")

async def main():
    await job("A", 2)
    await job("B", 2)

asyncio.run(main())
```

特点：

```text
A 完成后才开始 B。
总耗时大约 4 秒。
```

并发推进：

```python
import asyncio

async def job(name, delay):
    print(name, "start")
    await asyncio.sleep(delay)
    print(name, "end")

async def main():
    task_a = asyncio.create_task(job("A", 2))
    task_b = asyncio.create_task(job("B", 2))

    await task_a
    await task_b

asyncio.run(main())
```

特点：

```text
A 和 B 的等待时间重叠。
总耗时大约 2 秒。
```

## 26. 常见错误

### 忘记 await

```python
async def f():
    return 1

f()
```

`f()` 只是创建 coroutine object，不会执行函数体。

正确：

```python
result = await f()
```

### 把连续 await 当成并发

```python
await job("A")
await job("B")
```

这是串行等待。

需要并发推进时：

```python
task_a = asyncio.create_task(job("A"))
task_b = asyncio.create_task(job("B"))

await task_a
await task_b
```

或者：

```python
await asyncio.gather(
    job("A"),
    job("B"),
)
```

### 在 async 函数中写阻塞代码

```python
async def bad():
    time.sleep(1)
```

这会卡住事件循环。

正确：

```python
async def good():
    await asyncio.sleep(1)
```

或者把同步阻塞函数放到线程中：

```python
result = await asyncio.to_thread(blocking_func)
```

### 创建 Task 后不管理

```python
asyncio.create_task(work())
```

问题：

```text
异常可能无人处理。
任务生命周期不明确。
程序退出时任务可能被取消。
```

更稳妥：

```python
task = asyncio.create_task(work())
result = await task
```

或者用 `TaskGroup` 管理一组任务。

### 吞掉 CancelledError

```python
try:
    await work()
except asyncio.CancelledError:
    pass
```

通常不应该吞掉取消。

更常见写法：

```python
try:
    await work()
except asyncio.CancelledError:
    await cleanup()
    raise
```

## 27. 记忆版

```text
async def:
  定义协程函数。
  调用后得到 coroutine object。

await:
  等待 awaitable。
  当前协程挂起。
  事件循环可以推进其他任务。

async with:
  异步资源管理。
  await __aenter__。
  await __aexit__。

async for:
  异步迭代。
  每次 await __anext__。

asyncio.run:
  创建事件循环。
  运行入口协程。
  清理并关闭事件循环。

asyncio.create_task:
  coroutine -> Task。
  注册到事件循环。
  之后由事件循环推进。

asyncio.sleep:
  挂起当前协程一段时间。
  不阻塞线程。

asyncio.gather:
  批量等待多个 awaitable。
  结果按传入顺序返回。

asyncio.as_completed:
  按完成顺序处理任务。
  谁先完成，先 await 谁的结果。

asyncio.wait:
  等待一组 Task 到指定条件。
  返回 done / pending。
  pending 是否取消由调用方决定。

asyncio.wait_for:
  给单个 awaitable 加超时。

asyncio.timeout:
  给一个 async with 代码块加超时。

asyncio.shield:
  隔离外层取消传播。

asyncio.to_thread:
  把同步阻塞函数放到线程中执行。

TaskGroup:
  结构化管理一组任务。

Lock:
  保护共享状态的临界区。

Event:
  让任务等待某个信号。

asyncio 的并发:
  不是 CPU 并行。
  是单线程协作式并发。
  协程在 await 处挂起。
  事件循环交替推进可运行的 Task。
```

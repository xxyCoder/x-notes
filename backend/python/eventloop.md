事件循环会运行异步任务和回调，执行网络 IO 操作，以及运行子进程

## 核心结构

1. **`_ready` (deque)** : 一个双端队列，存放所有**立即待执行**的回调（Handle）。
2. **`_scheduled` (heapq)** : 一个最小堆，存放所有**定时执行**的回调（例如 `call_later` 指定的任务）。堆顶永远是最近要到期的任务。
3. **`_selector` (selectors)** : 对系统级 I/O 多路复用（如 `epoll`, `kqueue`, `select`）的封装，用于监听文件描述符。

## 执行过程

`Event Loop` 的生命周期就是不断重复调用 `_run_once()`。这个方法的源码逻辑可以拆解为以下四个阶段

1. 处理定时任务，Loop 会检查 `_scheduled` 堆。如果堆顶任务的到期时间已到，就将其从堆中弹出，并移动到 `_ready` 队列中
2. Loop 需要决定在 `selector.select()` 上阻塞多久
   * 如果 `_ready` 有任务，超时时间为 0（立即返回）
   * 如果 `_ready` 为空，超时时间 = `_scheduled` 中最近任务的到期时间减去当前时间
3. 当 `select()` 返回时，表示某些文件描述符（Socket 等）可读或可写了，Loop 遍历 `event_list`，找到对应的回调函数，并将这些回调放入 `_ready` 队列中
4. 依次迭代 `_ready` 队列，调用每一个 `handle._run()`

### 协程如何被驱动的？

```python
# 简化版Future
class Future:
    def set_result(self, result):
        self._result = result
        self._state = _FINISHED
        self.__schedule_callbacks()

    def __await__(self):
        if not self.done():
            # 如果还没完成，就把自己 yield 出去
            yield self
        return self.result()

    def __schedule_callbacks(self):
        # 把所有注册在案的回调，通通丢进 Event Loop 的 _ready 队列
        for callback, ctx in self._callbacks:
            self._loop.call_soon(callback, self, context=ctx)


class Task(Future):
    def __init__(self, coro, loop=None):
        super().__init__(loop=loop)
        if loop is None:
            # 如果你不传，我就自己去抓当前正在跑的那个经理
            self._loop = events.get_running_loop()
        else:
            self._loop = loop
        self._coro = coro
        # 关键：实例化后立即把自己排进 Event Loop 的“首发名单”
        self._loop.call_soon(self.__step)

    def __step(self, exc=None):
        try:
            if exc is None:
                # 驱动协程向前走一步，相当于执行到下一个 await
                result = self._coro.send(None)
            else:
                result = self._coro.throw(exc)
        except StopIteration as exc:
            # 协程运行完了，设置 Future 的结果
            self.set_result(exc.value)
        except Exception as exc:
            self.set_exception(exc)
        else:
            # 此时 result 通常是一个子 Future (由 await 产出)
            # 我们给这个子 Future 增加一个“唤醒我的闹钟”
            result.add_done_callback(self.__wakeup)

    def __wakeup(self):
        self._loop.call_soon(self.__step)


```

1. 当调用 `create_task(coro)`，Task 会封装协程，并调用 `self._loop.call_soon(self.__step)`，这样就会位于 `_scheduled`最前方
2. 后续 `__step`进入 `_ready`队列，执行 `handle._run()`驱动运行到下一个await，但是Python 并没有立即把控制权交还给 Event Loop，而是**进入**这个子协程去执行，直到遇到一个真正的“硬骨头”——即一个实现了 `__await__` 协议并真正执行 `yield` 的对象（通常是 `Future`）

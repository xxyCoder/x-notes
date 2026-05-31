## 1. 核心关系

```text
Future = 一个未来结果的容器
Task   = 一个负责执行协程的 Future
```


在概念上，可以把 Task 看成：

```python
class Task(Future):
    ...
```

也就是说，Task 本身也是一个 Future。

所以 Task 也有这些 Future 的能力：

```python
task.done()
task.result()
task.exception()
task.cancel()
task.add_done_callback(callback)
```

区别是：

```text
普通 Future 的结果通常由外部 set_result / set_exception 设置
Task 的结果来自它内部包着的协程执行结果
```

## 2. Future 的实现骨架

Future 的核心是四样东西：

```text
状态
结果
异常
完成回调
```

伪代码：

```python
class Future:
    def __init__(self):
        self._state = "PENDING"       # PENDING / FINISHED / CANCELLED
        self._result = None
        self._exception = None
        self._callbacks = []
```

### done

```python
class Future:
    def done(self):
        return self._state != "PENDING"
```

`done()` 表示这个 Future 是否已经结束。

结束可能有三种情况：

```text
正常完成
异常完成
被取消
```

### result

```python
class Future:
    def result(self):
        if self._state == "PENDING":
            raise RuntimeError("result is not ready")

        if self._state == "CANCELLED":
            raise CancelledError()

        if self._exception is not None:
            raise self._exception

        return self._result
```

`result()` 的含义是：

```text
如果成功完成，返回结果
如果异常完成，重新抛出异常
如果还没完成，不允许取结果
```

### set_result

```python
class Future:
    def set_result(self, value):
        if self.done():
            raise RuntimeError("future is already done")

        self._result = value
        self._state = "FINISHED"
        self._schedule_callbacks()
```

`set_result()` 做两件事：

```text
1. 保存结果
2. 通知等待这个 Future 的回调
```

### set_exception

```python
class Future:
    def set_exception(self, exc):
        if self.done():
            raise RuntimeError("future is already done")

        self._exception = exc
        self._state = "FINISHED"
        self._schedule_callbacks()
```

`set_exception()` 和 `set_result()` 类似，只是保存的是异常。

### add_done_callback

```python
class Future:
    def add_done_callback(self, callback):
        if self.done():
            call_soon(callback, self)
        else:
            self._callbacks.append(callback)
```

`add_done_callback()` 表示：

```text
等 Future 完成后，调用这个 callback
```

如果 Future 已经完成，就尽快调度这个 callback。

如果 Future 还没完成，就先把 callback 存起来。

### schedule callbacks

```python
class Future:
    def _schedule_callbacks(self):
        callbacks = self._callbacks
        self._callbacks = []

        for callback in callbacks:
            call_soon(callback, self)
```

Future 完成时，会把之前注册的回调全部调度出去。

## 3. Future 为什么可以 await

Future 能被 `await`，核心是它实现了 `__await__`。

伪代码：

```python
class Future:
    def __await__(self):
        if not self.done():
            yield self

        return self.result()
```

含义是：

```text
如果 Future 没完成，就把自己 yield 出去，让当前执行暂停
等 Future 完成后，再通过 result() 拿到结果
```

所以：

```python
value = await future
```

可以理解成：

```text
如果 future 没结果，先停在这里
等 future 有结果后，把结果赋值给 value
```

## 4. Task 的实现骨架

Task 的核心是：

```text
Task 保存一个协程对象
Task 反复推进这个协程
Task 在协程结束时，把自己这个 Future 标记为完成
```

伪代码：

```python
class Task(Future):
    def __init__(self, coro):
        super().__init__()
        self._coro = coro
        self._waiting = None

        call_soon(self._step)
```

这里有两个重点：

```text
self._coro    保存要执行的协程
self._waiting 保存当前正在等待的 Future
```

Task 最重要的方法只有两个：

```text
_step()
_wakeup()
```

## 5. Task._step

`_step()` 的职责是：

```text
推进协程执行一步
```

伪代码：

```python
class Task(Future):
    def _step(self, value=None, error=None):
        if self.done():
            return

        try:
            if error is None:
                waiting = self._coro.send(value)
            else:
                waiting = self._coro.throw(error)

        except StopIteration as e:
            self.set_result(e.value)
            return

        except Exception as e:
            self.set_exception(e)
            return

        self._waiting = waiting
        waiting.add_done_callback(self._wakeup)
```

这段代码分三种情况。

### 情况一：协程正常 return

协程 `return value` 时，底层表现为抛出 `StopIteration`。

所以 Task 会捕获它：

```python
except StopIteration as e:
    self.set_result(e.value)
```

含义是：

```text
协程执行完了
Task 自己也完成了
Task 的结果就是协程的 return 值
```

### 情况二：协程抛异常

```python
except Exception as e:
    self.set_exception(e)
```

含义是：

```text
协程执行失败
Task 自己也失败
Task 的异常就是协程抛出的异常
```

之后如果有人执行：

```python
await task
```

或者：

```python
task.result()
```

这个异常会被重新抛出。

### 情况三：协程 await 了另一个 Future

如果协程还没结束，而是执行到某个 `await`，它会暂停，并交出正在等待的对象。

在简化模型里，这个对象就是 `waiting`：

```python
waiting = self._coro.send(value)
```

Task 保存它：

```python
self._waiting = waiting
```

然后注册回调：

```python
waiting.add_done_callback(self._wakeup)
```

含义是：

```text
当前协程暂时跑不动了
它在等 waiting 这个 Future
等 waiting 完成后，调用 Task._wakeup
```

## 6. Task._wakeup

`_wakeup()` 的职责是：

```text
等待的 Future 完成后，恢复 Task 里的协程
```

伪代码：

```python
class Task(Future):
    def _wakeup(self, waiting):
        self._waiting = None

        try:
            value = waiting.result()
        except Exception as e:
            call_soon(self._step, None, e)
        else:
            call_soon(self._step, value, None)
```

如果被等待的 Future 成功：

```python
value = waiting.result()
call_soon(self._step, value, None)
```

含义是：

```text
把 waiting 的结果送回协程
让协程从上次 await 的位置继续执行
```

如果被等待的 Future 失败：

```python
except Exception as e:
    call_soon(self._step, None, e)
```

含义是：

```text
把 waiting 的异常抛回协程
让协程在上次 await 的位置感受到这个异常
```

## 7. Task 执行流程

假设有一个 Task：

```python
task = Task(coro)
```

它的执行过程是：

```text
1. Task 保存 coro
2. Task 调度第一次 _step()
3. _step() 推进 coro
4. coro 如果 return，Task set_result
5. coro 如果 raise，Task set_exception
6. coro 如果 await 某个 Future，Task 暂停
7. Task 给被等待的 Future 注册 _wakeup 回调
8. 被等待的 Future 完成
9. _wakeup 取出 Future 的结果或异常
10. _wakeup 再次调度 _step
11. _step 把结果或异常送回 coro
12. 重复这个过程，直到 coro 结束
```

压缩成图：

```text
Task._step()
    |
    v
推进 coro
    |
    |-- coro return x
    |       |
    |       v
    |   task.set_result(x)
    |
    |-- coro raise e
    |       |
    |       v
    |   task.set_exception(e)
    |
    |-- coro await future
            |
            v
        task._waiting = future
        future.add_done_callback(task._wakeup)
            |
            v
        future 完成
            |
            v
        task._wakeup(future)
            |
            v
        task._step(future.result())
```

## 8. Task 和 Future 的差别

Future：

```text
只是一个结果容器
不负责执行任何协程
结果通常由外部设置
```

Task：

```text
本身也是一个 Future
内部持有一个协程
负责推进协程执行
最终用协程的返回值 set_result
或者用协程的异常 set_exception
```

所以：

```text
Future 的完成依赖外部调用 set_result / set_exception
Task 的完成依赖内部协程 return / raise
```

## 9. 最小完整伪代码

```python
class Future:
    def __init__(self):
        self._state = "PENDING"
        self._result = None
        self._exception = None
        self._callbacks = []

    def done(self):
        return self._state != "PENDING"

    def result(self):
        if self._state == "PENDING":
            raise RuntimeError("result is not ready")

        if self._exception is not None:
            raise self._exception

        return self._result

    def set_result(self, value):
        if self.done():
            raise RuntimeError("future is already done")

        self._result = value
        self._state = "FINISHED"
        self._schedule_callbacks()

    def set_exception(self, exc):
        if self.done():
            raise RuntimeError("future is already done")

        self._exception = exc
        self._state = "FINISHED"
        self._schedule_callbacks()

    def add_done_callback(self, callback):
        if self.done():
            call_soon(callback, self)
        else:
            self._callbacks.append(callback)

    def _schedule_callbacks(self):
        callbacks = self._callbacks
        self._callbacks = []

        for callback in callbacks:
            call_soon(callback, self)

    def __await__(self):
        if not self.done():
            yield self

        return self.result()


class Task(Future):
    def __init__(self, coro):
        super().__init__()
        self._coro = coro
        self._waiting = None

        call_soon(self._step)

    def _step(self, value=None, error=None):
        if self.done():
            return

        try:
            if error is None:
                waiting = self._coro.send(value)
            else:
                waiting = self._coro.throw(error)

        except StopIteration as e:
            self.set_result(e.value)
            return

        except Exception as e:
            self.set_exception(e)
            return

        self._waiting = waiting
        waiting.add_done_callback(self._wakeup)

    def _wakeup(self, waiting):
        self._waiting = None

        try:
            value = waiting.result()
        except Exception as e:
            call_soon(self._step, None, e)
        else:
            call_soon(self._step, value, None)
```

## 10. 最后总结

Future 的核心：

```text
保存状态、结果、异常、回调
完成时通知回调
被 await 时，如果没完成就暂停等待
```

Task 的核心：

```text
继承 Future
保存一个协程
用 _step 推进协程
用 _wakeup 在等待的 Future 完成后恢复协程
协程 return 时，Task set_result
协程 raise 时，Task set_exception
```

最短理解：

```text
Future = 结果盒子
Task   = 会执行协程的结果盒子
```

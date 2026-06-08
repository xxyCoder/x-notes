## 1. threading 解决什么问题

`threading` 用来在同一个 Python 进程里创建多个线程，让多个执行流并发运行。

核心定位：

```text
threading：多个操作系统线程，适合同步阻塞 I/O 并发
asyncio：一个线程里的多个 Task，适合 async I/O 并发
```

简单理解：

```text
threading.Thread 负责让一个函数在线程里运行
Lock 负责保护共享数据
Event 负责线程间通知
Semaphore 负责限制同时进入某段逻辑的线程数量
```

---

## 2. `threading.Thread`：创建线程

基础语法：

```python
import threading

t = threading.Thread(
    target=worker,
    args=("A", 3),
    kwargs={"timeout": 5},
    name="worker-1",
    daemon=False,
)
```

### `target=worker`

指定线程启动后执行哪个函数。

```python
t = threading.Thread(target=worker)
```

含义：

```text
线程启动后，执行 worker()
```

注意：

```python
target=worker      # 对：把函数对象交给线程
target=worker()    # 错：现在立刻执行 worker，把返回值交给线程
```

---

### `args=(...)`

给 `target` 函数传位置参数。

```python
def worker(name, count):
   print(name, count)

t = threading.Thread(
    target=worker,
    args=("A", 3),
)
```

等价于线程里执行：

```python
worker("A", 3)
```

单个参数必须写成：

```python
args=("A",)
```

因为 `args` 要求是 tuple。

---

### `kwargs={...}`

给 `target` 函数传关键字参数。

```python
t = threading.Thread(
    target=worker,
    args=("A",),
    kwargs={"timeout": 5},
)
```

等价于线程里执行：

```python
worker("A", timeout=5)
```

---

### `name="worker-1"`

给线程起名字，方便日志和排查问题。

```python
t = threading.Thread(target=worker, name="worker-1")
```

在线程内部获取当前线程名：

```python
threading.current_thread().name
```

---

### `daemon=False`

设置线程是否是守护线程。

```python
t = threading.Thread(target=worker, daemon=False)
```

区别：

```text
daemon=False：普通线程，主线程结束后，程序会等它结束
daemon=True ：守护线程，主线程结束后，程序可以直接退出，不一定等它
```

刚开始一般用默认值：

```python
daemon=False
```

如果线程里有写文件、写数据库、状态变更等重要逻辑，不要随便设成 `daemon=True`。

---

## 3. `start()`：启动线程

```python
t.start()
```

含义：

```text
真正启动线程，让它执行 target 指定的函数
```

注意：

```python
t = threading.Thread(target=worker)
```

只是创建线程对象，线程还没开始运行。

必须调用：

```python
t.start()
```

线程才会开始执行。

---

## 4. `join()`：等待线程结束

```python
t.join()
```

含义：

```text
当前线程等待 t 这个线程执行结束
```

例子：

```python
import threading
import time

def worker():
   time.sleep(2)
   print("worker done")

t = threading.Thread(target=worker)

t.start()
t.join()

print("main done")
```

因为有 `t.join()`，所以一定是：

```text
worker done
main done
```

### `join(timeout=3)`

```python
t.join(timeout=3)
```

含义：

```text
最多等待 3 秒
```

配合 `is_alive()` 判断线程是否还在运行：

```python
t.join(timeout=3)

if t.is_alive():
   print("thread still running")
else:
   print("thread finished")
```

---

## 5. 最小线程模板

```python
import threading

def worker(name):
   print("hello", name)

t = threading.Thread(
    target=worker,
    args=("A",),
    name="worker-A",
)

t.start()
t.join()
```

对应关系：

```text
threading.Thread(...)  创建线程对象
target=worker          线程启动后执行 worker
args=("A",)            给 worker 传参数
name="worker-A"        给线程命名
t.start()              启动线程
t.join()               等线程结束
```

---

## 6. 和 asyncio 的基础对比

threading：

```python
t = threading.Thread(target=worker)
t.start()
t.join()
```

asyncio：

```python
task = asyncio.create_task(worker())
await task
```

对应关系：

```text
threading.Thread(...)     类似创建并发执行单元
asyncio.create_task(...)  创建 Task

t.start()                 启动线程
await task                等 Task 完成

t.join()                  阻塞当前线程等待线程结束
await task                挂起当前 Task，event loop 还能继续跑别的 Task
```

核心差异：

```text
threading 等待时：阻塞线程
asyncio 等待时：挂起 Task，不阻塞 event loop
```

---

## 7. `Lock`：保护共享变量

创建锁：

```python
lock = threading.Lock()
```

使用锁：

```python
with lock:
   counter += 1
```

含义：

```text
进入 with lock 前：尝试抢锁
抢到锁后：执行里面的代码
离开 with lock：自动释放锁
```

完整例子：

```python
import threading

counter = 0
lock = threading.Lock()

def worker():
    global counter

   for _ in range(10000):
        with lock:
           counter += 1

t1 = threading.Thread(target=worker)
t2 = threading.Thread(target=worker)

t1.start()
t2.start()

t1.join()
t2.join()

print(counter)
```

为什么需要锁？

```python
counter += 1
```

看起来是一行，但可以粗略理解为：

```text
1. 读取 counter
2. 加 1
3. 写回 counter
```

两个线程可能这样交错：

```text
counter = 10

线程 A 读到 10
线程 B 读到 10
线程 A 写回 11
线程 B 写回 11
```

正确结果应该是 12，但最后可能是 11。这个问题叫竞态条件。

`Lock` 的作用：

```text
同一时间只允许一个线程进入临界区
```

---

## 8. `threading.Lock` vs `asyncio.Lock`

threading 写法：

```python
lock = threading.Lock()

with lock:
    do_sync_work()
```

asyncio 写法：

```python
lock = asyncio.Lock()

async with lock:
    await do_async_work()
```

区别：

```text
threading.Lock：给多个线程用
asyncio.Lock：给同一个 event loop 里的多个 Task 用
```

等待方式不同：

```text
threading.Lock 拿不到锁：阻塞当前线程
asyncio.Lock 拿不到锁：挂起当前 Task，event loop 继续跑别的 Task
```

---

## 9. 为什么 asyncio 里不要用 `threading.Lock` 包住 `await`

危险代码：

```python
import asyncio
import threading

lock = threading.Lock()

async def worker():
    with lock:
        await asyncio.sleep(1)
```

可能出问题的过程：

```text
Task A 拿到 threading.Lock
Task A 执行 await，挂起
event loop 切到 Task B
Task B 想拿 threading.Lock
拿不到，于是阻塞整个 event loop 线程
Task A 没机会恢复，也就没机会释放锁
可能死锁
```

正确写法：

```python
import asyncio

lock = asyncio.Lock()

async def worker():
   async with lock:
        await asyncio.sleep(1)
```

---

## 10. 为什么 threading 里不推荐用 `asyncio.Lock`

### 影响 1：`with` 直接报错

```python
import asyncio
import threading

lock = asyncio.Lock()

def worker():
    with lock:
       print("work")

t = threading.Thread(target=worker)
t.start()
t.join()
```

会报错：

```text
TypeError: 'Lock' object does not support the context manager protocol
```

原因：

```text
threading.Lock 用 with lock
asyncio.Lock 用 async with lock
```

---

### 影响 2：手动 `acquire()` 也不会真的加锁

错误代码：

```python
import asyncio
import threading

lock = asyncio.Lock()

def worker():
   lock.acquire()
   print("critical section")
   lock.release()
```

问题：

```text
asyncio.Lock.acquire() 返回的是 coroutine
不 await 它，就不会真正执行拿锁逻辑
```

可能出现：

```text
RuntimeWarning: coroutine 'Lock.acquire' was never awaited
RuntimeError: Lock is not acquired
```

真正的 asyncio 写法应该是：

```python
await lock.acquire()
```

但普通线程函数 `def worker()` 里面不能直接写 `await`。

---

### 影响 3：强行在线程里 `asyncio.run()`，可能卡死或行为异常

危险代码：

```python
import asyncio
import threading

lock = asyncio.Lock()

async def async_worker(name):
   async with lock:
       print(name, "enter")
        await asyncio.sleep(1)
       print(name, "exit")

def worker(name):
    asyncio.run(async_worker(name))

t1 = threading.Thread(target=worker, args=("T1",))
t2 = threading.Thread(target=worker, args=("T2",))

t1.start()
t2.start()

t1.join(timeout=3)
t2.join(timeout=3)

print("t1 alive:", t1.is_alive())
print("t2 alive:", t2.is_alive())
```

问题：

```text
asyncio.run(...) 每次都会创建一个新的 event loop

Thread-1 里面是 Event Loop 1
Thread-2 里面是 Event Loop 2

但两个线程共享同一个 asyncio.Lock
```

`asyncio.Lock` 不是设计给多个线程 / 多个 event loop 共享的。它只适合同一个 event loop 里的多个 Task。

可能影响：

```text
线程卡住
协程永远等不到锁
偶发 RuntimeError
行为依赖时序，很难排查
```

---

## 11. `Event`：线程间通知

创建：

```python
stop_event = threading.Event()
```

常用方法：

```python
stop_event.wait()
stop_event.set()
stop_event.clear()
stop_event.is_set()
```

含义：

```text
wait()    当前线程等待，直到 event 被 set
set()     把 event 设置为 True，并唤醒 wait 的线程
clear()   把 event 重新设置为 False
is_set()  判断 event 当前是不是 True
```

常见写法：通知线程停止。

```python
import threading
import time

stop_event = threading.Event()

def worker():
    while not stop_event.is_set():
       print("working")
       time.sleep(1)

   print("stopped")

t = threading.Thread(target=worker)
t.start()

time.sleep(3)

stop_event.set()
t.join()
```

关键点：

```text
线程不是被强制杀掉
而是自己检查 stop_event，然后主动退出
```

---

## 12. `threading.Event` vs `asyncio.Event`

threading：

```python
event = threading.Event()

event.wait()
event.set()
```

asyncio：

```python
event = asyncio.Event()

await event.wait()
event.set()
```

区别：

```text
threading.Event.wait()  阻塞当前线程
asyncio.Event.wait()    挂起当前 Task
```

---

## 13. `Semaphore`：限制并发数量

创建：

```python
sem = threading.Semaphore(3)
```

含义：

```text
最多允许 3 个线程同时进入某段代码
```

使用：

```python
with sem:
    do_work()
```

例子：

```python
import threading
import time

sem = threading.Semaphore(3)

def worker(i):
    with sem:
       print("start", i)
       time.sleep(1)
       print("end", i)

threads = []

for i in range(10):
   t = threading.Thread(target=worker, args=(i,))
   threads.append(t)
   t.start()

for t in threads:
   t.join()
```

虽然创建了 10 个线程，但：

```python
sem = threading.Semaphore(3)
```

决定了：

```text
同一时间最多只有 3 个线程能进入 with sem
```

---

## 14. `threading.Semaphore` vs `asyncio.Semaphore`

threading：

```python
sem = threading.Semaphore(3)

with sem:
    do_sync_work()
```

asyncio：

```python
sem = asyncio.Semaphore(3)

async with sem:
    await do_async_work()
```

区别：

```text
threading.Semaphore：控制线程并发，拿不到时阻塞线程
asyncio.Semaphore：控制 Task 并发，拿不到时挂起 Task
```

---

## 15. threading 内部原理简化理解

`threading` 模型：

```text
Process
├── Main Thread
├── Thread A
├── Thread B
└── Thread C
```

特点：

```text
多个线程共享同一个进程内存
共享全局变量、堆对象、文件句柄、socket
每个线程有自己的调用栈和执行位置
```

线程调度由操作系统负责：

```text
Thread A 跑一会儿
Thread B 跑一会儿
Thread C 跑一会儿
```

这叫抢占式调度。

和 asyncio 对比：

```text
asyncio 通常是一个线程里的 event loop
多个 Task 靠 await 主动让出控制权
```

---

## 16. GIL 简化理解

普通 CPython 有 GIL。

简化理解：

```text
多个线程可以存在
但同一时刻通常只有一个线程在执行 Python 字节码
```

所以纯 Python CPU 密集代码：

```python
def cpu_heavy():
    total = 0
   for i in range(100000000):
        total += i
```

用多线程通常不会明显变快。

但 I/O 等待类操作：

```python
time.sleep(1)
requests.get(...)
file.read(...)
db.query(...)
```

线程在等待 I/O 时，不会一直占着 CPU，其他线程有机会继续执行。

所以：

```text
threading 适合：同步阻塞 I/O 并发
threading 不适合：纯 Python CPU 并行加速
```

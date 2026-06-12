## 0. 总览

Python 进程相关知识可以按这条主线理解：

```text
创建进程
  -> 进程怎么启动
  -> 进程之间怎么传数据
  -> 进程之间怎么共享状态
  -> 进程之间怎么同步
  -> 多任务怎么用进程池
  -> 子进程异常、超时、卡死怎么处理
  -> subprocess 跑外部程序
```

核心分类：

```text
Process                 手动创建子进程
Queue / Pipe             进程间通信，传消息
Value / Array             简单共享内存
Manager                  服务进程 + proxy，共享复杂对象
shared_memory            原始共享内存，适合大 buffer / numpy
Lock / Event / Semaphore  进程同步
ProcessPoolExecutor      高层进程池
multiprocessing.Pool      老 API 进程池
subprocess                启动外部命令 / 外部程序
```

---

# 1. Process 基础

## 1.1 最小写法

```python
from multiprocessing import Process

def worker(name):
    print("hello", name)

if __name__ == "__main__":
    p = Process(target=worker, args=("A",))
    p.start()
    p.join()
```

拆解：

```python
p = Process(target=worker, args=("A",))
```

含义：

```text
创建一个 Process 对象。
还没有真正启动子进程。
target=worker 表示子进程启动后执行 worker。
args=("A",) 表示执行 worker("A")。
```

```python
p.start()
```

含义：

```text
真正创建子进程。
子进程进入 multiprocessing 启动流程。
最后调用 worker("A")。
```

```python
p.join()
```

含义：

```text
父进程等待子进程结束。
join 只负责等，不负责杀进程，也不负责判断成功失败。
```

---

## 1.2 Process 常用属性和方法

```python
p.pid
p.is_alive()
p.exitcode
p.terminate()
p.kill()
p.daemon
```

### `p.pid`

```text
子进程 PID。
start() 之前是 None。
start() 之后才有 PID。
```

### `p.is_alive()`

```text
判断子进程当前是否还活着。
```

### `p.exitcode`

```text
None   进程还没结束
0      正常结束
非 0   异常退出
负数   被信号杀死，例如 -9 通常表示 SIGKILL
```

### `p.terminate()`

```text
请求终止子进程。
不是优雅收尾。
可能导致 finally、文件 flush、锁释放等逻辑没完成。
```

### `p.kill()`

```text
更强硬地杀死子进程。
Unix/Linux 上类似 SIGKILL。
```

### `p.daemon`

```python
p.daemon = True
p.start()
```

必须在 `start()` 前设置。

含义：

```text
daemon 子进程不会阻止主进程退出。
主进程结束时，daemon 子进程可能被一起结束。
不适合需要完整收尾的任务。
```

---

## 1.3 join(timeout)

```python
p.start()
p.join(timeout=3)

if p.is_alive():
    p.terminate()
    p.join()
```

重点：

```text
join(timeout=3) 只是父进程最多等 3 秒。
它不会杀死子进程。
如果 3 秒后子进程还活着，需要自己 terminate()/kill()。
```

统一记忆：

```text
join(timeout)          最多等进程结束，不杀进程
Queue.get(timeout)     最多等数据，不杀生产者
Future.result(timeout) 最多等结果，不杀任务
```

---

# 2. 三种启动方式

Python multiprocessing 有三种启动方式：

```text
spawn
fork
forkserver
```

一句话：

```text
spawn      = 重新启动一个 Python，再加载代码找 target
fork       = 从当前父进程直接分裂一份
forkserver = 找一个干净的中介进程来 fork
```

---

## 2.1 共同流程

无论哪种方式，代码都是：

```python
p = Process(target=worker)
p.start()
```

共同逻辑：

```text
父进程调用 p.start()
  -> 创建子进程
  -> 子进程进入 multiprocessing bootstrap
  -> 调用 p.run()
  -> p.run() 调用 target
  -> worker() 执行
```

重点：

```text
不是 import 文件自动执行 worker。
import / 加载代码只是为了让子进程能找到 worker。
真正调用 worker 的是 multiprocessing 内部流程。
```

---

## 2.2 spawn

流程：

```text
父进程
  -> 开一个全新的 Python 解释器
  -> 子进程重新加载你的代码文件
  -> 找到 worker 函数定义
  -> multiprocessing 调用 worker()
```

例子：

```python
import multiprocessing as mp

x = 1

def worker():
    print("child x:", x)

if __name__ == "__main__":
    x = 100

    ctx = mp.get_context("spawn")
    p = ctx.Process(target=worker)
    p.start()
    p.join()
```

`spawn` 下子进程通常打印：

```text
child x: 1
```

原因：

```text
spawn 子进程重新加载代码。
它会看到顶层 x = 1。
不会执行 if __name__ == "__main__" 里面的 x = 100。
```

核心：

```text
spawn 不继承父进程当前内存状态。
spawn 看重新加载后的模块顶层状态。
```

---

## 2.3 fork

流程：

```text
父进程运行到 p.start()
  -> multiprocessing 内部调用 fork
  -> 子进程复制父进程当前状态
  -> 子进程进入 bootstrap
  -> 调用 worker()
```

例子：

```python
import multiprocessing as mp

x = 1

def worker():
    print("child x:", x)

if __name__ == "__main__":
    x = 100

    ctx = mp.get_context("fork")
    p = ctx.Process(target=worker)
    p.start()
    p.join()
```

`fork` 下子进程通常打印：

```text
child x: 100
```

原因：

```text
fork 复制父进程当前内存状态。
父进程在 start 之前已经把 x 改成 100。
```

关于 fork：

```text
fork 后父子进程一开始看到几乎一样的内存。
操作系统通常使用 copy-on-write。
谁写某块内存页，谁才真的复制那一页。
```

优点：

```text
快。
能看到父进程 fork 前加载好的数据。
大对象可利用 copy-on-write。
```

缺点：

```text
会继承父进程里的线程、锁、连接、CUDA/GPU 状态等。
复杂服务里容易埋雷。
```

---

## 2.4 forkserver

流程：

```text
主进程
  -> 启动一个比较干净的 forkserver 进程
  -> 以后创建子进程时，请 forkserver 去 fork
```

图：

```text
spawn:

主进程
  -> 新 Python 子进程

fork:

主进程
  -> 直接 fork 出子进程

forkserver:

主进程
  -> forkserver 进程
       -> fork 子进程 1
       -> fork 子进程 2
```

目的：

```text
不要从复杂主进程直接 fork。
从一个相对干净的 server 进程 fork。
```

适合：

```text
Linux/POSIX 服务端
主进程里已经有线程、锁、event loop、连接池等复杂状态
```

记法：

```text
fork       看父进程当前状态
spawn      看文件顶层初始化状态
forkserver 看干净 server 的状态，不要指望继承主进程后来改过的变量
```

---

# 3. Queue

## 3.1 Queue 是什么

```text
multiprocessing.Queue 是进程间消息队列。
它不是共享 Python list。
底层大致是：OS pipe/fd + pickle + lock + semaphore + Python 封装。
```

一句话：

```text
Queue 传的是消息副本，不是共享对象。
```

---

## 3.2 基本写法

```python
from multiprocessing import Process, Queue

def worker(q):
    q.put(100)

if __name__ == "__main__":
    q = Queue()

    p = Process(target=worker, args=(q,))
    p.start()

    result = q.get()

    p.join()
    print(result)
```

输出：

```text
100
```

---

## 3.3 put/get

```python
q.put(obj)
```

含义：

```text
把一个对象放进队列。
底层会把对象 pickle 成 bytes，再写进 pipe。
```

```python
q.get()
```

含义：

```text
从队列取一个对象。
如果队列为空，会阻塞等待。
```

```python
q.get(timeout=3)
```

含义：

```text
最多等 3 秒。
3 秒内没数据，抛 queue.Empty。
不会杀生产者进程。
```

---

## 3.4 Queue 底层原理

```text
进程 A q.put(obj)
  -> pickle.dumps(obj)
  -> 得到 bytes
  -> 写入 OS pipe

进程 B q.get()
  -> 从 OS pipe 读 bytes
  -> pickle.loads(bytes)
  -> 重新创建 Python 对象
```

所以：

```python
data = [1, 2, 3]
q.put(data)
data.append(4)
```

另一进程 `q.get()` 更可能拿到：

```python
[1, 2, 3]
```

原因：

```text
Queue 放进去的是 pickle 那一刻的内容副本。
不是原对象引用。
```

---

## 3.5 Queue 和缓冲区

Queue 有缓冲。

分两层：

```text
Python Queue 层：
    内部 buffer / feeder thread / semaphore

OS pipe 层：
    pipe buffer，按 bytes 算
```

`Queue(maxsize=N)`：

```text
控制队列最多允许大约放多少个 item。
不是控制底层 pipe 有多少 bytes。
```

---

## 3.6 任务队列模式

```python
from multiprocessing import Process, Queue

def worker(task_q, result_q):
    while True:
        item = task_q.get()

        if item is None:
            break

        result_q.put(item * item)

if __name__ == "__main__":
    task_q = Queue()
    result_q = Queue()

    p = Process(target=worker, args=(task_q, result_q))
    p.start()

    for x in [1, 2, 3]:
        task_q.put(x)

    task_q.put(None)

    for _ in range(3):
        print(result_q.get())

    p.join()
```

`None` 是哨兵值：

```text
告诉 worker：没有任务了，可以退出。
```

如果有 3 个 worker：

```python
for _ in range(3):
    task_q.put(None)
```

口诀：

```text
任务有几个，结果 get 几次。
worker 有几个，None 放几个。
```

---

# 4. Pipe

## 4.1 Pipe 是什么

```text
Pipe 是两个连接端。
适合两个进程一对一通信。
```

```python
parent_conn, child_conn = Pipe()
```

图：

```text
parent_conn <==========> child_conn
```

---

## 4.2 基本写法

```python
from multiprocessing import Process, Pipe

def worker(conn):
    conn.send("hello")
    conn.close()

if __name__ == "__main__":
    parent_conn, child_conn = Pipe()

    p = Process(target=worker, args=(child_conn,))
    p.start()

    msg = parent_conn.recv()
    print(msg)

    p.join()
```

输出：

```text
hello
```

---

## 4.3 send/recv

```python
conn.send(obj)
```

含义：

```text
把对象 pickle 成 bytes，发送到管道另一端。
```

```python
conn.recv()
```

含义：

```text
从管道接收一条消息。
如果没有消息，会阻塞等待。
```

---

## 4.4 poll

```python
if conn.poll(2):
    msg = conn.recv()
else:
    print("no message")
```

含义：

```text
poll(2) 最多等 2 秒，检查有没有消息。
有消息返回 True。
没消息返回 False。
poll 不会取走消息。
recv 才会真正消费消息。
```

---

## 4.5 Queue vs Pipe

```text
Queue：
    多生产者、多消费者
    适合任务分发、结果收集

Pipe：
    两端直连
    适合父子进程一对一通信
```

记法：

```text
Queue = 邮箱
Pipe  = 电话线
```

---

# 5. Value

## 5.1 Value 是什么

```text
Value 用来共享一个简单值。
比如共享一个 int / float。
```

```python
from multiprocessing import Process, Value

def worker(counter):
    counter.value = 100

if __name__ == "__main__":
    counter = Value("i", 0)

    p = Process(target=worker, args=(counter,))
    p.start()
    p.join()

    print(counter.value)
```

输出：

```text
100
```

---

## 5.2 counter 和 counter.value

```python
counter = Value("i", 0)
```

含义：

```text
创建一块共享内存。
里面放一个 signed int，初始值是 0。
counter 是访问这块共享内存的包装对象。
counter.value 才是真正的值。
```

记法：

```text
counter        是共享变量的壳 / 句柄 / 入口
counter.value  是共享内存里的真实数值
```

---

## 5.3 类型码

常见：

```text
"i"  signed int
"d"  double
```

常用：

```python
Value("i", 0)
Value("d", 0.0)
```

---

## 5.4 Value 和锁

```python
counter.value += 1
```

不是原子操作，实际是：

```text
1. 读 counter.value
2. 加 1
3. 写回 counter.value
```

多个进程同时执行会有竞态。

正确写法：

```python
def worker(counter):
    with counter.get_lock():
        counter.value += 1
```

口诀：

```text
共享内存负责共享数据。
锁负责防止并发写乱。
```

---

# 6. Array

## 6.1 Array 是什么

```text
Value = 共享一个格子
Array = 共享多个格子
```

例子：

```python
from multiprocessing import Process, Array

def worker(arr):
    arr[0] = 100

if __name__ == "__main__":
    arr = Array("i", [1, 2, 3])

    p = Process(target=worker, args=(arr,))
    p.start()
    p.join()

    print(arr[:])
```

输出：

```text
[100, 2, 3]
```

---

## 6.2 语法

```python
arr = Array("i", [1, 2, 3])
```

含义：

```text
创建一块共享内存。
里面连续放 3 个 signed int。
初始值是 [1, 2, 3]。
```

读写：

```python
arr[0]
arr[0] = 100
arr[:]      # 返回普通 list 副本，方便打印
```

---

## 6.3 Array 也要考虑锁

```python
arr[0] += 1
```

也不是原子操作。

需要：

```python
with arr.get_lock():
    arr[0] += 1
```

---

# 7. Manager

## 7.1 Manager 是什么

`Value / Array` 适合简单值。

`Manager` 适合共享复杂对象：

```text
dict
list
Namespace
Lock
Queue
```

例子：

```python
from multiprocessing import Process, Manager

def worker(d):
    d["x"] = 1

if __name__ == "__main__":
    with Manager() as manager:
        d = manager.dict()

        p = Process(target=worker, args=(d,))
        p.start()
        p.join()

        print(dict(d))
```

---

## 7.2 Manager 原理

```text
Manager 会启动一个服务进程。
真正的 dict/list 存在 Manager 进程里。
其他进程拿到的是 proxy 代理对象。
```

图：

```text
主进程              子进程
  |                   |
proxy               proxy
  \                  /
   \                /
    Manager 服务进程
       真正的 dict/list 在这里
```

所以：

```python
d["x"] = 1
```

实际像：

```text
当前进程通过 proxy 发请求给 Manager 进程：
    请设置 dict["x"] = 1

Manager 进程真正修改内部 dict。
```

---

## 7.3 Manager 优缺点

优点：

```text
用起来方便。
支持 dict/list 等复杂对象。
```

缺点：

```text
慢。
每次操作都可能变成跨进程通信。
```

不要高频这样做：

```python
for _ in range(1_000_000):
    d["count"] = d.get("count", 0) + 1
```

---

## 7.4 Manager 也有竞态

```python
d["count"] = d.get("count", 0) + 1
```

不是原子操作：

```text
1. get
2. 本地 +1
3. set
```

多个进程同时执行可能丢更新。

需要：

```python
with lock:
    d["count"] = d.get("count", 0) + 1
```

---

# 8. shared_memory

## 8.1 shared_memory 是什么

```text
shared_memory 创建一块有名字的原始共享内存 buffer。
多个进程通过 name 连接到同一块 buffer。
```

适合：

```text
大 numpy array
图片 buffer
音频 buffer
批量特征
大块只读数据
```

---

## 8.2 最小例子

```python
from multiprocessing import Process
from multiprocessing import shared_memory

def worker(name):
    shm = shared_memory.SharedMemory(name=name)
    shm.buf[0] = 100
    shm.close()

if __name__ == "__main__":
    shm = shared_memory.SharedMemory(create=True, size=10)

    shm.buf[0] = 1

    p = Process(target=worker, args=(shm.name,))
    p.start()
    p.join()

    print(shm.buf[0])

    shm.close()
    shm.unlink()
```

输出：

```text
100
```

---

## 8.3 shm.name

```python
p = Process(target=worker, args=(shm.name,))
```

不是传大对象。

而是传共享内存名字。

```text
父进程创建共享内存 psm_xxx。
子进程通过名字 psm_xxx 连接到同一块内存。
```

---

## 8.4 close 和 unlink

```python
shm.close()
```

含义：

```text
当前进程不用这块共享内存了。
关闭当前进程手里的句柄 / 访问入口。
```

```python
shm.unlink()
```

含义：

```text
删除共享内存的名字。
以后新进程不能再通过 name 连接。
等没有进程再使用时，系统可以回收。
```

类比：

```text
close  = 我关掉自己打开的文件句柄
unlink = 删除资源名 / 门牌号
```

常见规则：

```text
子进程：只 close
父进程/创建者：最后 close + unlink
```

---

## 8.5 shared_memory + numpy

裸 `shm.buf` 只是 bytes。

```python
shm = shared_memory.SharedMemory(create=True, size=16)
```

它只知道：

```text
我有 16 个 bytes。
```

它不知道这是：

```text
4 个 int32？
2 个 float64？
16 个 uint8？
```

需要 numpy 解释：

```python
import numpy as np
from multiprocessing import shared_memory

data = np.array([1, 2, 3, 4], dtype=np.int32)
shm = shared_memory.SharedMemory(create=True, size=data.nbytes)

shared_arr = np.ndarray(data.shape, dtype=data.dtype, buffer=shm.buf)
shared_arr[:] = data[:]
```

子进程需要知道：

```text
shm.name
shape
dtype
```

因为共享内存只保存 bytes，不保存 numpy 元信息。

---

# 9. 同步原语

进程同步原语和线程同步原语概念很像，但对象不能混用。

```text
线程之间同步：threading.*
进程之间同步：multiprocessing.*
协程之间同步：asyncio.*
```

口诀：

```text
同步谁，就用谁家的锁。
```

---

## 9.1 Lock

```python
from multiprocessing import Lock

lock = Lock()

with lock:
    # 临界区
    ...
```

含义：

```text
同一时间只允许一个进程进入临界区。
```

注意：

```text
Lock 保护的不是变量本身。
Lock 保护的是一段代码不被多个进程同时执行。
```

---

## 9.2 RLock

```text
可重入锁。
同一个执行流拿到锁后，可以再次拿同一把锁。
acquire 几次，需要 release 几次。
```

用法：

```text
能用 Lock 就用 Lock。
只有递归调用 / 嵌套调用需要重复拿同一把锁时，才用 RLock。
```

---

## 9.3 Semaphore

```python
sem = Semaphore(3)

with sem:
    ...
```

含义：

```text
最多允许 3 个进程同时进入。
```

场景：

```text
限制同时访问某资源的 worker 数量
限制同时打开文件数
限制同时跑重任务数量
```

---

## 9.4 Event

常用方法：

```python
event.wait()
event.set()
event.clear()
event.is_set()
```

含义：

```text
wait()    等事件发生
set()     设置为 True，唤醒等待者
clear()   重置为 False
is_set()  查看当前状态
```

记法：

```text
Event = 开关 / 发令枪
```

场景：

```text
通知 worker 开始
通知 worker 停止
等初始化完成后统一放行
```

---

## 9.5 Condition

```text
Condition = Lock + wait/notify
```

典型写法：

```python
with cond:
    while not ready:
        cond.wait()
```

另一边：

```python
with cond:
    ready = True
    cond.notify_all()
```

注意：

```text
Condition.wait() 通常放在 while 里，不是 if。
```

---

# 10. ProcessPoolExecutor

## 10.1 定位

```text
ProcessPoolExecutor 和 ThreadPoolExecutor API 基本一样。
但底层是多个子进程。
```

记法：

```text
语法像线程池。
限制像 multiprocessing。
```

---

## 10.2 最小写法

```python
from concurrent.futures import ProcessPoolExecutor

def task(x):
    return x * x

if __name__ == "__main__":
    with ProcessPoolExecutor(max_workers=4) as executor:
        fut = executor.submit(task, 10)
        print(fut.result())
```

---

## 10.3 submit / Future

```python
fut = executor.submit(task, 10)
```

含义：

```text
提交 task(10) 给进程池。
返回 Future。
```

```python
fut.result()
```

含义：

```text
等任务完成。
成功就返回值。
失败就把子进程里的异常重新抛到父进程。
```

---

## 10.4 map

```python
results = executor.map(task, [1, 2, 3, 4])
```

特点：

```text
按输入顺序返回结果。
不是按完成顺序。
```

如果第一个任务很慢，后面的任务即使先完成，也要等第一个结果先吐出来。

---

## 10.5 as_completed

```python
from concurrent.futures import as_completed

futures = [executor.submit(task, i) for i in range(10)]

for fut in as_completed(futures):
    print(fut.result())
```

特点：

```text
谁先完成，就先返回谁。
```

对比：

```text
map          = 按输入顺序
as_completed = 按完成顺序
```

---

## 10.6 timeout / cancel / shutdown

```python
fut.result(timeout=3)
```

含义：

```text
最多等 3 秒。
超时抛 TimeoutError。
不会杀任务。
```

```python
fut.cancel()
```

含义：

```text
尝试取消还没开始执行的任务。
已经开始执行的任务通常取消不了。
```

```python
executor.shutdown(cancel_futures=True)
```

含义：

```text
取消还没开始的 pending futures。
不会取消已经开始运行的任务。
```

---

## 10.7 限制

ProcessPoolExecutor 必须记：

```text
1. task 函数最好写在模块顶层
2. 参数要能 pickle
3. 返回值要能 pickle
4. 进程池代码放在 if __name__ == "__main__" 下
5. 不适合特别小、特别碎的任务
```

大量小任务可以考虑：

```python
executor.map(task, items, chunksize=1000)
```

`chunksize`：

```text
把大量小任务按块分发，减少调度成本。
```

---

## 10.8 适用场景

适合：

```text
独立批处理任务
CPU 密集任务
输入明确、输出明确
不需要复杂通信
```

例如：

```text
批量日志解析
批量图片处理
批量 JSON 解析
批量特征计算
```

---

# 11. multiprocessing.Pool

## 11.1 定位

```text
multiprocessing.Pool 是老 API 风格的进程池。
ProcessPoolExecutor 是 concurrent.futures 风格，更统一。
```

---

## 11.2 基本写法

```python
from multiprocessing import Pool

def task(x):
    return x * x

if __name__ == "__main__":
    with Pool(processes=4) as pool:
        results = pool.map(task, [1, 2, 3, 4])

    print(results)
```

输出：

```text
[1, 4, 9, 16]
```

---

## 11.3 常用 API

```python
pool.map(fn, items)
```

```text
阻塞等待所有任务完成。
返回 list。
按输入顺序。
```

```python
pool.imap(fn, items)
```

```text
迭代式返回。
仍按输入顺序。
```

```python
pool.imap_unordered(fn, items)
```

```text
谁先完成先返回谁。
不保证输入顺序。
```

```python
pool.apply_async(fn, args=(arg,))
```

```text
异步提交单个任务。
返回 AsyncResult。
AsyncResult.get() 等结果。
```

---

## 11.4 Pool 和 Executor 对比

```text
ProcessPoolExecutor.submit(fn, arg)
≈ Pool.apply_async(fn, args=(arg,))

Future.result()
≈ AsyncResult.get()

executor.map(fn, items)
≈ pool.map(fn, items)

as_completed(futures)
≈ pool.imap_unordered(fn, items)
```

---

## 11.5 Pool 关闭

正常关闭：

```python
pool.close()
pool.join()
```

含义：

```text
close：不再接收新任务，已有任务正常完成
join：等待 worker 退出
```

强制终止：

```python
pool.terminate()
pool.join()
```

含义：

```text
terminate：直接终止 worker
join：等待回收
```

---

# 12. 异常、超时、卡死

## 12.1 Process 异常不会自动抛给父进程

```python
from multiprocessing import Process

def worker():
    raise ValueError("boom")

if __name__ == "__main__":
    p = Process(target=worker)
    p.start()
    p.join()

    print("parent continue")
    print(p.exitcode)
```

重点：

```text
子进程抛异常，父进程不会在 p.join() 处重新抛异常。
join 只负责等。
父进程要看 p.exitcode。
```

---

## 12.2 exitcode

```text
0      正常结束
非 0   异常退出
负数   被信号杀死
```

工程写法：

```python
p.join()

if p.exitcode == 0:
    print("success")
else:
    print("failed:", p.exitcode)
```

---

## 12.3 想拿异常详情：用 Queue 传回来

```python
from multiprocessing import Process, Queue
import traceback

def worker(q):
    try:
        raise ValueError("boom")
    except Exception:
        q.put({
            "ok": False,
            "error": traceback.format_exc(),
        })
    else:
        q.put({
            "ok": True,
            "result": "done",
        })

if __name__ == "__main__":
    q = Queue()

    p = Process(target=worker, args=(q,))
    p.start()

    msg = q.get()
    p.join()

    if not msg["ok"]:
        print(msg["error"])
```

---

## 12.4 卡死处理模板

```python
p.start()

p.join(timeout=3)

if p.is_alive():
    p.terminate()
    p.join(timeout=1)

if p.is_alive():
    p.kill()
    p.join()

print("exitcode:", p.exitcode)
```

流程：

```text
先给它机会正常结束。
超时后 terminate。
terminate 不掉再 kill。
最后 join 回收。
```

---

# 13. subprocess

## 13.1 subprocess 是什么

```text
multiprocessing：启动 Python 子进程，执行 Python 函数
subprocess：启动外部程序 / 外部命令
```

判断：

```text
跑 Python 函数：multiprocessing
跑外部命令：subprocess
```

---

## 13.2 subprocess.run

```python
import subprocess

result = subprocess.run(
    ["echo", "hello"],
    capture_output=True,
    text=True,
)

print(result.stdout)
print(result.returncode)
```

参数：

```text
capture_output=True  捕获 stdout / stderr
text=True            输出解码成 str，不是 bytes
check=True           返回码非 0 时抛 CalledProcessError
timeout=3            超时后终止子进程并抛 TimeoutExpired
```

注意：

```text
subprocess.run(timeout=3) 会处理超时并终止子进程。
这和 p.join(timeout)、future.result(timeout) 不一样。
```

---

## 13.3 Popen

`run()` 是：

```text
启动 -> 等结束 -> 返回结果
```

`Popen()` 是：

```text
启动后不等待，可以手动控制。
```

例子：

```python
import subprocess
import time

p = subprocess.Popen(["sleep", "10"])

time.sleep(3)

p.terminate()
p.wait()

print(p.returncode)
```

常用：

```python
p.poll()       # 检查是否结束；没结束返回 None
p.wait()       # 等进程结束
p.terminate()  # 请求终止
p.kill()       # 强杀
```

---

## 13.4 安全点：少用 shell=True

不推荐：

```python
subprocess.run("rm -rf " + user_input, shell=True)
```

推荐：

```python
subprocess.run(["rm", "-rf", user_input])
```

原因：

```text
避免 shell 注入。
参数用 list 传更安全。
```

---

## 13.5 AI Infra 常见用途

```text
nvidia-smi
ffmpeg
docker
kubectl
curl
tritonserver
vllm serve
benchmark 脚本
模型转换脚本
```

---

# 14. 怎么选择

## 14.1 线程、协程、进程

```text
IO 密集：
    ThreadPoolExecutor / asyncio

CPU 密集：
    ProcessPoolExecutor / multiprocessing

跑外部程序：
    subprocess

大数组共享：
    shared_memory

复杂共享状态：
    Manager，但注意性能

长期 worker：
    Process + Queue

一次性独立批处理：
    ProcessPoolExecutor
```

---

## 14.2 Process + Queue vs ProcessPoolExecutor

### ProcessPoolExecutor

适合：

```text
一批独立任务
每个任务输入明确、输出明确
任务之间不需要复杂通信
```

例如：

```text
批量日志文件解析
批量图片处理
批量特征计算
```

### Process + Queue

适合：

```text
长期 worker
父进程不断发任务
worker 持续返回结果
需要手动重启、心跳、超时 kill、控制信号
```

例如：

```text
常驻预处理 worker
推理服务请求队列
任务调度器
需要重启卡死 worker 的系统
```

口诀：

```text
独立批处理任务：ProcessPoolExecutor
长期可控 worker：Process + Queue
```
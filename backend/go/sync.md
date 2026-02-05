## Mutex

```go
type Mutex struct {
	state int32
	sema  uint32
}
```

`state`是复合型字段：

第 0 bit 表示是否被锁上，1表示已锁定，0表示未锁定

第 1 bit 表示是否有一个正在等待的 Goroutine 被唤醒了（或正在自旋），此时持有锁的 Goroutine 在释放锁时，不需要再去唤醒其他协程（减少不必要的上下文切换）

第 2 bit表示是否进入了“饥饿模式”，在这种模式下，锁的所有权会直接从释放者移交给等待队列头部的 waiter，防止长尾延迟

第 3~31 bit用来记录有多少个 Goroutine 正在等待这把锁

`sema`是信号量，维护了一个等待队列

### 两种工作模式

1. 正常模式：等待的 Goroutine 按照 FIFO 排队。但是， **被唤醒的 Goroutine 不会直接拥有锁** ，它必须和新来的 Goroutine（正在 CPU 上运行，刚刚调用 `Lock` 的）竞争
2. 饥饿模式：锁的所有权 **直接** 从释放锁的 Goroutine 移交给等待队列最前端的 Goroutine，新来的 Goroutine 不会尝试抢锁，也不会自旋，而是乖乖排到队列尾部；

   - 触发条件：如果为一个 Goroutine 等待锁的时间超过 1ms，它会将 Mutex 切换到饥饿模式
   - 退出条件：当等待者获取到锁，且它是最后一个等待者，或者它等待的时间小于 1ms，锁会切回正常模式

```go
func (m *Mutex) Lock() {
	// Fast path: grab unlocked mutex.
	if atomic.CompareAndSwapInt32(&m.state, 0, mutexLocked) { // state的值为0并且加锁成功
		return
	}
	// Slow path (outlined so that the fast path can be inlined)
	m.lockSlow()
}

func (m *Mutex) lockSlow() {
	var waitStartTime int64 // 开始等待的时间戳
	starving := false
	awoke := false
	iter := 0 // 自旋计数器
	old := m.state
	for {
		// 锁被占用但是不处于饥饿状态
		// 如果自旋次数没到限制并且是多核cpu就开始自旋
		if old&(mutexLocked|mutexStarving) == mutexLocked && runtime_canSpin(iter) {
			// 如果没有设置awoke && 没有goroutine处于唤醒状态 && 等待队列中goroutine数量大于0
			// 尝试设置锁的状态为 有goroutine处于唤醒状态
			if !awoke && old&mutexWoken == 0 && old>>mutexWaiterShift != 0 &&
				atomic.CompareAndSwapInt32(&m.state, old, old|mutexWoken) {
				awoke = true
			}
			runtime_doSpin() // 开始自旋
			iter++
			old = m.state
			continue
		}

		new := old
		// 如果是饥饿状态就不进行抢锁，否则进行抢锁
		if old&mutexStarving == 0 {
			new |= mutexLocked
		}
		// 如果锁依然是持有的或者是处于饥饿状态，就进行排队
		if old&(mutexLocked|mutexStarving) != 0 {
			new += 1 << mutexWaiterShift // 排队数量 + 1
		}

		// 处于饥饿状态并且锁被持有，则开启饥饿标志
		if starving && old&mutexLocked != 0 {
			new |= mutexStarving
		}

		if awoke {
			// The goroutine has been woken from sleep,
			// so we need to reset the flag in either case.
			if new&mutexWoken == 0 {
				throw("sync: inconsistent mutex state")
			}
			new &^= mutexWoken // 清除 woken 标志
		}
		// 开始换状态，如果能抢锁就抢锁
		if atomic.CompareAndSwapInt32(&m.state, old, new) {
			if old&(mutexLocked|mutexStarving) == 0 {
				break // 这个时候锁没有被持有也不是饥饿状态，那就成功抢到锁
			}
			// If we were already waiting before, queue at the front of the queue.
			queueLifo := waitStartTime != 0
			if waitStartTime == 0 {
				waitStartTime = runtime_nanotime()
			}
			runtime_SemacquireMutex(&m.sema, queueLifo, 2) // 把当前goroutine挂起
			starving = starving || runtime_nanotime()-waitStartTime > starvationThresholdNs
			old = m.state
			// 饥饿情况下被唤醒
			if old&mutexStarving != 0 {
				// If this goroutine was woken and mutex is in starvation mode,
				// ownership was handed off to us but mutex is in somewhat
				// inconsistent state: mutexLocked is not set and we are still
				// accounted as waiter. Fix that.
				if old&(mutexLocked|mutexWoken) != 0 || old>>mutexWaiterShift == 0 {
					throw("sync: inconsistent mutex state")
				}
				// 拿到了锁就需要减少等待数量
				delta := int32(mutexLocked - 1<<mutexWaiterShift)
				// 如果不是饥饿状态或者已经是最后一个goroutine了，就消除锁的饥饿标志
				if !starving || old>>mutexWaiterShift == 1 {
					// Exit starvation mode.
					// Critical to do it here and consider wait time.
					// Starvation mode is so inefficient, that two goroutines
					// can go lock-step infinitely once they switch mutex
					// to starvation mode.
					delta -= mutexStarving
				}
				atomic.AddInt32(&m.state, delta)
				break
			}
			awoke = true
			iter = 0
		} else {
			old = m.state
		}
	}
}
```

当调用 `Lock()` 时，代码首先尝试  **Fast Path（快速路径）** ，直接通过 `atomic.CompareAndSwapInt32` 将 `state` 从 0 修改为 `mutexLocked`，若成功则直接返回。

若失败，进入 `lockSlow` 的  **`for` 死循环** 。在循环中，首先判断是否满足自旋条件（如多核、非饥饿），若满足则执行 `runtime_doSpin` 进行 **CPU 空转**并尝试设置 `mutexWoken` 标志以减少不必要的唤醒；自旋结束后，根据当前模式计算 `new` 状态（正常模式下尝试设置 `mutexLocked` 抢锁，否则增加 `mutexWaiterShift` 计数排队，或在长尾延迟下开启 `mutexStarving`）；接着通过 `CAS` 提交新状态，若未能抢到锁，则调用 `runtime_SemacquireMutex` 进入  **休眠阻塞** 。

当被 `Unlock` 唤醒后，会判断当前模式：若是  **饥饿模式** ，锁的所有权已直接移交，当前协程通过 `atomic.AddInt32` 修正状态（减去等待计数、设置锁定位置）后直接返回；若是  **正常模式** ，则重置自旋次数，**重新进入循环**与新来的协程竞争抢锁。

```go
func (m *Mutex) Unlock() {
	// Fast path: drop lock bit.
	new := atomic.AddInt32(&m.state, -mutexLocked)
	if new != 0 {
		// Outlined slow path to allow inlining the fast path.
		// To hide unlockSlow during tracing we skip one extra frame when tracing GoUnblock.
		m.unlockSlow(new)
	}
}

func (m *Mutex) unlockSlow(new int32) {
	if (new+mutexLocked)&mutexLocked == 0 {
		fatal("sync: unlock of unlocked mutex")
	}
	if new&mutexStarving == 0 { // 非饥饿模式
		old := new
		for {
			// 如果没有等待者
			// 如果锁已经被抢走处于mutexLock了
			// 如果锁处于 woken 标志
			// 如果锁突然处于饥饿状态
			// 就什么都不做
			if old>>mutexWaiterShift == 0 || old&(mutexLocked|mutexWoken|mutexStarving) != 0 {
				return
			}
			// Grab the right to wake someone.
			// 准备唤醒
			new = (old - 1<<mutexWaiterShift) | mutexWoken
			if atomic.CompareAndSwapInt32(&m.state, old, new) {
				runtime_Semrelease(&m.sema, false, 2) // 唤醒等待的goroutine
				return
			}
			old = m.state
		}
	} else {
		// Starving mode: handoff mutex ownership to the next waiter, and yield
		// our time slice so that the next waiter can start to run immediately.
		// Note: mutexLocked is not set, the waiter will set it after wakeup.
		// But mutex is still considered locked if mutexStarving is set,
		// so new coming goroutines won't acquire it.
		runtime_Semrelease(&m.sema, true, 2) // 饥饿状态就开始唤醒
	}
}
```

当调用 `Unlock()` 时，首先尝试  **Fast Path** ，通过 `atomic.AddInt32` 移除 `mutexLocked` 标志。如果结果为 0，说明没有等待者，直接返回；如果结果不为 0，进入 `unlockSlow`。

在 **正常模式** 下，代码会通过 `for` 循环（确保锁的状态被更新成功，有goroutine被唤醒并且等待数量减1，因为锁是乐观锁所以需要循环重试）检查是否有必要唤醒等待者（若已有其他协程在抢锁或已加锁，则直接返回），确定需要唤醒时，通过 CAS 减少等待计数并设置 `mutexWoken` 标志，最后调用 `runtime_Semrelease(handoff=false)` 唤醒一个等待者让其参与竞争；而在 **饥饿模式** 下，逻辑极其简单，直接调用 `runtime_Semrelease(handoff=true)` 将锁的所有权 **定点移交** 给等待队列头部的协程，期间不修改 `mutexLocked` 位（由接收者修正）

## RWMutex

```go
type RWMutex struct {
	w           Mutex        // held if there are pending writers
	writerSem   uint32       // semaphore for writers to wait for completing readers
	readerSem   uint32       // semaphore for readers to wait for completing writers
	readerCount atomic.Int32 // number of pending readers
	readerWait  atomic.Int32 // number of departing readers
}

const rwmutexMaxReaders = 1 << 30
```

允许多个读协程同时访问，但写协程必须独占访问

`readerCount` 正数表示当前有 `n` 个读协程持有锁，当写协程要抢锁时，它不会把 `readerCount` 变成 -1，而是减去 `rwmutexMaxReaders` (1<<30)，这样后续有新的读请求可以直接进行累加，后续写请求结束，只需要把 `rwmutexMaxReaders`加回去即可

`readerWait` 当写协程抢到 `w` 锁，并将 `readerCount` 变负（宣示主权）时，可能还有一些**旧的读者**还没读完，写协程会把当时的读者数量复制到 `readerWait` 中，走一个旧读者，`readerWait` 减 1。当减到 0 时，说明路清空了，唤醒写协程

`writerSem`和 `readerSem`用于挂起（休眠）和唤醒协程

### 读锁

```go
func (rw *RWMutex) RLock() {
	if rw.readerCount.Add(1) < 0 {
		// A writer is pending, wait for it.
		runtime_SemacquireRWMutexR(&rw.readerSem, false, 0)
	}
}

func (rw *RWMutex) RUnlock() {
	if r := rw.readerCount.Add(-1); r < 0 {
		// Outlined slow-path to allow the fast-path to be inlined
		rw.rUnlockSlow(r)
	}
}

func (rw *RWMutex) rUnlockSlow(r int32) {
	// A writer is pending.
	if rw.readerWait.Add(-1) == 0 {
		// The last reader unblocks the writer.
		// 最后一个读请求，唤醒写请求
		runtime_Semrelease(&rw.writerSem, false, 1)
	}
}
```

### 写锁

```go
func (rw *RWMutex) Lock() {
	// First, resolve competition with other writers.
	rw.w.Lock()
	// Announce to readers there is a pending writer.
	r := rw.readerCount.Add(-rwmutexMaxReaders) + rwmutexMaxReaders
	// Wait for active readers.
	if r != 0 && rw.readerWait.Add(r) != 0 {
		runtime_SemacquireRWMutex(&rw.writerSem, false, 0)
	}
}

func (rw *RWMutex) Unlock() {
	// Announce to readers there is no active writer.
	r := rw.readerCount.Add(rwmutexMaxReaders)
	if r >= rwmutexMaxReaders {
		race.Enable()
		fatal("sync: Unlock of unlocked RWMutex")
	}
	// Unblock blocked readers, if any.
	for i := 0; i < int(r); i++ {
		runtime_Semrelease(&rw.readerSem, false, 0)
	}
	// Allow other writers to proceed.
	rw.w.Unlock()
}
```

先抢互斥锁（其他写请求要抢就需要排队）

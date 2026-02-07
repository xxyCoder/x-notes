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

## Cond

```go
type Locker interface {
    Lock()
    Unlock()
}

type Cond struct {
    // L 是在观察或更改条件时必须持有的锁
    L Locker

    notify  notifyList
}

type notifyList struct {
    wait   uint32
    notify uint32
    lock   uintptr // key field of the mutex
    head   unsafe.Pointer
    tail   unsafe.Pointer
}
```

`notify` 存储了所有正在调用 `Wait()` 等待被唤醒的 `Goroutine`

```go
func NewCond(l Locker) *Cond {
	return &Cond{L: l}
}

func (c *Cond) Wait() {
	// 注册等待队列，拿到一个 ticket
	t := runtime_notifyListAdd(&c.notify)
	// 释放锁
	c.L.Unlock()
	// 挂起当前 goroutine，让出cpu
	runtime_notifyListWait(&c.notify, t)
	// 被唤醒后拿到锁
	c.L.Lock()
}

func (c *Cond) Signal() {
    // 唤醒队列中等待的 goroutine
    runtime_notifyListNotifyOne(&c.notify)
}

// Broadcast wakes all goroutines waiting on c.
//
// It is allowed but not required for the caller to hold c.L
// during the call.
func (c *Cond) Broadcast() {
	// 叫醒所有 goroutine
    runtime_notifyListNotifyAll(&c.notify)
}
```

## WaitGroup

```go
type WaitGroup struct {
	// Bits (high to low):
	//   bits[0:32]  counter
	//   bits[33:64] wait count
	state atomic.Uint64
	sema  uint32
}
```

1. `counter` 记录有多少个调用了Add方法还是没有调用Done方法的任务
2. `wait` 记录了有多少个 goroutine 正在wait

```go
func (wg *WaitGroup) Add(delta int) {
    // 1. 更新计数器 (Counter)
    // 将 delta 左移 32 位，加到 state 的高 32 位上。
    // state 的低 32 位 (Waiter) 保持不变。
    state := wg.state.Add(uint64(delta) << 32)
    
    // 2. 拆解状态
    v := int32(state >> 32)   // 高位：当前的 Counter (任务数)
    w := uint32(state & 0x7fffffff) // 低位：当前的 Waiter (等待者数)
    
    // 3. 安全检查
    // 计数器不能为负数 (Done 调多了)
    if v < 0 {
        panic("sync: negative WaitGroup counter")
    }
    
    // 这一步检查非常关键：防止并发 Wait 和 Add 的误用
    // 如果 waiters > 0 (有人在等)，且当前 delta > 0 (正在添加新任务)，
    // 且 v == delta (说明这正是导致 counter 从 0 变成非 0 的那次 Add)，
    // 这意味着：之前 Counter 已经是 0 了，有人开始 Wait 了，结果你又 Add 了新任务。
    // WaitGroup 不允许在 Wait 开始后，Counter 归零前并发调用 Add。
    if w != 0 && delta > 0 && v == int32(delta) {
        panic("sync: WaitGroup misuse: Add called concurrently with Wait")
    }
    
    // 4. 判断是否需要唤醒
    // 如果任务还没做完 (v > 0)，或者根本没人等 (w == 0)，直接返回。
    if v > 0 || w == 0 {
        return
    }
    
    // 5. 唤醒所有等待者
    // 走到这里说明：v == 0 (任务做完了) 且 w > 0 (有人在等)。
    
    // 把 state 清零（Counter=0, Waiter=0），这是为了防御性编程，防止后续逻辑混乱
    // 同时也是一种屏障。
    wg.state.Store(0)
    
    // 循环 w 次，唤醒所有在 sema 上睡眠的 goroutine
    for ; w != 0; w-- {
        runtime_Semrelease(&wg.sema, false, 0)
    }
}

func (wg *WaitGroup) Done() {
    wg.Add(-1)
}

func (wg *WaitGroup) Wait() {
    // 这是一个 CAS 循环，因为并发环境下 state 随时在变
    for {
        state := wg.state.Load()
        v := int32(state >> 32)   // Counter
        w := uint32(state & 0x7fffffff) // Waiter

        // 1. Fast Path: 计数器已经是 0 了，不用等，直接走人
        if v == 0 {
            return
        }

        // 2. 准备睡觉：尝试把 Waiter 数量 + 1
        // 使用 CAS 操作，如果 state 没被别人改过，就将低位 +1
        if wg.state.CompareAndSwap(state, state+1) {
            // 3. 真正的阻塞点
            // 调用运行时信号量，挂起当前 goroutine。
            // 直到 Add() 把 Counter 减为 0 时，通过 Semrelease 唤醒这里。
            runtime_SemacquireWaitGroup(&wg.sema, synctestDurable)

            // 4. 醒来后的检查
            // 正常情况下，醒来时 state 已经被 Add() 重置为 0 了。
            // 如果不是 0，说明 WaitGroup 被错误地复用了（即在前一组 Wait 还没完全返回时，又有人调用了 Add）。
            if wg.state.Load() != 0 {
                panic("sync: WaitGroup is reused before previous Wait has returned")
			}
			
            return
		}
    }
}

func (wg *WaitGroup) Go(f func()) {
    wg.Add(1)
    go func() {
        defer wg.Done()
        f()
    }()
}
```

1. 唤醒是在`Add`方法中实现的，而`Done`实际就是调用`Add`
2. `Wait` 的核心逻辑是：检查计数器 -> 如果非零，记录我是等待者 -> 睡觉 -> 被唤醒
3. `Go` 是官方给的补丁，避免忘记 `Add`或者是`Done`
## 最顶层的context

```go
type emptyCtx struct{}
```

一个空结构体不占据内存大小，并且返回的地址为 “zerobase"

```go
package main

import (
	"fmt"
	"unsafe"
)

type emptyCtx struct{}

func main() {
	fmt.Printf("Address of empty struct: %p, %p\n", &emptyCtx{}, &emptyCtx{}) // 两个地址相同
	fmt.Println(unsafe.Sizeof(emptyCtx{})) // 大小为0
}

```

### zerobase

1. 为什么会有zerobase?

   * 如果每次创建一个不占空间的对象，都需要在堆上分配一个内存空间，比较浪费内存和cpu
2. 什么情况下会返回zerobase?

   * 只有被分配在堆上，并且占据大小为0，空对象在结构体中不是最后一个的情况（地址等于下一个字段的地址）
3. 什么情况下不会返回zerobase?

   * 当对象在结构体中末尾（会单独分配一个字节内存，这是因为末尾需要撑开一个字节，避免访问末尾空对象指针，导致返回到下一内存地址真正的对象）
     * 假设你在内存里连续创建了两个对象：`d1` (Data) 和 `d2` (其他对象)
     * 如果没有填充，`&d1.d` 的地址恰好就是 `&d2` 的起始地址，这时候，如果你把 `&d1.d` 这个指针传给了某个函数。
     * **垃圾回收器（GC）** 扫描到这个指针时，它会认为： **“哦！有人在引用 `d2` 对象！”** 。
   * ```go
     package main

     import (
     	"fmt"
     	"unsafe"
     )

     type emptyCtx struct{}

     type Data struct {
     	b struct{} // &d.b == &d.c
     	c int64
     	d struct{}
     }

     type DataSmall struct {
     	b struct{}
     	c int64 // 最后一个字段是普通的 8 字节 int
     }

     func main() {
     	d := Data{}
     	ds := DataSmall{}

     	fmt.Printf("Address of empty struct: %p, %p, %p, %p\n", &d.b, &d.c, &d.d, &emptyCtx{})
     	fmt.Printf("【Data】总大小: %d 字节\n", unsafe.Sizeof(d)) // 16

     	fmt.Printf("【DataSmall】总大小: %d 字节\n", unsafe.Sizeof(ds)) // 8
     }

     ```

## 二层context

分别为backgroundCtx 和 todoCtx

```go
type backgroundCtx struct{ emptyCtx }
type todoCtx struct{ emptyCtx }
```

从结构来看都是一样的，但是从语义来看，backgroundCtx表示最原始的起点，todoCtx表示临时占位符（先放这，以后再改）

## CancelCtx

```go
type cancelCtx struct {
	Context

	mu       sync.Mutex            // protects following fields
	done     atomic.Value          // of chan struct{}, created lazily, closed by first cancel call
	children map[canceler]struct{} // set to nil by the first cancel call
	err      atomic.Value          // set to non-nil by the first cancel call
	cause    error                 // set to non-nil by the first cancel call
}

func (c *cancelCtx) Done() <-chan struct{} {
    d := c.done.Load() // 快速路径，强制从内存或/L1 cache读
    if d != nil {
        return d.(chan struct{})
    }
    c.mu.Lock() // 没有就需要自己创建（懒加载）
    defer c.mu.Unlock()
    d = c.done.Load() // 防止在拿到锁的期间有别的 goroutine 已经初始化了（双重检查）
    if d == nil {
        d = make(chan struct{})
        c.done.Store(d)
    }
    return d.(chan struct{})
}
```

1. `done` 这里是一个非常经典的性能优化。标准库没有直接使用 chan struct{}，而是用了原子值。为了避免互斥锁的高昂开销以及实现无锁的快速读取
2. `children` 这是一个 Set 结构（用 map 模拟）。当父节点取消时，它需要遍历这个 map，递归地调用所有子节点的 `cancel` 方法。这就是“父死子必死”的实现基础

```go
func WithCancel(parent Context) (ctx Context, cancel CancelFunc) {
    c := withCancel(parent)
    return c, func() { c.cancel(true, Canceled, nil) }
}

func withCancel(parent Context) *cancelCtx {
	if parent == nil {
		panic("cannot create context from nil parent")
	}
	c := &cancelCtx{}
	c.propagateCancel(parent, c) // 处理父context的Done相关后续逻辑
	return c
}

func (c *cancelCtx) propagateCancel(parent Context, child canceler) {
	c.Context = parent

	done := parent.Done()
	if done == nil {
		return // parent is never canceled
	}

	select {
	case <-done:
	    // 父节点已死，子节点直接自杀，不需要挂载
		child.cancel(false, parent.Err(), Cause(parent))
		return
	default:
		// 父节点没死，继续下一步
	}

	if p, ok := parentCancelCtx(parent); ok {
		p.mu.Lock()
		if err := p.err.Load(); err != nil {
			// parent has already been canceled
			child.cancel(false, err.(error), p.cause)
		} else {
			if p.children == nil {
				p.children = make(map[canceler]struct{})
			}
			// 将 child 加入父节点的 children map 中
			p.children[child] = struct{}{}
		}
		p.mu.Unlock()
		return
	}

	if a, ok := parent.(afterFuncer); ok {
		// parent implements an AfterFunc method.
		c.mu.Lock()
		stop := a.AfterFunc(func() {
			child.cancel(false, parent.Err(), Cause(parent))
		})
		c.Context = stopCtx{
			Context: parent,
			stop:    stop, // 保存stop，在removeChild中可执行取消回调注册
		}
		c.mu.Unlock()
		return
	}
	
	go func() {
		select {
		case <-parent.Done():
			child.cancel(false, parent.Err(), Cause(parent))
		case <-child.Done():
		}
	}()
}
```

1. 最后开启goroutine进行阻塞等待parent节点完成（执行子节点取消），或者等子节点取消
2. 额外加入了`AfterFunc`方法，目的是为了消除最后的goroutine

```go
func (c *cancelCtx) cancel(removeFromParent bool, err, cause error) {
	if err == nil {
		panic("context: internal error: missing cancel error")
	}
	if cause == nil {
		cause = err
	}
	c.mu.Lock()
	if c.err.Load() != nil {
		c.mu.Unlock()
		return // already canceled
	}
	c.err.Store(err)
	c.cause = cause
	d, _ := c.done.Load().(chan struct{})
	if d == nil {
		c.done.Store(closedchan)
	} else {
		close(d)
	}
	for child := range c.children { // 停止子节点
		// NOTE: acquiring the child's lock while holding parent's lock.
		child.cancel(false, err, cause)
	}
	c.children = nil
	c.mu.Unlock()

	if removeFromParent {
		removeChild(c.Context, c) // 将自己从父节点移除
	}
}

func removeChild(parent Context, child canceler) {
    if s, ok := parent.(stopCtx); ok {
        s.stop() // 如果是stopCtx则取消回调
        return
    }
    p, ok := parentCancelCtx(parent)
    if !ok {
        return
    }
	p.mu.Lock()
    if p.children != nil {
        delete(p.children, child)
    }
    p.mu.Unlock()
}
```

1. 取消子节点需要，`cancel`第一个值需要传递false，避免子节点又把自己从parent节点移除（移除需要加parent的锁），从而避免死锁

## afterFuncCtx

```go
type afterFuncer interface {
    AfterFunc(func()) func() bool
}

type afterFuncCtx struct {
    cancelCtx
    once sync.Once // either starts running f or stops f from running
    f    func()
}

func AfterFunc(ctx Context, f func()) (stop func() bool) {
	a := &afterFuncCtx{
		f: f,
	}
	a.cancelCtx.propagateCancel(ctx, a)
	return func() bool {
		stopped := false
		a.once.Do(func() {
			stopped = true
		})
		if stopped {
			a.cancel(true, Canceled, nil)
		}
		return stopped
	}
}

func (a *afterFuncCtx) cancel(removeFromParent bool, err, cause error) {
	a.cancelCtx.cancel(false, err, cause)
	if removeFromParent {
		removeChild(a.Context, a)
	}
	a.once.Do(func() {
		go a.f() // 执行回调
	})
}
```

## TimerCtx

```go
type timerCtx struct {
	cancelCtx
	timer *time.Timer // Under cancelCtx.mu.

	deadline time.Time
}

func WithDeadline(parent Context, d time.Time) (Context, CancelFunc) {
	return WithDeadlineCause(parent, d, nil)
}

func WithDeadlineCause(parent Context, d time.Time, cause error) (Context, CancelFunc) {
	if parent == nil {
		panic("cannot create context from nil parent")
	}
	if cur, ok := parent.Deadline(); ok && cur.Before(d) {
		// The current deadline is already sooner than the new one.
		return WithCancel(parent)
	}
	c := &timerCtx{
		deadline: d,
	}
	c.cancelCtx.propagateCancel(parent, c)
	dur := time.Until(d)
	if dur <= 0 {
		c.cancel(true, DeadlineExceeded, cause) // deadline has already passed
		return c, func() { c.cancel(false, Canceled, nil) }
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.err.Load() == nil {
		c.timer = time.AfterFunc(dur, func() {
			c.cancel(true, DeadlineExceeded, cause)
		})
	}
	return c, func() { c.cancel(true, Canceled, nil) }
}

func (c *timerCtx) cancel(removeFromParent bool, err, cause error) {
    c.cancelCtx.cancel(false, err, cause)
    if removeFromParent {
    // Remove this timerCtx from its parent cancelCtx's children.
        removeChild(c.cancelCtx.Context, c)
    }
    c.mu.Lock()
    if c.timer != nil {
        c.timer.Stop()
        c.timer = nil
    }
    c.mu.Unlock()
}
```

1. 检查父节点，如果父节点的deadline比子deadline还要早，那么没有意义了，直接把子context退化为cancelCtx
2. timer是一个定时器，过了指定时间后就开始执行cancel
3. 对于cancel进行重写（需要终止定时器），所以即使用完了相关资源也需要调用`cancel`方法避免内存泄漏

## valueCtx

```go
type valueCtx struct {
	Context
	key, val any
}
```

每当你调用一次 `context.WithValue`，Go 就会在原有的 context 之上再套一层 `valueCtx`。如果你存了 5 个值，就会形成一个拥有 5 层包装的“套娃”结构

当你调用 `ctx.Value(key)` 寻找数据时，底层的查找算法其实是一个**递归向上**的过程（或者说是一个单向链表的遍历）

### 为什么不选择map？

1. map不是并发安全的
2. 一般不会存很多值，直接遍历会比hash计算后查找开销要低

## withoutCancelCtx

```go
func WithoutCancel(parent Context) Context {
	if parent == nil {
		panic("cannot create context from nil parent")
	}
	return withoutCancelCtx{parent}
}

type withoutCancelCtx struct {
	c Context
}

func (withoutCancelCtx) Deadline() (deadline time.Time, ok bool) {
	return
}

func (withoutCancelCtx) Done() <-chan struct{} {
	return nil
}

func (withoutCancelCtx) Err() error {
	return nil
}

func (c withoutCancelCtx) Value(key any) any {
	return value(c, key)
}
```

主打一个切断，既需要继承父context，又不想随着父context一起被cancel

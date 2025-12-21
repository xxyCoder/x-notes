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

   * 只有被分配在堆上，并且占据大小为0
3. 什么情况下不会返回zerobase?

   * 当空对象在结构体中不是最后一个的情况（地址等于下一个字段的地址）
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

func withCancel(parent Context) *cancelCtx {
	if parent == nil {
		panic("cannot create context from nil parent")
	}
	c := &cancelCtx{}
	c.propagateCancel(parent, c) // 处理父context的Done相关后续逻辑
	return c
}

func WithCancel(parent Context) (ctx Context, cancel CancelFunc) {
	c := withCancel(parent)
	return c, func() { c.cancel(true, Canceled, nil) }
}
```

done 只有第一次调用Done方法的时候才会进行channel创建，如果只是创建cancelCtx而没有监听，则可以避免性能开销

```go
func (c *cancelCtx) Done() <-chan struct{} {
	d := c.done.Load()
	if d != nil {
		return d.(chan struct{})
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	d = c.done.Load()
	if d == nil {
		d = make(chan struct{}) // 第一次也仅仅第一次进行创建
		c.done.Store(d)
	}
	return d.(chan struct{})
}

// 会触发下面的逻辑
func (c *cancelCtx) propagateCancel(parent Context, child canceler) {
	c.Context = parent

	done := parent.Done()
	if done == nil {
		return // parent is never canceled
	}

	select {
	case <-done:
		// parent is already canceled
		child.cancel(false, parent.Err(), Cause(parent))
		return
	default:
	}

	if p, ok := parentCancelCtx(parent); ok {
		// parent is a *cancelCtx, or derives from one.
		p.mu.Lock()
		if err := p.err.Load(); err != nil {
			// parent has already been canceled
			child.cancel(false, err.(error), p.cause)
		} else {
			if p.children == nil {
				p.children = make(map[canceler]struct{})
			}
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
			stop:    stop,
		}
		c.mu.Unlock()
		return
	}

	goroutines.Add(1)
	go func() {
		select {
		case <-parent.Done():
			child.cancel(false, parent.Err(), Cause(parent))
		case <-child.Done():
		}
	}()
}
```

children 是实现“链式取消"的关键，当最顶上的context被取消后，其children存储的context也需要被取消，当然，如果子context调用了cancel，就需要把自己从children中移除（避免膨胀，允许gc回收）

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
```

例子

```go
package main

import (
	"context"
	"fmt"
	"time"
)

func worker(ctx context.Context, name string) {
	for {
		select {
		case <-ctx.Done():
			fmt.Printf("【%s】收到停止信号，正在清理资源并退出...\n", name)
			fmt.Printf("退出原因：%v\n", ctx.Err()) // 此时 ctx.Err() 会返回 "context canceled"
			return
		default:
			// 5. 模拟正常的业务逻辑
			fmt.Printf("【%s】正在扫描中...\n", name)
			time.Sleep(1 * time.Second)
		}
	}
}

func main() {
	parentCancelCtx, cancel := context.WithCancel(context.Background())
	childCancelCtx, _ := context.WithCancel(parentCancelCtx)

	go worker(parentCancelCtx, "父级任务")
	go worker(childCancelCtx, "子级任务")

	time.Sleep(2 * time.Second)

	fmt.Println(">>> 停止父级任务")
	cancel()

	time.Sleep(1 * time.Second)
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
```

1. 检查父节点，如果父节点的deadline比子deadline还要早，那么没有意义了，直接把子context退化为cancelCtx
2. timer是一个定时器，过了指定时间后就开始执行cancel
3. 对于cancel进行重写

```
func (c *timerCtx) cancel(removeFromParent bool, err, cause error) {
	c.cancelCtx.cancel(false, err, cause)
	if removeFromParent {
		// Remove this timerCtx from its parent cancelCtx's children.
		removeChild(c.cancelCtx.Context, c)
	}
	c.mu.Lock()
	if c.timer != nil {
		c.timer.Stop() // 关闭定时器，释放资源
		c.timer = nil
	}
	c.mu.Unlock()
}
```

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

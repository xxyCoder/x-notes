## Conn

```go
type Conn interface {
	Read(b []byte) (n int, err error)

	Write(b []byte) (n int, err error)

	Close() error

	LocalAddr() Addr

	RemoteAddr() Addr

	SetDeadline(t time.Time) error

	SetReadDeadline(t time.Time) error

	SetWriteDeadline(t time.Time) error
}
```

1. `Read`从连接中读取数据，可通过 `SetReadDeadline `或 `SetDeadline`设置读取超时时间
2. `Write`把数据写入到连接中，可通过 `SetWriteDeadline`或 `SetDeadline`设置写入超时时间
3. `Close`把缓冲区的数据写入到连接中，解除被阻塞的 `Write`和 `Read`并返回错误

### TCPConn

```go
type TCPConn struct {
	conn
}

type conn struct {
	fd *netFD
}

type netFD struct {
	pfd poll.FD

	// immutable until Close
	family      int
	sotype      int
	isConnected bool // handshake completed or use of association with peer
	net         string
	laddr       Addr
	raddr       Addr
}
```

1. **`net.netFD`** : 网络文件描述符，是 Go 网络库与底层 `poll` 库的桥梁
2. **`poll.FD`** : 真正负责与操作系统交互的结构，包含系统调用封装和 `netpoller` 的钩子

#### READ

```go
func (c *conn) Read(b []byte) (int, error) {
	if !c.ok() {
		return 0, syscall.EINVAL
	}
	n, err := c.fd.Read(b)
	if err != nil && err != io.EOF {
		err = &OpError{Op: "read", Net: c.fd.net, Source: c.fd.laddr, Addr: c.fd.raddr, Err: err}
	}
	return n, err
}

func (fd *netFD) Read(p []byte) (n int, err error) {
	n, err = fd.pfd.Read(p)
	runtime.KeepAlive(fd)
	return n, wrapSyscallError(readSyscallName, err)
}

// src/internal/poll/fd_unix.go

func (fd *FD) Read(p []byte) (int, error) {
    // 1. 读锁锁定，防止并发关闭 FD
    if err := fd.readLock(); err != nil {
        return 0, err
    }
    defer fd.readUnlock()

    // 2. 关键：将当前 FD 注册到 netpoller 中
    // 如果 FD 还没注册过 epoll，这里会进行初始化
    if err := fd.pd.prepareRead(fd.isFile); err != nil {
        return 0, err
    }

    for {
        // 3. 直接发起非阻塞的系统调用 syscall.Read
        n, err := ignoringEINTRIO(syscall.Read, fd.Sysfd, p)
    
        if err != nil {
            // 4. 如果返回 EAGAIN，说明内核缓冲区现在没数据
            if err == syscall.EAGAIN && fd.pd.runtime_pollWait(uintptr('r')) == 0 {
                // 5. 重点！runtime_pollWait 会让出当前 Goroutine (G)
                // 直到 netpoller 通知这个 FD 有数据了，协程才会被唤醒回到这里
                continue
            }
        }
    
        // 6. 如果 err != nil 且不是 EAGAIN，或者读到了数据，则返回
        return n, err
    }
}
```

底层还是调用了 `pfd`进行读取数据

#### Write

```go
func (c *conn) Write(b []byte) (int, error) {
	if !c.ok() {
		return 0, syscall.EINVAL
	}
	n, err := c.fd.Write(b)
	if err != nil {
		err = &OpError{Op: "write", Net: c.fd.net, Source: c.fd.laddr, Addr: c.fd.raddr, Err: err}
	}
	return n, err
}

func (fd *netFD) Write(p []byte) (nn int, err error) {
	nn, err = fd.pfd.Write(p)
	runtime.KeepAlive(fd)
	return nn, wrapSyscallError(writeSyscallName, err)
}

func (fd *FD) Write(p []byte) (int, error) {
	// 加锁，避免被Close
	if err := fd.writeLock(); err != nil {
		return 0, err
	}
	defer fd.writeUnlock()
	// 注册到 netpoller
	if err := fd.pd.prepareWrite(fd.isFile); err != nil {
		return 0, err
	}
	var nn int
	for {
		max := len(p)
		// 处理大块数据 在某些操作系统（如 Darwin/macOS）上，一次性向内核发送过大的数据包（例如超过 1GB）可能会失败或导致不确定的行为
		if fd.IsStream && max-nn > maxRW {
			max = nn + maxRW
		}
		// 非阻塞写入
		n, err := ignoringEINTRIO(syscall.Write, fd.Sysfd, p[nn:max])
		if n > 0 {
			if n > max-nn {
				// This can reportedly happen when using
				// some VPN software. Issue #61060.
				// If we don't check this we will panic
				// with slice bounds out of range.
				// Use a more informative panic.
				panic("invalid return from write: got " + itoa.Itoa(n) + " from a write of " + itoa.Itoa(max-nn))
			}
			nn += n
		}
		if nn == len(p) {
			return nn, err
		}
		// 内核缓冲区满则将goroutine挂起
		if err == syscall.EAGAIN && fd.pd.pollable() {
			if err = fd.pd.waitWrite(fd.isFile); err == nil {
				continue
			}
		}
		if err != nil {
			return nn, err
		}
		if n == 0 {
			return nn, io.ErrUnexpectedEOF
		}
	}
}
```

#### 设置超时

```go
func setDeadlineImpl(fd *FD, t time.Time, mode int) error {
	var d int64
	if !t.IsZero() {
		d = int64(time.Until(t))
		if d == 0 {
			d = -1 // don't confuse deadline right now with no deadline
		}
	}
	if err := fd.incref(); err != nil {
		return err
	}
	defer fd.decref()

	if fd.pd.runtimeCtx == 0 {
		return ErrNoDeadline
	}
	runtime_pollSetDeadline(fd.pd.runtimeCtx, d, mode)
	return nil
}
```

1. 超时不是由操作系统内核（如 `SO_RCVTIMEO`）处理的，而是由 Go Runtime 自己维护的一套定时器机制。这样做的好处是 **极致的性能** ——在 Linux 下，不需要频繁地进行 `setsockopt` 系统调用
2. 因为系统调用（如 `setsockopt`）是针对线程的。而 Go 的目标是在一个线程上运行成千上万个协程。如果使用内核的 `SO_RCVTIMEO`，当超时发生时，整个线程会被阻塞或接收信号。通过在 `runtime` 层实现超时，Go 可以精准地只唤醒那一个过期的协程

#### Keep Alive

```go
type KeepAliveConfig struct {
	// If Enable is true, keep-alive probes are enabled.
	Enable bool

	// Idle is the time that the connection must be idle before
	// the first keep-alive probe is sent.
	// If zero, a default value of 15 seconds is used.
	Idle time.Duration

	// Interval is the time between keep-alive probes.
	// If zero, a default value of 15 seconds is used.
	Interval time.Duration

	// Count is the maximum number of keep-alive probes that
	// can go unanswered before dropping a connection.
	// If zero, a default value of 9 is used.
	Count int
}
```

1. `enable`是否开启
2. `Idle` tcp连接空闲多久后发送keep-alive探测包
3. `interval` 决定keep alive探测包发送的间隔
4. `count`决定keep alive探测包发送次数

#### 缓冲区

```go
func setReadBuffer(fd *netFD, bytes int) error {
	// syscall.SOL_SOCKET 表示通用套接字选项
    	// syscall.SO_RCVBUF 表示接收缓冲区
	err := fd.pfd.SetsockoptInt(syscall.SOL_SOCKET, syscall.SO_RCVBUF, bytes)
	runtime.KeepAlive(fd)
	return wrapSyscallError("setsockopt", err)
}

func setWriteBuffer(fd *netFD, bytes int) error {
	// syscall.SO_SNDBUF 表示写入缓冲区
	err := fd.pfd.SetsockoptInt(syscall.SOL_SOCKET, syscall.SO_SNDBUF, bytes)
	runtime.KeepAlive(fd)
	return wrapSyscallError("setsockopt", err)
}
```

`SetReadBuffer`和 `SetWriteBuffer`是控制读写内核缓冲区大小

1. 设置后会覆盖现代 Linux 内核默认开启了 TCP 缓冲区自动调优，自动调优
2. 在 Linux 中，当你通过 `SO_RCVBUF` 设置缓冲区为 `N` 字节时，内核实际上会将其设置为 `2N`

## Linux自动调优


$$
BDP = 带宽 (\text{bps}) \times 往返时延 (\text{RTT, s})
$$

**物理意义** ：BDP 代表了“在任何给定时刻，已经发出但尚未被确认（在途）的最大数据量”。

如果你的 TCP 窗口（缓冲区）比 BDP 小，那么在“确认信号（ACK）”从对方传回你这里之前，你已经把窗口发满了，不得不停下来等。这时，水管就是空的，带宽被白白浪费了，自动调优的目标就是让缓冲区大小始终**略大于或等于**当前的 BDP

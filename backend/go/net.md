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

1. `Read` 读的是从网络上到达本机、且已经存放在 **操作系统内核的套接字接收缓冲区（Socket Receive Buffer）** 里的数据
2. `Write` 写到操作系统内核的套接字发送缓冲区（Socket Send Buffer）
3. `Close` 把缓冲区的数据写入到连接中，解除被阻塞的 `Write`和 `Read`并返回错误
   - 再调用 Read：会返回 n=0 + 错误（通常是 EOF 或 “连接已关闭” 类错误）。
   - 再调用 Write：会返回 n=0 + 错误（“broken pipe” 或 “connection reset by peer”）
   - 对于TCP连接，会异步执行四次挥手
4. `SetXXXDeadline` 的边界是相对时间，过了这个时间相关操作就不可用，调用就会报错超时

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

	// 以下字段在 Close 之前是不可变的
	family      int  // 协议族 (AF_INET, AF_INET6, AF_UNIX)
	sotype      int  // Socket 类型 (SOCK_STREAM, SOCK_DGRAM)
	isConnected bool // 是否已连接 (TCP 三次握手是否完成)
	net         string  // 网络类型字符串 ("tcp", "udp")
	laddr       Addr  // 本地地址
	raddr       Addr  // 远程地址
}
```

1. `poll.FD` 是 Go 语言运行时 (Runtime) 内部的结构体，它直接对接操作系统的 IO 多路复用机制（Linux 的 epoll，macOS 的 kqueue，Windows 的 IOCP）

### UDPConn

```go
type UDPConn struct {
	conn
}
```

1. 和 TCPConn 结构体内容一致
   - 生成 TCPConn 的那个 `netFD`，在创建时系统调用传的是 `SOCK_STREAM`
   - 生成 UDPConn 的那个 `netFD`，在创建时系统调用传的是 `SOCK_DGRAM`

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

1. 并发安全（读锁）：`fd.readLock()` 保证了在进行读操作时，不会与其他并发关闭该文件描述符的操作发生冲突
2. 准备轮询器：`fd.pd.prepareRead()` 会将当前的文件描述符注册到 Go 运行时的网络轮询器（Netpoller，底层对应 Linux 的 epoll 或 macOS 的 kqueue）中
3. 非阻塞系统调用（syscall.Read）：Go 在创建网络连接时，默认会将 Socket 设置为非阻塞模式。因此，syscall.Read 会立即返回
   - 如果内核接收缓冲区里有数据，syscall.Read 会直接读到数据并返回。
     - 如果是 TCP，应用层接收缓冲区（也就是`p`）的长度小于内核接收缓冲区，剩余没读取的会保留在内核接收缓冲区；
     - 如果是 UDP，应用层接收缓冲区（也就是`p`）的长度小于内核接收缓冲区，剩下的字节会被操作系统内核直接无情丢弃
   - 如果缓冲区为空，因为是非阻塞模式，系统调用不会阻塞 OS 线程，而是立刻返回一个 syscall.EAGAIN 错误（表示资源暂时不可用，请重试）
4. runtime_pollWait 是连接系统 I/O 和 Go 调度器的桥梁。它会挂起当前的 Goroutine（将其状态置为 waiting），并释放当前占据的 OS 线程（M）。OS 线程会立刻去执行其他就绪的 Goroutine。
5. 当网卡真正收到数据并写入内核缓冲区后，底层的 epoll 会触发事件，Go 的 Netpoller 会捕获到这个事件，并将之前挂起的 Goroutine 重新放入可运行队列中。Goroutine 被唤醒后，continue 回到 for 循环的开头，再次发起 syscall.Read，此时就能顺利读到数据了。

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

1. `fd.writeLock()`：加写锁，防止在写入过程中其他 Goroutine 并发调用 Close 关闭该文件描述符
2. `fd.pd.prepareWrite()`：将 FD 注册到 Netpoller，为后续可能的挂起和唤醒做准备
3. 代码中对 `maxRW` 的判断是一个非常细节的系统兼容性处理。
   - 在某些操作系统（如 macOS/Darwin）上，如果一次性向内核非阻塞 Socket 写入过大的数据（例如超过 1GB），系统调用可能会直接报错或表现异常。因此，Go 会按 maxRW 为单位把大数据切成小块，分批次调用底层 syscall.Write
   - 如果是UDP也就是 `isStream` 为false，会跳过这一段
4. `ignoringEINTRIO(syscall.Write...)` 发起真实的系统调用。同样，因为是非阻塞 Socket，这步不会卡死系统线程
   - 如果是 TCP，且底层发送缓冲区满了（比如网络拥塞，接收方处理太慢），syscall.Write 无法把数据塞进内核，就会返回 syscall.EAGAIN；此时，代码进入 err == syscall.EAGAIN 分支，调用 fd.pd.waitWrite()。这会把当前的 Goroutine 挂起休眠，交出 CPU 执行权
   - 如果是 UDP ，操作系统要么把你整个数据报完整打包发给网卡，要么直接报错，不会返回写入部分的 `n`；
     - 如果超过底层网络接口的 MTU，则会直接报错；
     - 如果发送缓冲区装不下，会返回 `EAGAIN`
5. 当底层的协议栈将数据发出去，内核发送缓冲区又腾出空间时，底层的 epoll 会触发可写事件。Go 的 Netpoller 捕获后，会唤醒刚刚被挂起的 Goroutine。

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

1. 你的 Read 或 Write 协程因为没有数据而被 epoll 挂起休眠。 
2. 此时，到了你设置的 Deadline 时间，网络数据依然没来。 
3. Go Runtime 内部的监控线程（sysmon）或调度器发现了这个到期的定时器。 
4. Runtime 会主动把之前挂起休眠的那个 Goroutine 强制唤醒。 
5. 唤醒后，Read/Write 函数底层的 pollWait 会返回一个超时错误，随后向用户层抛出我们常见的 os.ErrDeadlineExceeded（即 "i/o timeout"），从而避免了协程死锁。

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

## ListenConfig

```go
func Listen(network, address string) (Listener, error) {
	var lc ListenConfig
	return lc.Listen(context.Background(), network, address)
}

type ListenConfig struct {
    Control func(network, address string, c syscall.RawConn) error

    KeepAliveConfig KeepAliveConfig
}

```

1. `Control` 一个回调函数。如果设置了该字段（不为 nil），它会在底层网络连接（socket）已经创建完成，但尚未绑定（bind）到操作系统之前被调用 
   1. 创建 Socket：调用系统的 `socket()` 系统调用，获得一个文件描述符（FD）。
   2. 触发 Control 钩子：如果配置了 `Control`，此时会将刚才创建的底层 FD 包装成 `syscall.RawConn` 传给该函数
   3. 执行底层的 `bind()` 和 `listen()` 系统调用

## Listener

```go
type Listener interface {
   // Accept waits for and returns the next connection to the listener.
   Accept() (Conn, error)
   
   // Close closes the listener.
   // Any blocked Accept operations will be unblocked and return errors.
   Close() error
   
   // Addr returns the listener's network address.
   Addr() Addr
}

func (lc *ListenConfig) Listen(ctx context.Context, network, address string) (Listener, error) {
	// 域名解析，翻译成真正的ip地址
	addrs, err := DefaultResolver.resolveAddrList(ctx, "listen", network, address, nil)
	if err != nil {
		return nil, &OpError{Op: "listen", Net: network, Source: nil, Addr: nil, Err: err}
	}
	sl := &sysListener{
		ListenConfig: *lc,
		network:      network,
		address:      address,
	}
	var l Listener
	// 地址列表选择第一个ipv4，如果没有选 addrs[0]
	la := addrs.first(isIPv4)
	switch la := la.(type) {
	case *TCPAddr:
		if sl.MultipathTCP() {
			l, err = sl.listenMPTCP(ctx, la)
		} else {
			l, err = sl.listenTCP(ctx, la)
		}
	case *UnixAddr:
		l, err = sl.listenUnix(ctx, la)
	default:
		return nil, &OpError{Op: "listen", Net: sl.network, Source: nil, Addr: la, Err: &AddrError{Err: "unexpected address type", Addr: address}}
	}
	if err != nil {
		return nil, &OpError{Op: "listen", Net: sl.network, Source: nil, Addr: la, Err: err} // l is non-nil interface containing nil pointer
	}
	return l, nil
}
```

1. `Accept` 阻塞等待并返回下一个新的客户端连接
2. `Close` 关闭监听器，停止接受新连接，任何正在 Accept() 上阻塞等待的 Goroutine 都会立即被唤醒，并返回一个错误（通常是 "use of closed network connection"）
3. `Addr` 返回监听器当前实际监听的网络地址

### TCPListener

```go
type TCPListener struct {
    fd *netFD
    lc ListenConfig
}

func (sl *sysListener) listenTCP(ctx context.Context, laddr *TCPAddr) (*TCPListener, error) {
    return sl.listenTCPProto(ctx, laddr, 0)
}

func (sl *sysListener) listenTCPProto(ctx context.Context, laddr *TCPAddr, proto int) (*TCPListener, error) {
    var ctrlCtxFn func(ctx context.Context, network, address string, c syscall.RawConn) error
    if sl.ListenConfig.Control != nil {
        ctrlCtxFn = func(ctx context.Context, network, address string, c syscall.RawConn) error {
            return sl.ListenConfig.Control(network, address, c)
        }
    }

	fd, err := internetSocket(ctx, sl.network, laddr, nil, syscall.SOCK_STREAM, proto, "listen", ctrlCtxFn)
    if err != nil {
        return nil, err
    }
    return &TCPListener{fd: fd, lc: sl.ListenConfig}, nil
}

func internetSocket(ctx context.Context, net string, laddr, raddr sockaddr, sotype, proto int, mode string, ctrlCtxFn func(context.Context, string, string, syscall.RawConn) error) (fd *netFD, err error) {
    family, ipv6only := favoriteAddrFamily(net, laddr, raddr, mode)
    return socket(ctx, net, family, sotype, proto, ipv6only, laddr, raddr, ctrlCtxFn)
}
```

1. `socket` 会强制打上 SOCK_NONBLOCK 和 SOCK_CLOEXEC 标志。在 Go 的世界里，所有的网络 Socket 默认都是非阻塞的；返回的已经调过了 `bind` 和 `listen`方法的套接字。

## Dialer

```go
type Dialer struct {

	Timeout time.Duration

	Deadline time.Time

	LocalAddr Addr

	FallbackDelay time.Duration

	KeepAlive time.Duration

	KeepAliveConfig KeepAliveConfig

	Resolver *Resolver
}


func (d *Dialer) DialContext(ctx context.Context, network, address string) (Conn, error) {
    // 1. 解析地址：返回一个 IP 列表（可能包含 IPv4 和 IPv6）
    addrs, err := d.resolver().resolveAddrList(ctx, "dial", network, address, d.LocalAddr)
  
    // 2. 如果解析出多个地址，进入并发竞速逻辑
    if len(addrs) > 1 && d.fallbackDelay() >= 0 {
        return d.dialParallel(ctx, network, addrs)
    }
  
    // 3. 只有一个地址或禁用并行，则串行连接
    return d.dialSerial(ctx, network, addrs[0])
}

func (d *Dialer) dialParallel(ctx context.Context, network string, addrs addrList) (Conn, error) {
    returned := make(chan struct{}) // 用于通知其他协程停止尝试
    results := make(chan dialResult) // 接收连接结果的通道

    // 尝试启动第一个连接（通常是 IPv6）
    go func() {
        // ... dialSerial ...
        results <- dialResult{conn, err}
    }()

    // 启动定时器：等待 fallbackDelay (默认 300ms)
    // 如果第一个没连上，就启动第二个连接（通常是 IPv4）
    timer := time.NewTimer(d.fallbackDelay())
  
    for i := 0; i < len(addrs); i++ {
        select {
        case res := <-results:
            if res.err == nil {
                close(returned) // 赢家诞生，关闭通道通知其他人
                return res.conn, nil
            }
        case <-timer.C:
            // 时间到，启动下一个地址的连接
            go dialNextAddr()
        }
    }
}


func (fd *netFD) dial(ctx context.Context, laddr, raddr sockaddr, ctrlFn func(string, string, syscall.RawConn) error) error {
    // 1. 创建系统 Socket，注意：默认就是非阻塞的 (SOCK_NONBLOCK)
    if err := fd.ctrlNetwork(ctx, laddr, raddr, ctrlFn); err != nil {
        return err
    }

    // 2. 执行真正的连接
    if err := fd.pfd.Connect(laddr, raddr); err != nil {
        // 如果返回 EINPROGRESS，说明正在握手中，需要 netpoller 介入
        if err == syscall.EINPROGRESS {
            if err := fd.pfd.WaitWrite(); err != nil {
                return err
            }
            // 唤醒后再次检查 Socket 错误状态
            if err := fd.pfd.CheckError(); err != nil {
                return err
            }
        }
    }
}
```

1. 会通过 `Resolver.resolveAddrList`进行域名解析，如果既有ipv6又有ipv4，会先通过goroutine启动ipv6连接，超过 `FallbackDelay`（默认300ms）还没连上就再启动goroutine连接ipv4地址，当其中一个连接成功后中断另一个
2. 开启非阻塞连接，当TCP没握手完成就挂起当前goroutine
3. 当TCP完成，内核会触发该 FD 的“可写”事件，`netpoller` 收到通知，唤醒挂起的 Goroutine

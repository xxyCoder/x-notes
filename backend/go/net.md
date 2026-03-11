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

## socket

```go
func socket(ctx context.Context, net string, family, sotype, proto int, ipv6only bool, laddr, raddr sockaddr, ctrlCtxFn func(context.Context, string, string, syscall.RawConn) error) (fd *netFD, err error) {
    // [关键动作 A]：调用内核系统调用 socket()。
    // syscall.Socket(family, sotype, proto) 拿到一个原始的整型文件描述符 (int fd)。
    // 注意：Go 默认会将该 FD 设为 Non-blocking (非阻塞) 模式。
    s, err := sysSocket(family, sotype, proto)
    if err != nil {
        return nil, err
    }

    // [关键动作 B]：设置 IPv6 专属选项。
    // 如果是 IPv6，根据 ipv6only 参数决定是否允许该 Socket 同时监听/连接 IPv4。
    if err = setIPv6Only(s, ipv6only); err != nil {
        poll.CloseFunc(s)
        return nil, err
    }

    // [关键动作 C]：包装为 netFD。
    // netFD 是 Go 对原始 int fd 的高级封装，它内置了网络轮询器 (Runtime Poller)。
    // 这一步之后，这个 FD 就具备了“能被 Go 协程调度”的能力。
    if fd, err = newFD(s, family, sotype, net); err != nil {
        poll.CloseFunc(s)
        return nil, err
    }

    // [关键动作 D]：执行用户自定义钩子 (ControlContext)。
    // 如果你在 Dialer 里设置了 Control，此时内核刚分配完 FD 但还没开始 connect()。
    // 这就是你通过 syscall 修改 Socket 选项（如 SO_REUSEPORT）的最后机会。
    if ctrlCtxFn != nil {
        if err := ctrlCtxFn(ctx, net, raddr.String(), fd.pfd.RawConn()); err != nil {
            fd.Close()
            return nil, err
        }
    }

    // [关键动作 E]：发起连接或监听。
    if laddr != nil || raddr != nil {
        switch mode {
        case "dial":
            // 重点！这里会调用 fd.connect()。
            // 它是如何实现“非阻塞连接+Context超时”的？请看下方深度解析。
            if err := fd.connect(ctx, laddr, raddr); err != nil {
                fd.Close()
                return nil, err
            }
        case "listen":
            if err := fd.listenStream(laddr, listenerBacklog(), ctrlCtxFn); err != nil {
                fd.Close()
                return nil, err
            }
        }
    }
    return fd, nil
}
```

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

    ControlContext func(ctx context.Context, network, address string, c syscall.RawConn) error
}
```

1. `Deadline` 设置一个绝对的时间点，过了这个时间点，所有的拨号尝试都会立刻失败
2. `Timeout` 设置单次拨号的最长时间（三次握手作为边界点）
3. `FallbackDelay` 指定在发起 IPv6 连接后，等待多久还没成功，就并行发起 IPv4 连接
4. `Resolver` 允许你指定一个自定义的 DNS 解析器
5. `ControlContext` 在实际发起 Dial 连接之前，对底层的 Socket 进行系统调用级别的修改

### DialContext

```go
func (d *Dialer) DialContext(ctx context.Context, network, address string) (Conn, error) {
    // 融合 Dialer 的超时配置与传入 ctx 的截止时间，取最早到达者作为最终边界
    ctx, cancel := d.dialCtx(ctx)
    defer cancel()

    resolveCtx := ctx
    if trace, _ := ctx.Value(nettrace.TraceKey{}).(*nettrace.Trace); trace != nil {
       // 克隆 trace 对象并清空 Connect 钩子。
       // 原因：防止底层的 DNS 查询（UDP）误触发用户设定的“目标 TCP 连接建立”的埋点监控。
       shadow := *trace
       shadow.ConnectStart = nil
       shadow.ConnectDone = nil
       resolveCtx = context.WithValue(resolveCtx, nettrace.TraceKey{}, &shadow)
    }

    // 携带专属的 resolveCtx 进行 DNS 解析，获取目标域名的所有可用 IP 列表
    addrs, err := d.resolver().resolveAddrList(resolveCtx, "dial", network, address, d.LocalAddr)
    if err != nil {
       return nil, &OpError{Op: "dial", Net: network, Source: nil, Addr: nil, Err: err}
    }

    // 组装底层拨号器，将高层 Dialer 配置下沉
    sd := &sysDialer{
       Dialer:  *d,
       network: network,
       address: address,
    }

    var primaries, fallbacks addrList
    if d.dualStack() && network == "tcp" {
       // RFC 6555 Happy Eyeballs 准备阶段：
       // 开启双栈且为 TCP 时，将 IP 列表按 IPv6 (首选) 和 IPv4 (备选) 分离
       primaries, fallbacks = addrs.partition(isIPv4)
    } else {
       primaries = addrs
    }

    // 启动并发竞速：优先尝试 primaries，超时未果则立即并行尝试 fallbacks
    return sd.dialParallel(ctx, primaries, fallbacks)
}
```

仅做超时融合、解析地址以及开启并发竞速

#### dialParallel

```go
func (sd *sysDialer) dialParallel(ctx context.Context, primaries, fallbacks addrList) (Conn, error) {
    if len(fallbacks) == 0 {
       return sd.dialSerial(ctx, primaries)
    }

    // returned 用于在函数退出时向后台还在运行的慢协程广播结束信号。
    // defer close(returned) 确保只要拿到结果退出函数，那些没抢到第一的连接会被立即销毁，防止底层 FD 泄漏。
    returned := make(chan struct{})
    defer close(returned)

    type dialResult struct {
       Conn
       error
       primary bool
       done    bool
    }
    // results 用于接收两个并发协程传回的拨号结果（成功或失败）
    results := make(chan dialResult) // 无缓冲通道

    // startRacer 是负责实际拨号的闭包函数，它会在独立的协程中运行
    startRacer := func(ctx context.Context, primary bool) {
       ras := primaries
       if !primary {
          ras = fallbacks
       }
       // 调用底层方法真正发起串行拨号尝试
       c, err := sd.dialSerial(ctx, ras)
       select {
       // 将拨号结果发送给主控循环的计分板
       case results <- dialResult{Conn: c, error: err, primary: primary, done: true}:
       // 如果准备发送结果时，发现 returned 已经被 close 了，说明别人赢了，直接关掉当前建好的连接
       case <-returned:
          if c != nil {
             c.Close()
          }
       }
    }

    var primary, fallback dialResult

    // 启动主选地址（通常是 IPv6）的拨号协程，率先起跑
    primaryCtx, primaryCancel := context.WithCancel(ctx)
    defer primaryCancel()
    go startRacer(primaryCtx, true)

    // 启动一个倒计时定时器（默认 300ms），作为备选地址的延跑时间
    fallbackTimer := time.NewTimer(sd.fallbackDelay())
    defer fallbackTimer.Stop()

    // 主控循环：监听定时器和并发协程的结果
    for {
       select {
       case <-fallbackTimer.C:
          // 300ms 倒计时结束，主选路线仍未出结果。
          // 立即启动备选地址（通常是 IPv4）的拨号协程，此时双线真正开始并发竞速。
          fallbackCtx, fallbackCancel := context.WithCancel(ctx)
          defer fallbackCancel()
          go startRacer(fallbackCtx, false)

       case res := <-results:
          // 只要有任意一条赛道成功建立了连接，立即返回。
          // 此时函数退出，触发 defer close(returned) 终结落后者。
          if res.error == nil {
             return res.Conn, nil
          }
          if res.primary {
             primary = res
          } else {
             fallback = res
          }
          // 如果主备两条线都明确报告了失败，则返回主选路线的错误信息
          if primary.done && fallback.done {
             return nil, primary.error
          }
          // 关键优化：如果主选协程非常快地返回了失败（比如服务器直接拒绝连接），
          // 并且此时 300ms 倒计时还没走完。
          if res.primary && fallbackTimer.Stop() {
             // 强行将定时器清零。
             // 这会让下一次 for 循环立即触发上面的 fallbackTimer.C 分支，让备选协程一秒都不耽误，立刻起跑补位。
             fallbackTimer.Reset(0)
          }
       }
    }
}
```

1. 给予主选任务一定的抢跑时间。它返回最先建立成功的连接，并关闭其他慢连接。
2. 如果主失败，直接开启备方案开跑
3. 如果两边都失败，则返回主选地址的错误。

#### dialSerial

```go
func (sd *sysDialer) dialSerial(ctx context.Context, ras addrList) (Conn, error) {
    var firstErr error // 记录遇到的第一个错误，因为通常 DNS 返回的首选 IP 报错最有参考价值。

    for i, ra := range ras {
       select {
       // 每次尝试连接新 IP 之前，先检查一下全局的 Context 是否已经被取消或超时。
       // 如果外部已经放弃了（比如上层的 Timeout 到了），就没必要继续试了，直接跳出。
       case <-ctx.Done():
          return nil, &OpError{Op: "dial", Net: sd.network, Source: sd.LocalAddr, Addr: ra, Err: mapErr(ctx.Err())}
       default:
       }

       dialCtx := ctx
       // 如果全局 Context 设置了截止时间 (Deadline)，则需要进行“时间切片”
       if deadline, hasDeadline := ctx.Deadline(); hasDeadline {
          // partialDeadline 算法：根据剩余的总时间和待尝试的 IP 数量，平摊计算出当前这个 IP 允许的最大耗时。
          partialDeadline, err := partialDeadline(time.Now(), deadline, len(ras)-i)
          if err != nil {
             // 报错通常意味着总时间已经彻底耗尽（连个最低限度的尝试时间都不够了）。
             // 此时没有必要再尝试剩下的地址了，记录错误并中断循环。
             if firstErr == nil {
                firstErr = &OpError{Op: "dial", Net: sd.network, Source: sd.LocalAddr, Addr: ra, Err: err}
             }
             break
          }
          
          // 如果计算出的当前 IP 分片截止时间早于全局截止时间，
          // 就用这个更短的分片时间，创建一个全新的子 Context (dialCtx)。
          if partialDeadline.Before(deadline) {
             var cancel context.CancelFunc
             dialCtx, cancel = context.WithDeadline(ctx, partialDeadline)
             // 无论当前 IP 连没连上，结束时立刻释放这个短生命周期的定时器
             defer cancel()
          }
       }

       // 携带分配好的 dialCtx，真正向下层发起对当前单个 IP (ra) 的 Socket 连接尝试
       c, err := sd.dialSingle(dialCtx, ra)
       if err == nil {
          // 只要有一个 IP 握手成功，立刻返回该连接，剩下的 IP 直接丢弃不试了
          return c, nil
       }
       
       // 如果失败了，且是第一次失败，把它存下来作为最终的保底错误提示
       if firstErr == nil {
          firstErr = err
       }
    }

    // 如果所有 IP 都试完了还没成功，且连个正经错误都没捕捉到（比如传入的 IP 列表是空的）
    if firstErr == nil {
       firstErr = &OpError{Op: "dial", Net: sd.network, Source: nil, Addr: nil, Err: errMissingAddress}
    }
    return nil, firstErr
}
```

它会返回第一个成功建立的连接，或者在所有尝试失败后，返回第一个遇到的错误。

#### dialSingle

```go
func (sd *sysDialer) dialSingle(ctx context.Context, ra Addr) (c Conn, err error) {
    // 从 Context 中提取网络追踪器 (nettrace)。
    // 如果用户在最上层注入了 httptrace 或 nettrace 监控钩子，这里就是通知外部的最佳时机。
    trace, _ := ctx.Value(nettrace.TraceKey{}).(*nettrace.Trace)
    if trace != nil {
       raStr := ra.String()
       // 触发“即将开始建立连接”的回调
       if trace.ConnectStart != nil {
          trace.ConnectStart(sd.network, raStr)
       }
       // 注册 defer，确保无论连接成功还是超时报错，都会触发“连接结束”的回调，并带上状态
       if trace.ConnectDone != nil {
          defer func() { trace.ConnectDone(sd.network, raStr, err) }()
       }
    }
    
    // 提取用户在 Dialer 中配置的本地绑定地址 (通常是 nil，由系统随机分配端口)
    la := sd.LocalAddr
    
    // 核心路由分发：根据传入的目标地址类型 (ra) 进行类型断言 (Type Switch)
    switch ra := ra.(type) {
    case *TCPAddr:
       // 目标是 TCP 地址，将本地地址也安全断言为 TCPAddr
       la, _ := la.(*TCPAddr)
       // 检查系统配置或环境变量是否要求开启多路径 TCP (MPTCP) 
       if sd.MultipathTCP() {
          c, err = sd.dialMPTCP(ctx, la, ra)
       } else {
          // 常规 TCP 拨号，绝大多数网页请求、RPC 调用都会走到这里
          c, err = sd.dialTCP(ctx, la, ra)
       }
    case *UDPAddr:
       la, _ := la.(*UDPAddr)
       // UDP 是无连接的。这里的 dial 主要是绑定本地端口，
       // 并为底层的 socket 调用 connect() 以绑定远端地址，方便后续直接 Read/Write
       c, err = sd.dialUDP(ctx, la, ra)
    case *IPAddr:
       la, _ := la.(*IPAddr)
       // 原始 IP 拨号（Raw Socket），跳过传输层，常用于自己实现 ping (ICMP) 等底层协议
       c, err = sd.dialIP(ctx, la, ra)
    case *UnixAddr:
       la, _ := la.(*UnixAddr)
       // Unix 域套接字拨号，不走网卡，专用于本机进程间的高速通信 (IPC)
       c, err = sd.dialUnix(ctx, la, ra)
    default:
       // 遇到无法识别的地址类型，直接拦截并返回格式化错误
       return nil, &OpError{Op: "dial", Net: sd.network, Source: la, Addr: ra, Err: &AddrError{Err: "unexpected address type", Addr: sd.address}}
    }
    
    // 如果底层的具体协议拨号函数返回了错误，将其统一包装为标准库规范的 *net.OpError
    if err != nil {
       return nil, &OpError{Op: "dial", Net: sd.network, Source: la, Addr: ra, Err: err} 
    }
    
    return c, nil
}
```

它是整个拨号流程中，真正根据协议类型（TCP/UDP/Unix）进行分发下沉的枢纽。

#### dialTCP

```go
func (sd *sysDialer) dialTCP(ctx context.Context, laddr, raddr *TCPAddr) (*TCPConn, error) {
    return sd.doDialTCP(ctx, laddr, raddr)
}

func (sd *sysDialer) doDialTCP(ctx context.Context, laddr, raddr *TCPAddr) (*TCPConn, error) {
    // 调用底层的 socket 抽象层。
    // syscall.SOCK_STREAM 是极其核心的参数，它明确告诉操作系统内核：
    // “我要创建一个面向连接的、可靠的字节流 Socket（即 TCP）”。
    // 
    // 这一步在操作系统层面会引发质变，依次执行三大系统调用：
    // 1. socket()：向内核申请一个文件描述符 (FD)
    // 2. bind()：如果配置了 LocalAddr，将 FD 绑定到本地指定端口
    // 3. connect()：向目标 raddr 发起 TCP 三次握手！(重点：这是配合 Context 的非阻塞调用)
    fd, err := internetSocket(ctx, sd.network, laddr, raddr, syscall.SOCK_STREAM, 0, "dial", sd.Dialer.ControlContext)
    if err != nil {
       return nil, err
    }
    
    // 三次握手成功完成！操作系统正式确立了连接。
    // 将内核返回的裸文件描述符 (fd) 包装成 Go 层的 TCPConn 对象。
    // 同时把 Dialer 中配置的 KeepAlive 参数也一并传递进去，启动系统的 TCP 保活机制。
    return newTCPConn(fd, sd.Dialer.KeepAlive, sd.testHookSetKeepAlive), nil
}
```

#### dialUDP

```go
func (sd *sysDialer) dialUDP(ctx context.Context, laddr, raddr *UDPAddr) (*UDPConn, error) {
    // 调用底层的 socket 抽象层。
    // syscall.SOCK_DGRAM 告诉内核：“我要创建一个无连接的、不可靠的数据报文 Socket（即 UDP）”。
    //
    // 极其反直觉的一点是：尽管是 UDP，这里依然会让操作系统执行 connect() 系统调用！
    // 区别在于：UDP 的 connect() 绝对不会像 TCP 那样往网络上发包去握手。
    // 它仅仅是在操作系统内核态，把目标 IP 和端口“死死绑定”在这个 Socket 文件描述符上。
    fd, err := internetSocket(ctx, sd.network, laddr, raddr, syscall.SOCK_DGRAM, 0, "dial", sd.Dialer.ControlContext)
    if err != nil {
       return nil, err
    }
    
    // 包装成 UDPConn 对象返回
    return newUDPConn(fd), nil
}
```

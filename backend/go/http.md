## Handler

```go
type Handler interface {
	ServeHTTP(ResponseWriter, *Request)
}
```

1. 当 `ServeHTTP`返回时就认为请求结束了，就不能通过 `ResponseWriter` 写数据，也不能再读取 `Request.Body`。也就是说如果在这里面开启了goroutine，当 `ServeHTTP`返回了，而goroutine还在操作 `ResponseWriter`，会导致程序崩溃或产生不可预知的错误
2. 谨慎的处理器应该**先读取 Body，再写入响应**，原因：由于 HTTP 协议版本（HTTP/1.1 vs HTTP/2）和中间代理的存在，一旦你开始往 `ResponseWriter` 写响应（尤其是写了大量数据），某些客户端或代理可能会直接关闭上传通道。如果你此时再去读 `Request.Body`，可能会报错
3. 除了读取 Body 之外，你不应该修改 `*Request` 对象中的任何字段，如果你需要在处理链中传递信息（例如在中间件里传递用户信息），应该使用 `r.WithContext(ctx)` 来创建一个携带新 Context 的请求副本
4. Go 的 `http.Server` 为每个请求都做了 `recover`。如果你的处理代码崩了（Panic），服务器不会宕机，它会捕获这个错误、打印堆栈日志，并尝试关闭连接
   * 如果你在代码中 `panic(http.ErrAbortHandler)`，服务器会直接停止处理这个请求，而 `ErrAbortHandler` 告诉服务器：“我打算中断这个请求，但这是我预期的，请不要在日志里报错。”

## ResponseWriter

```go
type Header map[string][]string

type ResponseWriter interface {
	Header() Header

	Write([]byte) (int, error)

	WriteHeader(statusCode int)
}

func (b *Writer) Write(p []byte) (nn int, err error) {
    for len(p) > b.Available() && b.err == nil {
        var n int
        if b.Buffered() == 0 {
            // 如果数据很大且缓冲区是空的，直接越过缓冲区发起系统调用 (即所谓的“大块直写”)
            n, b.err = b.wr.Write(p)
        } else {
            // 将当前缓冲区填满并刷新到内核，只要缓冲区里有旧数据，新数据必须“排队”
            n = copy(b.buf[b.n:], p)
            b.n += n
            b.flush() // 这里会触发系统调用 syscall.Write
        }
        nn += n
        p = p[n:]
    }
    // ... 如果数据量小，仅执行 copy 到 b.buf 内存中 ...
    n := copy(b.buf[b.n:], p)
    b.n += n
    return nn, nil
}
```

1. 你必须在调用 `WriteHeader` 或 `Write` **之前**修改 Header，一旦响应头发送出去（状态码已确定），后续对 Header 的修改除了 `Trailers` 外，都不会生效
2. 如果你直接调用 `Write` 而没写 `WriteHeader`，Go 会默认帮你执行 `WriteHeader(http.StatusOK)`
   * 对于 2xx-5xx 的状态码，一个请求只能发送 **一次**
   * 可以发送多次 1xx 状态码（如 `100 Continue`），它们会立即发送，而 2xx-5xx 可能会被缓冲以优化性能
3. 如果你没设置 `Content-Type`，Go 会读取你 `Write` 的**前 512 字节**进行分析，自动判断它是 HTML、JSON 还是图片，并帮你补齐 Header
4. 如果你的响应体很小（几 KB 内）且没有手动调用过 `Flush`，Go 会自动计算长度并加上 `Content-Length`，而不是使用分块传输
   1. 调用 `w.Write([]byte("hello"))`，放入用户缓冲区，发现没满就不会着急发出去，当你的 `ServeHTTP` 函数执行完毕返回时，Go 检查缓冲区，发现所有数据都在这了，Go 自动计算出 `Content-Length: 5`，把 Header 和 Body 一起打包发给客户端
   2. 不断调用 `w.Write()`，用户缓冲区很快就满了，Go 不能再等了（为了节省服务器内存），它必须开始发送，由于还没写完，Go 不知道最终会有多大，于是它**自动切换到 `Transfer-Encoding: chunked`** 模式
   3. 调用 `w.Write()` 写入了 10 字节，紧接着调用了 `w.(http.Flusher).Flush()`，因为还要继续写，Go 无法预知总长度，所以即便数据只有 10 字节，它也会**被迫使用分块传输**

## Server

```go
type Server struct {
	Addr string

	Handler Handler 


	DisableGeneralOptionsHandler bool

	TLSConfig *tls.Config

	ReadTimeout time.Duration

	ReadHeaderTimeout time.Duration

	WriteTimeout time.Duration

	IdleTimeout time.Duration

	MaxHeaderBytes int

	TLSNextProto map[string]func(*Server, *tls.Conn, Handler)

	ConnState func(net.Conn, ConnState)

	ErrorLog *log.Logger

	BaseContext func(net.Listener) context.Context


	ConnContext func(ctx context.Context, c net.Conn) context.Context


	HTTP2 *HTTP2Config

	Protocols *Protocols

	inShutdown atomic.Bool 

	disableKeepAlives atomic.Bool
	nextProtoOnce     sync.Once
	nextProtoErr      error   

	mu         sync.Mutex
	listeners  map[*net.Listener]struct{}
	activeConn map[*conn]struct{}
	onShutdown []func()

	listenerGroup sync.WaitGroup
}
```

1. 基本属性
   * `Addr`: 监听地址。如果不填，默认是 `:80`。
   * `Handler`: 路由分发器。如果为 `nil`，系统会使用全局默认的 `http.DefaultServeMux`
   * **`maxHeaderBytes`** ：这是一个安全屏障。为了防止  **Slowloris 攻击** （发送超大 Header 占满服务器内存），Go 允许你限制 Header 的最大字节数（默认约 1MB）
2. 超时控制
   * `ReadHeaderTimeout`：仅读取请求头的时间
   * `ReadTimeout`：读取整个请求（含 Body）的时间
   * `WriteTimeout`：从读取完 Header 开始计时。如果响应数据很大或网络慢，可能导致写入中断
   * `IdleTimeout`：决定长连接在没请求时多久被回收，如果不设，则复用 `ReadTimeout`

## ListenAndServe

```go
func ListenAndServe(addr string, handler Handler) error {
	server := &Server{Addr: addr, Handler: handler}
	return server.ListenAndServe()
}

func (s *Server) ListenAndServe() error {
	if s.shuttingDown() {
		return ErrServerClosed
	}
	addr := s.Addr
	if addr == "" {
		addr = ":http"
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	return s.Serve(ln)
}

func (s *Server) Serve(l net.Listener) error {
	origListener := l
	l = &onceCloseListener{Listener: l}
	defer l.Close()


	baseCtx := context.Background()
	if s.BaseContext != nil {
		baseCtx = s.BaseContext(origListener)
		if baseCtx == nil {
			panic("BaseContext returned a nil context")
		}
	}

	var tempDelay time.Duration // how long to sleep on accept failure

	ctx := context.WithValue(baseCtx, ServerContextKey, s)
	for {
		rw, err := l.Accept()
		if err != nil {
			if s.shuttingDown() {
				return ErrServerClosed
			}
			return err
		}
		connCtx := ctx
		if cc := s.ConnContext; cc != nil {
			connCtx = cc(connCtx, rw)
			if connCtx == nil {
				panic("ConnContext returned nil")
			}
		}
		tempDelay = 0
		c := s.newConn(rw)
		c.setState(c.rwc, StateNew, runHooks) // before Serve can return
		go c.serve(connCtx)
	}
}
```

1. 创建 `TCP`连接
2. 进入一个无限的 `for` 循环，不断执行 `Accept()` 接收新连接
3. 每接收到一个新连接，服务器都会 **`go c.serve(connCtx)`**
4. 在每个连接的 Goroutine 里，循环读取 HTTP 请求，解析协议，并最终调用 `Handler.ServeHTTP`

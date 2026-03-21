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
   * `maxHeaderBytes` ：这是一个安全屏障。为了防止  **Slowloris 攻击** （发送超大 Header 占满服务器内存），Go 允许你限制 Header 的最大字节数（默认约 1MB）
2. 超时控制
   * `ReadHeaderTimeout`：仅读取请求头的时间
   * `ReadTimeout`：读取整个请求（含 Body）的时间
   * `WriteTimeout`：从读取完 Header 开始计时。如果响应数据很大或网络慢，可能导致写入中断
   * `IdleTimeout`：决定长连接在没请求时多久被回收，如果不设，则复用 `ReadTimeout`

### Close

暴力关闭服务器。立即关闭所有底层网络监听器和当前所有的客户端连接

1. 对于正在等待响应或正在上传数据的客户端
   - 如果你用的是 Go 的 http.Client 请求这个服务端，客户端代码会收到类似 `EOF`、`read: connection reset by peer` 或 `unexpected EOF` 的错误。 
   - 如果是浏览器访问，用户界面通常会直接显示 "`ERR_CONNECTION_CLOSED`" 或 "`ERR_CONNECTION_RESET`"。
2. 对于尝试建立新连接的客户端：收到 `dial tcp: connect: connection refused` 的错误
3. 对于服务端自身正在运行的 Handler：写入操作会失败，底层会抛出 `write: broken pipe` 的错误

### ListenAndServe

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

### server

```go
// serve 是每个独立 TCP 连接的主处理生命周期
func (c *conn) serve(ctx context.Context) {
    // ==========================================
    // 1. 全局兜底：防 panic 与 资源清理
    // ==========================================
    defer func() {
        // 如果你写的 Handler 发生了 panic，这里会兜底捕获，防止整个服务端崩溃
        if err := recover(); err != nil && err != ErrAbortHandler {
            c.server.logf("http: panic serving %v: %v", c.remoteAddr, err)
        }
        // 确保最终一定会关闭底层的 TCP 连接，并更新连接状态为 Closed
        c.close()
        c.setState(c.rwc, StateClosed, runHooks)
    }()

    // ==========================================
    // 2. TLS 握手与协议升级 (HTTPS & HTTP/2)
    // ==========================================
    if tlsConn, ok := c.rwc.(*tls.Conn); ok {
        // 如果是 HTTPS 请求，先进行 TLS 握手
        if err := tlsConn.HandshakeContext(ctx); err != nil {
            return // 握手失败直接结束
        }
        
        // ALPN 协议协商 (比如协商结果为 "h2"，即 HTTP/2)
        // 如果协商出了新协议，会把连接交给专门的处理函数 (比如 HTTP/2 的处理器)，然后直接 return 退出当前 HTTP/1.x 的逻辑
        if proto := tlsConn.ConnectionState().NegotiatedProtocol; validNextProto(proto) {
            if fn := c.server.TLSNextProto[proto]; fn != nil {
                fn(c.server, tlsConn, h)
                return 
            }
        }
    }

    // ==========================================
    // 3. 准备缓冲 I/O
    // ==========================================
    // 包装底层的 net.Conn，提供带缓冲的读写能力，提升 I/O 性能
    c.bufr = newBufioReader(c.r)
    c.bufw = newBufioWriterSize(checkConnErrorWriter{c}, 4<<10)

    // ==========================================
    // 4. HTTP/1.x 核心请求循环 (Keep-Alive 循环)
    // ==========================================
    for {
        // 4.1 解析 HTTP 请求头
        // 从连接中读取报文，解析 Method、URL、Header，生成 http.Request 对象
        w, err := c.readRequest(ctx) 
        if err != nil {
            // 如果读取失败（如报文不合法、客户端断开等），返回错误并退出循环
            return 
        }

        // 4.2 将当前连接状态标记为活跃 (Active)
        c.setState(c.rwc, StateActive, runHooks)

        // 4.3 ★ 核心中的核心：执行你的业务逻辑 ★
        // serverHandler{c.server} 其实是对底层的路由复用器 (Mux) 的封装。
        // ServeHTTP 方法内部会根据 URL 匹配对应的 Handler，最终执行你写的业务代码。
        serverHandler{c.server}.ServeHTTP(w, w.req)

        // 4.4 收尾当前请求
        // 业务逻辑执行完了，把缓冲区里还没发出去的响应数据全部 Flush 到网络层
        w.finishRequest()

        // 4.5 连接复用判定 (Keep-Alive)
        // 检查客户端是否带了 Connection: close，或者服务端是否正在平滑重启等
        if !w.shouldReuseConnection() || !c.server.doKeepAlives() {
            return // 不能复用，退出循环，触发 defer 里的 close()
        }

        // 4.6 状态重置与空闲超时等待
        // 走到这里说明连接要被复用。将状态改回 Idle。
        c.setState(c.rwc, StateIdle, runHooks)
        
        // 设置 IdleTimeout（空闲等待超时时间）
        c.rwc.SetReadDeadline(time.Now().Add(c.server.idleTimeout()))

        // 阻塞等待：通过 Peek(4) 尝试读取下一个请求的头 4 个字节。
        // 如果在 IdleTimeout 内没等来新数据，err 不为空，退出循环并关闭连接。
        // 等到了新数据，重置超时，进入下一次 for 循环！
        if _, err := c.bufr.Peek(4); err != nil {
            return
        }
        c.rwc.SetReadDeadline(time.Time{}) // 收到新请求了，清除 IdleTimeout
    }
}

func (sh serverHandler) ServeHTTP(rw ResponseWriter, req *Request) {
   handler := sh.srv.Handler
   if handler == nil {
	   handler = DefaultServeMux
   }
   if !sh.srv.DisableGeneralOptionsHandler && req.RequestURI == "*" && req.Method == "OPTIONS" {
	   handler = globalOptionsHandler{}
   }
   
   handler.ServeHTTP(rw, req)
}
```

## 路由服务

```go
type HandlerFunc func(ResponseWriter, *Request)

func HandleFunc(pattern string, handler func(ResponseWriter, *Request)) {
	if use121 {
		DefaultServeMux.mux121.handleFunc(pattern, handler)
	} else {
		DefaultServeMux.register(pattern, HandlerFunc(handler)) // 强制将函数转换成了类型
 		// 这个 HandlerFunc 类型实现了 ServeHTTP 方法，所以它现在是一个合法的 Handler 接口对象了
	}
}

func Handle(pattern string, handler Handler) {
	if use121 {
		DefaultServeMux.mux121.handle(pattern, handler)
	} else {
		DefaultServeMux.register(pattern, handler)
	}
}
```

`http.HandleFunc`将一个普通的函数，注册到全局默认的路由分发器（DefaultServeMux）中，并将其包装成一个符合 `Handler` 接口的对象，比 `http.Handle`简洁

```go
type ServeMux struct {
	mu     sync.RWMutex
	tree   routingNode
	index  routingIndex
	mux121 serveMux121 // used only when GODEBUG=httpmuxgo121=1
}

var DefaultServeMux = &defaultServeMux

var defaultServeMux ServeMux

// ServeHTTP dispatches the request to the handler whose
// pattern most closely matches the request URL.
func (mux *ServeMux) ServeHTTP(w ResponseWriter, r *Request) {
	if r.RequestURI == "*" {
		if r.ProtoAtLeast(1, 1) {
			w.Header().Set("Connection", "close")
		}
		w.WriteHeader(StatusBadRequest)
		return
	}
	var h Handler
	if use121 {
		h, _ = mux.mux121.findHandler(r)
	} else {
		h, r.Pattern, r.pat, r.matches = mux.findHandler(r)
	}
	h.ServeHTTP(w, r)
}
```

`ServeMux`根据请求的 URL 路径，把请求分发给对应的 Handler

### 路径匹配

1. 固定路径，不以'/'结尾，需要精准匹配
2. 子树路径，以'/'结尾，需要进行前缀匹配，如果有多个匹配结果选最长匹配

```go
package main

import (
	"fmt"
	"net/http"
	"strings"
)

func main() {
	// 1. 固定路径
	http.HandleFunc("/about", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "About Page")
	})

	// 2. 子树路径
	http.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "API Root")
	})

	// 3. 更具体的子树路径
	http.HandleFunc("/api/v1/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "API V1")
	})

	fmt.Println("Server starting at :8080")
	http.ListenAndServe(":8080", nil)
}

```

### 路由存储

```go
// A routingNode is a node in the decision tree.
// The same struct is used for leaf and interior nodes.
type routingNode struct {
	// A leaf node holds a single pattern and the Handler it was registered
	// with.
	pattern *pattern
	handler Handler

	// An interior node maps parts of the incoming request to child nodes.
	// special children keys:
	//     "/"	trailing slash (resulting from {$})
	//	   ""   single wildcard
	children   mapping[string, *routingNode] // 精确匹配的子节点
	multiChild *routingNode // child with multi wildcard // 处理通配符 {...} 的节点
	emptyChild *routingNode // optimization: child with key "" // 处理单通配符 {} 的节点
}

type pattern struct {
	str    string // original string
	method string
	host   string
	segments []segment
	loc      string // source location of registering call, for helpful messages
}

type segment struct {
	s     string // literal or wildcard name or "/" for "/{$}".
	wild  bool
	multi bool // "..." wildcard
}
```

```
&http.ServeMux{
    mu: { ... },
    // 路由树开始
    tree: routingNode{
        pattern: nil,
        handler: nil,
        // 第一层：根据 Host 划分（如果有的话）
        children: {
            "example.com": &routingNode{
                // 处理 "GET example.com/user/{id}"
                children: {
                    "user": &routingNode{
                        emptyChild: &routingNode{ // 对应 {id}
                            pattern: &pattern{
                                str:    "GET example.com/user/{id}",
                                method: "GET",
                                host:   "example.com",
                                segments: []segment{
                                    {s: "user", wild: false, multi: false},
                                    {s: "id",   wild: true,  multi: false},
                                },
                            },
                            handler: http.HandlerFunc(func1),
                        },
                    },
                },
            },
            // 无 Host 的路由默认在空的 children 或特殊节点下
            "api": &routingNode{
                children: {
                    "v1": &routingNode{
                        // 对应 POST /api/v1/{$}
                        children: {
                            "/": &routingNode{ // {$} 内部被表示为字面量 "/"
                                pattern: &pattern{
                                    str:    "POST /api/v1/{$}",
                                    method: "POST",
                                    segments: []segment{
                                        {s: "api", wild: false, multi: false},
                                        {s: "v1",  wild: false, multi: false},
                                        {s: "/",   wild: false, multi: false},
                                    },
                                },
                                handler: http.HandlerFunc(func2),
                            },
                        },
                    },
                },
            },
            "static": &routingNode{
                // 对应 /static/...
                multiChild: &routingNode{ // "..." 被解析为 multiChild
                    pattern: &pattern{
                        str: "/static/...",
                        segments: []segment{
                            {s: "static", wild: false, multi: false},
                            {s: "",       wild: true,  multi: true},
                        },
                    },
                    handler: http.HandlerFunc(func3),
                },
            },
        },
        // 对应 /{any}
        emptyChild: &routingNode{
            pattern: &pattern{
                str: "/{any}",
                segments: []segment{
                    {s: "any", wild: true, multi: false},
                },
            },
            handler: http.HandlerFunc(func4),
        },
    },
    // 优化索引，用于处理 Method 和 Host 的快速过滤
    index: routingIndex{ ... }, 
}
```

## Client

```go
type Client struct {
    // Transport 决定了请求是如何发出的（连接池、TLS、代理等）
    Transport RoundTripper

    // CheckRedirect 定义重定向策略
    CheckRedirect func(req *Request, via []*Request) error

    // Jar 处理 Cookie 的存储和读取
    Jar CookieJar

    // Timeout 限制整个请求的时间（从连接、发送到读取响应体结束）
    Timeout time.Duration
}

type CookieJar interface {
	// SetCookies handles the receipt of the cookies in a reply for the
	// given URL.  It may or may not choose to save the cookies, depending
	// on the jar's policy and implementation.
	SetCookies(u *url.URL, cookies []*Cookie)

	// Cookies returns the cookies to send in a request for the given URL.
	// It is up to the implementation to honor the standard cookie use
	// restrictions such as in RFC 6265.
	Cookies(u *url.URL) []*Cookie
}

var DefaultClient = &Client{}

// 简化
func (c *Client) do(req *Request) (retres *Response, reterr error) {
    // 1. 防御性编程：如果 c 为 nil 立即 panic，避免后续深层报错
    _ = *c 

    var (
        deadline      = time.Now().Add(c.Timeout)
        reqs          []*Request      // 记录重定向历史，用于 checkRedirect 校验
        resp          *Response
        copyHeaders   = c.makeHeadersCopier(req) // 准备 Header 复制器
        includeBody   = true          // 是否继续携带 Body (重定向后可能变为 false)
    )

    for {
        // --- A. 处理重定向逻辑 (非首次循环进入) ---
        if len(reqs) > 0 {
            loc := resp.Header.Get("Location")
            if loc == "" { return resp, nil } // 3xx 但没给地址，直接返回

            u, _ := req.URL.Parse(loc) // 解析新地址
  
            // 构造“下一跳”的新请求
            ireq := reqs[0] // 原始请求
            req = &Request{
                Method:   redirectMethod, // 可能由 POST 变为 GET
                URL:      u,
                Header:   make(Header),
                ctx:      ireq.ctx,       // 保持 Context 传递
            }

            // 如果需要带 Body (如 307/308 且有 GetBody 方法)
            if includeBody && ireq.GetBody != nil {
                req.Body, _ = ireq.GetBody()
            }

            // 安全性：如果是跨域重定向，敏感 Header（如 Cookie/Auth）会被剥离
            copyHeaders(req, stripSensitiveHeaders)

            // 执行用户自定义的重定向策略（比如限制最多 10 次）
            err := c.checkRedirect(req, reqs)
	  
   	    if err == ErrUseLastResponse {
		return resp, nil // 不能先关闭Body，否则后续拿不到
	    }
  

            // 为了复用 TCP 连接：如果响应体很小，把它读完丢弃比直接关闭更划算
            const maxBodySlurpSize = 2048
            if resp.ContentLength <= maxBodySlurpSize {
                io.CopyN(io.Discard, resp.Body, maxBodySlurpSize)
            }
            resp.Body.Close() // 必须关闭旧的响应体

	    if err != nil {
		// The resp.Body has already been closed.
		ue := uerr(err)
		ue.(*url.Error).URL = loc
		return resp, ue
	     }
        }

        // --- B. 发送网络请求 ---
        reqs = append(reqs, req)
        var err error
        // c.send 是底层的核心，它真正调用 RoundTripper (Transport)
        if resp, _, err = c.send(req, deadline); err != nil {
            return nil, err
        }

        // --- C. 判断是否需要重定向 ---
        var shouldRedirect bool
        // 核心工具函数：根据状态码 (301, 302, 307...) 决定下一步行为
        redirectMethod, shouldRedirect, _ = redirectBehavior(req.Method, resp, reqs[0])
  
        if !shouldRedirect {
            return resp, nil // 正常响应 (2xx/4xx/5xx)，大功告成
        }

        // 准备进行下一次循环（重定向）
        req.closeBody()
    }
}

func (c *Client) send(req *Request, deadline time.Time) (resp *Response, didTimeout func() bool, err error) {
	if c.Jar != nil { // 也就说Jar存储了Client实例所有发出请求中收到响应体中携带的cookies，按url区分
		for _, cookie := range c.Jar.Cookies(req.URL) {
			req.AddCookie(cookie)
		}
	}
	resp, didTimeout, err = send(req, c.transport(), deadline)
	if err != nil {
		return nil, didTimeout, err
	}
	if c.Jar != nil {
		if rc := resp.Cookies(); len(rc) > 0 {
			c.Jar.SetCookies(req.URL, rc)
		}
	}
	return resp, nil, nil
}
```

在 HTTP/1.1 中，如果你想 **复用** （Reuse）同一个 TCP 连接发送下一个请求（Keep-Alive），你必须保证前一个请求的响应体已经被 **完全读取完毕** ，**如果不读完直接 Close** ：底层的 TCP 连接会因为还有残留数据没处理，而被强制关闭并丢弃

对于 `Timeout`，最后会通过 `WithDealineContext`存储在req.ctx中

```go
req.ctx, cancelCtx = context.WithDeadline(oldCtx, deadline)
// ...
if !deadline.IsZero() {
	resp.Body = &cancelTimerBody{
		stop:          cancelCtx,
		rc:            resp.Body,
		reqDidTimeout: func() bool { return time.Now().After(deadline) },
	}
}

func (b *cancelTimerBody) Read(p []byte) (n int, err error) {
	n, err = b.rc.Read(p)
	if err == nil {
		return n, nil
	}
	if err == io.EOF {
		return n, err
	}
	if b.reqDidTimeout() { // 所以Timeout超时是从请求发出到响应体Body读取完不能超过Timeout
		err = &timeoutError{err.Error() + " (Client.Timeout or context cancellation while reading body)"}
	}
	return n, err
}
```

其他方法比如 `Get`、`Post`和 `PostForm`都是对 `Do`的封装调用

```go
func (c *Client) Get(url string) (resp *Response, err error) {
	req, err := NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	return c.Do(req)
}

func (c *Client) Post(url, contentType string, body io.Reader) (resp *Response, err error) {
	req, err := NewRequest("POST", url, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", contentType)
	return c.Do(req)
}
```

## Request

```go
type Request struct {
    Method           string        // GET, POST, PUT 等
    URL              *url.URL      // 解析后的 URL 对象
    Proto            string        // "HTTP/1.1"
    Header           Header        // map[string][]string，存储所有 Header
    Body             io.ReadCloser // 请求体，是一个流，只能读取一次
    ContentLength    int64         // body内容长度
    Host             string        // 目标主机名

    GetBody func() (io.ReadCloser, error)
  
    // 表单数据（需调用 ParseForm 后才有数据）
    Form             url.Values    // 包含 URL 查询参数和 POST 表单数据
    PostForm         url.Values    // 仅包含 POST 表单数据
    MultipartForm    *multipart.Form

    // 上下文（非常重要）
    ctx context.Context

    Response *Response

    // 还有 RemoteAddr, TLS, RequestURI 等...
}
```

1. `Body` 永远不为 nil，即使是 GET 请求没有 Body，这个字段也不会是 nil，只是去读的时候会立刻返回 EOF
   - chunk 读取过程：如果没有数据则挂起；有多条数据也不会跨越边界，每次读取一次chunk
2. `GetBody` 一种按需重新获取底层数据源读取权限的机制。它依赖于一个能记住原始数据的闭包或结构体，通过新建一个指针归零的读取器，来替换掉那个已经被读到 EOF（文件尾）的旧读取器
3. `ContentLength` 为 body 内容的长度，如果是 chunk 传输则为-1
4. `Form` 包含URL 和 POST表单数据，Body 参数排在前面，URL 参数追加在后面
   - 当 URL 中有 key=A，Body 中也有 key=B 时，r.Form["key"] 的结果是 []string{"B", "A"}
5. `PostForm` 仅包含 POST 表单数据
6. `MultipartForm` 专为 `multipart/form-data` 设计
7. `Response` 记录是哪一个重定向响应，导致了当前这个新请求的诞生

Request 设计思路为数据的载体，由 Client 发送出去

### 常用方法

```go
func NewRequest(method, url string, body io.Reader) (*Request, error) {
	return NewRequestWithContext(context.Background(), method, url, body)
}

func NewRequestWithContext(ctx context.Context, method, url string, body io.Reader) (*Request, error) {
	if method == "" {
		// We document that "" means "GET" for Request.Method, and people have
		// relied on that from NewRequest, so keep that working.
		// We still enforce validMethod for non-empty methods.
		method = "GET"
	}
	if !validMethod(method) {
		return nil, fmt.Errorf("net/http: invalid method %q", method)
	}
	if ctx == nil {
		return nil, errors.New("net/http: nil Context")
	}
	u, err := urlpkg.Parse(url)
	if err != nil {
		return nil, err
	}
	rc, ok := body.(io.ReadCloser)
	if !ok && body != nil {
		rc = io.NopCloser(body)
	}
	// The host's colon:port should be normalized. See Issue 14836.
	u.Host = removeEmptyPort(u.Host)
	req := &Request{
		ctx:        ctx,
		Method:     method,
		URL:        u,
		Proto:      "HTTP/1.1",
		ProtoMajor: 1,
		ProtoMinor: 1,
		Header:     make(Header),
		Body:       rc,
		Host:       u.Host,
	}
	if body != nil {
		switch v := body.(type) {
		case *bytes.Buffer:
			req.ContentLength = int64(v.Len())
			buf := v.Bytes()
			req.GetBody = func() (io.ReadCloser, error) {
				r := bytes.NewReader(buf)
				return io.NopCloser(r), nil
			}
		case *bytes.Reader:
			req.ContentLength = int64(v.Len())
			snapshot := *v // 结构体浅copy，offset一直为0
			req.GetBody = func() (io.ReadCloser, error) {
				r := snapshot
				return io.NopCloser(&r), nil
			}
		case *strings.Reader:
			req.ContentLength = int64(v.Len())
			snapshot := *v
			req.GetBody = func() (io.ReadCloser, error) {
				r := snapshot
				return io.NopCloser(&r), nil
			}
		default:
			// This is where we'd set it to -1 (at least
			// if body != NoBody) to mean unknown, but
			// that broke people during the Go 1.8 testing
			// period. People depend on it being 0 I
			// guess. Maybe retry later. See Issue 18117.
		}
		// For client requests, Request.ContentLength of 0
		// means either actually 0, or unknown. The only way
		// to explicitly say that the ContentLength is zero is
		// to set the Body to nil. But turns out too much code
		// depends on NewRequest returning a non-nil Body,
		// so we use a well-known ReadCloser variable instead
		// and have the http package also treat that sentinel
		// variable to mean explicitly zero.
		if req.GetBody != nil && req.ContentLength == 0 {
			req.Body = NoBody
			req.GetBody = func() (io.ReadCloser, error) { return NoBody, nil }
		}
	}

	return req, nil
}

func (r *Request) WithContext(ctx context.Context) *Request {
	if ctx == nil {
		panic("nil context")
	}
	r2 := new(Request)
	*r2 = *r // 值拷贝
	r2.ctx = ctx
	return r2
}
```

1. `NewReuqest`是封装了 `NewRequestWithContext`方法
2. 如 `strings.NewReader` 或 `bytes.NewBuffer`，它们只实现了 `io.Reader`（只有 `Read`），没有 `Close` 方法，所以用 `io.NopCloser` 注入一个**空的 `Close` 方法**
3. `NewRequestWithContext`方法组装 `Request`结构体内容，设置 `GetBody`方法，`GetBody` 的存在是为了解决“重定向”或“重试”时的 Body 复用问题
4. `WithContext`则是创建一个新的 `Request`，设置 `ctx`并返回

### Write 与 WriteProxy

1. Write 将 Request 转为标准的 http 包格式，只是 url 为相对路径
2. WriteProxy 将 Request 转为标准 http 包格式，url 为绝对路径

### Form

```go
var Form map[string][]string

func (r *Request) FormValue(key string) string {
	if r.Form == nil {
		r.ParseMultipartForm(defaultMaxMemory)
	}
	if vs := r.Form[key]; len(vs) > 0 {
		return vs[0]
	}
	return ""
}
```

Form 包含 Value 和 File，没有 Parse 之前调用会报错；但可以通过 FormFile 或 FormValue 安全调用。

### PostForm

```go
var PostForm map[string][]string

func (r *Request) PostFormValue(key string) string {
   if r.PostForm == nil {
      r.ParseMultipartForm(defaultMaxMemory)
   }
   if vs := r.PostForm[key]; len(vs) > 0 {
      return vs[0]
   }
   return ""
}
```

和 Form 底层类型和相关方法类似，只不过存储的是 body 中的表单数据

### MultipartForm

```go
type Form struct {
	Value map[string][]string
	File  map[string][]*FileHeader
}

func (r *Request) FormFile(key string) (multipart.File, *multipart.FileHeader, error) {
   if r.MultipartForm == multipartByReader {
	   return nil, nil, errors.New("http: multipart handled by MultipartReader")
   }
   if r.MultipartForm == nil {
	   err := r.ParseMultipartForm(defaultMaxMemory)
   if err != nil {
	   return nil, nil, err
   }
   }
   if r.MultipartForm != nil && r.MultipartForm.File != nil {
	   if fhs := r.MultipartForm.File[key]; len(fhs) > 0 {
		   f, err := fhs[0].Open()
		   return f, fhs[0], err
	   }
   }
   return nil, nil, ErrMissingFile
}
```

Form.Value 只是一个临时数据载体，可以从 PostForm 和 Form 中使用到

### MultipartReader

```go
func (r *Request) MultipartReader() (*multipart.Reader, error) {
	if r.MultipartForm == multipartByReader {
		return nil, errors.New("http: MultipartReader called twice")
	}
	if r.MultipartForm != nil {
		return nil, errors.New("http: multipart handled by ParseMultipartForm")
	}
	r.MultipartForm = multipartByReader
	return r.multipartReader(true)
}
```

Go 允许开发者通过 `r.MultipartReader()` 来“接管”这个数据流，进行手动的、边读边处理的流式解析。一旦你调用了 `r.MultipartReader()`，Go 内部就会偷偷把 `r.MultipartForm` 赋值为这个 `multipartByReader` 哨兵变量

### ParseMultipartForm

```go
func (r *Request) ParseMultipartForm(maxMemory int64) error {
	if r.MultipartForm == multipartByReader {
		return errors.New("http: multipart handled by MultipartReader")
	}
	var parseFormErr error
	if r.Form == nil {
		// Let errors in ParseForm fall through, and just
		// return it at the end.
		parseFormErr = r.ParseForm()
	}
	if r.MultipartForm != nil {
		return nil
	}

	mr, err := r.multipartReader(false)
	if err != nil {
		return err
	}

	f, err := mr.ReadForm(maxMemory)
	if err != nil {
		return err
	}

	if r.PostForm == nil {
		r.PostForm = make(url.Values)
	}
	for k, v := range f.Value {
		r.Form[k] = append(r.Form[k], v...)
		// r.PostForm should also be populated. See Issue 9305.
		r.PostForm[k] = append(r.PostForm[k], v...)
	}

	r.MultipartForm = f

	return parseFormErr
}
```

1. 互斥检查：确认当前请求体是否已经被 MultipartReader（流式逐块读取器）接管。如果是，说明开发者选择了手动处理数据流，为了防止数据被二次读取破坏，直接返回互斥错误
2. 如果 Form 为 nil，则解析 普通的 urlencoded 表单 和 URL 中的查询参数（报错但流程不终止）
3. `mr.ReadForm`：
   - 将普通的文本 Key-Value 提取出来
   - 将文件数据读取并存储。在累积大小不超过 maxMemory 时放入内存；一旦越界，立即无缝切换，将剩余部分写入操作系统的临时磁盘文件中
4. 视图合并与数据挂载

## Response

```go
type Response struct {
	Status     string // e.g. "200 OK"
	StatusCode int    // e.g. 200
	Proto      string // e.g. "HTTP/1.0"
	ProtoMajor int    // e.g. 1
	ProtoMinor int    // e.g. 0

	Header Header

	Body io.ReadCloser

	ContentLength int64

	TransferEncoding []string

	Close bool

	Uncompressed bool

	Trailer Header

	Request *Request

	TLS *tls.ConnectionState
}
```

1. `Body` 保证永远不为 nil，空内容读取会返回 EOF，读取结束后必须手动调用 `Body.Close`（如果不读取完并关闭它，Go 默认的 HTTP 传输层 (Transport) 就无法复用底层的 TCP 连接（Keep-Alive 失效），这在高并发场景下会导致严重的资源泄漏。）
   - 需要将 Body 传递给 接收Reader接口的函数去使用即可
2. `Header` Go 会自动将 Key 规范化
3. `ContentLength` 响应内容长度，如果为 -1 则长度未知（chunk 传输）
4. `Trailer` 尾部 Header，只有在完全读完 Body 并遇到 io.EOF 之后，才能读取到这里的值
5. `Uncompressed` 标记是否采取压缩
6. `Request` 指向的是谁发出的请求导致本次响应产生

Go 的 `http.Response` 并不是把所有数据“完全下载并打包”后才返回的，它是流式的
- 只要 Go 从网络连接中读到了状态码（如 200 OK）和初始的 HTTP Header，它就会立刻组装出 http.Response 结构体并返回给你。
- 此时，resp.Body 只是一个连接着底层 TCP Socket 的“水管”。真正的 Body 数据还在网络电缆里传输

### 方法

1. `Cookies()` 会自动遍历 resp.Header，把所有的 Set-Cookie 提取出来，并解析成 Go 语言中易于操作的 *http.Cookie 结构体切片
2. `Location()` 当 HTTP 状态码是 3xx（如 301 永久重定向，302 临时重定向）或者 201 (Created) 时，服务器通常会在响应头中带上一个 Location 字段
3. `ProtoAtLeast()` 用来检查当前响应的 HTTP 协议版本是否大于或等于指定的版本
4. `Write()` 将整个 http.Response 对象（包括状态行、Header、Body）重新序列化（打包）成标准的 HTTP/1.x 文本格式

## Transport

```go
type RoundTripper interface {
    RoundTrip(*Request) (*Response, error)
}

type Transport struct {
    // 1. 连接池管理
    MaxIdleConns int
    IdleConnTimeout time.Duration
    idleConn     map[connectMethodKey][]*persistConn // most recently used at end
    idleConnWait map[connectMethodKey]wantConnQueue  // waiting getConns
    idleLRU      connLRU

    MaxIdleConnsPerHost int
    MaxConnsPerHost int
    connsPerHostMu   sync.Mutex
    connsPerHost     map[connectMethodKey]int
    connsPerHostWait map[connectMethodKey]wantConnQueue // waiting getConns
   
  
    DisableKeepAlives bool
    DisableCompression bool

    MaxResponseHeaderBytes int64
    ResponseHeaderTimeout time.Duration

    // 拨号控制
    DialContext func(ctx context.Context, network, addr string) (net.Conn, error)
}
```

1. `MaxIdleConns` 控制整个 Transport 维护的最大空闲连接总数。超过这个数量的空闲连接会被立刻关闭
2. `MaxIdleConnsPerHost` 控制每个 Host 保留的最大空闲连接数。这是高并发调优最核心的参数。默认值通常只有 2
3. `MaxConnsPerHost` 限制每个 Host 的最大并发连接数（包括正在使用的活跃连接和空闲连接）。达到上限后，新的请求会阻塞等待。设为 0 表示不限制。
4. `IdleConnTimeout` 空闲连接的超时时间。如果一个连接放在池子里超过这个时间没被用，就会被关闭释放。
5. `DialContext` 自定义建立底层 TCP 连接的逻辑。通常用于设置 TCP 连接级别的超时时间
6. `ResponseHeaderTimeout` 从发送完请求后，到接收到服务端响应头的超时时间。这是防止下游服务"夯死"（只建立连接但不返回数据）的重要防线。

### RoundTrip

1. 彻底的读写分离
   - 本身不直接操作底层 Socket 的读写。当获取到连接 (persistConn) 后，底层实际上会常驻两个独立的 Goroutine：readLoop（专职从服务端读数据）和 writeLoop（专职向服务端写数据）。roundTrip 只负责把请求通过 Channel 扔给 writeLoop，然后在 select 里死等 readLoop 把响应送回来。
   - 主业务代码永远不会因为网络底层的夯死而被卡住
2. 极其保守的“防御性”重试策略
   - 零写入： 确认连一个字节都还没发出去，直接重试。
   - 幂等性保护： 必须是 GET、HEAD、OPTIONS 等幂等方法，或者带有幂等 Key（Header 字段：Idempotency-Key 或 X-Idempotency-Key）
   - Body 可倒带： 重试需要重新发送 Body，它要求 Request 必须提供 GetBody 函数来重置数据流，否则无法重试
3. 资源复用
   - roundTrip 内部强依赖 getConn 方法。这个方法的核心是“能复用绝不新建”

#### getConn

```go
func (t *Transport) getConn(treq *transportRequest, cm connectMethod) (_ *persistConn, err error) {
	req := treq.Request
	trace := treq.trace // 获取 httptrace，用于做性能打点（如 DNS耗时、TCP建连耗时 等监控）
	ctx := req.Context()

	// 如果外部注册了 httptrace.GetConn 钩子，在这里触发回调，通知业务层“准备开始获取连接了”
	if trace != nil && trace.GetConn != nil {
		trace.GetConn(cm.addr())
	}

	// 【核心设计：Context 脱离与防泄漏】
	// Detach from the request context's cancellation signal.
	// 这是一个非常精妙的细节（使用了 context.WithoutCancel）：
	// 假设用户发起了请求，但瞬间因为超时或主动点击取消（req.ctx 被 cancel）。
	// 如果底层正在进行耗时的 TCP 握手，直接中断丢弃是非常浪费网络资源的。
	// 所以这里强行把拨号的 Context (dialCtx) 和请求的 Context (ctx) 的取消信号解绑，但保留了 Value。
	// 这样即使当前请求被取消，底层的 TCP 建连依然会默默完成，建好后直接放入空闲连接池，造福下一个请求。
	dialCtx, dialCancel := context.WithCancel(context.WithoutCancel(ctx))

	// 构建一个“寻连意图”对象 (wantConn)
	// 它就像一个排队号码牌，代表当前这个 Goroutine 正在急切地等待一个可用的底层连接
	w := &wantConn{
		cm:         cm,
		key:        cm.key(),        // 作为去 LRU 缓存池里捞连接的 Key (例如: https|api.example.com)
		ctx:        dialCtx,         // 脱离了用户取消信号的拨号 Context
		cancelCtx:  dialCancel,      // 用于内部主动取消拨号的函数
		result:     make(chan connOrError, 1), // 【关键管道】：容量为 1，用于异步接收最终拿到的连接或错误
		beforeDial: testHookPrePendingDial,    // 测试钩子
		afterDial:  testHookPostPendingDial,   // 测试钩子
	}

	// 兜底防御机制：如果获取连接的整个过程发生任何错误退出，
	// 必须调用 w.cancel(t) 将自己从等待队列中注销，防止造成内存泄漏或死锁
	defer func() {
		if err != nil {
			w.cancel(t)
		}
	}()

	// 【连接池调度的核心分流】
	// 第一步：尝试去“空闲连接池 (idleConn)”里拿复用的连接。
	// queueForIdleConn 不仅是去池子里找，如果池子当前没货，它还会把 w 挂在等待队列里 (idleConnWait)。
	if delivered := t.queueForIdleConn(w); !delivered {
		// 第二步：如果没拿到复用连接，则进入拨号队列 (queueForDial)，准备新建 TCP 连接。
		// 注意：queueForDial 内部受到 MaxConnsPerHost 的严格限制。
		// 如果并发数没超限，它会立刻启动一个新的 Goroutine 去走底层 TCP/TLS 握手。
		t.queueForDial(w)
	}

	// 【CSP 模型：死等结果】
	// 上面的排队和拨号动作全部是异步派发出去的，当前主协程在这里通过 select 阻塞等待最终命运。
	select {
	case r := <-w.result:
		// 命运1：w.result 管道响了！
		// 可能是拨号 Goroutine 成功连上了，也可能是某个刚用完连接的兄弟把空闲连接通过管道扔给了我。
		
		// 性能打点：记录拿到连接的成功事件 (仅限 HTTP/1)
		if r.pc != nil && r.pc.alt == nil && trace != nil && trace.GotConn != nil {
			info := httptrace.GotConnInfo{
				Conn:   r.pc.conn,
				Reused: r.pc.isReused(), // 告诉业务层：这个连接是被复用的，还是新鲜刚建立的
			}
			if !r.idleAt.IsZero() {
				info.WasIdle = true
				info.IdleTime = time.Since(r.idleAt)
			}
			trace.GotConn(info)
		}
		
		// 如果管道传回来的不仅有连接，还有错误
		if r.err != nil {
			// 如果走到这里，通常是因为底层的拨号过程失败了。
			// 但有一种特殊竞态：此时用户的 ctx 也刚好被取消了。
			// 为了给用户最直观的反馈（告诉用户是你主动取消的，而不是网络断了），做一次 select 抢占判断。
			select {
			case <-treq.ctx.Done():
				err := context.Cause(treq.ctx)
				if err == errRequestCanceled {
					err = errRequestCanceledConn // "net/http: request canceled while waiting for connection"
				}
				return nil, err
			default:
				// 并不是用户取消的，原原本本返回底层拨号的真实错误（如 dns 解析失败、tcp 拒绝连接）
			}
		}
		
		// 大功告成，返回拿到的底层持久化连接 pc (persistConn)
		return r.pc, r.err

	case <-treq.ctx.Done():
		// 命运2：用户的 Context 响了！
		// 在我们苦苦排队等连接或者等 TCP 握手的漫长过程中，用户设置的超时时间到了，或者用户调用了 cancel()。
		// 此时直接不等了，截获错误并立刻返回给上层，实现对超时的“秒级”响应。
		err := context.Cause(treq.ctx)
		if err == errRequestCanceled {
			err = errRequestCanceledConn
		}
		// 返回前，之前 defer 的 w.cancel(t) 会被执行，负责去底层队伍里把这个号码牌作废。
		return nil, err
	}
}
```

1. 先去空闲连接池中找空闲连接，如果没有则挂入等待队列并进入新函数产生申请连接（追求极致低延迟而设计的“双轨赛跑”机制。）
2. 排队和拨号动作全部是异步派发出去的，当前主协程在这里通过 select 阻塞等待最终命运

#### queueForIdleConn

```go
func (t *Transport) queueForIdleConn(w *wantConn) (delivered bool) {
	// 场景1：如果配置了禁用 Keep-Alive，直接返回 false，不复用，也不排队等复用。
	if t.DisableKeepAlives {
		return false
	}

	// 锁住整个空闲连接池 (idleConn) 和 等待队列 (idleConnWait)
	// 这是一个全局锁，所以里面的操作必须极其轻量且快速
	t.idleMu.Lock()
	defer t.idleMu.Unlock()

	// 撤销清理指令。如果之前有人调了 CloseIdleConnections() 让系统准备关停，
	// 现在既然又有新请求进来要拿连接了，赶紧把“关门歇业”的牌子摘了。
	t.closeIdle = false

	if w == nil {
		// 仅用于内部测试钩子，常规流程不会触发
		return false
	}

	// 【过期审查准备】计算一个“最老允许时间”
	// 如果配置了空闲超时 (IdleConnTimeout)，我们就算出一个时间基准线 oldTime。
	// 比如当前是 12:00，超时设置是 90秒，那 oldTime 就是 11:58:30。
	// 任何闲置时间早于这个 oldTime 的连接，统统视为“过期”。
	var oldTime time.Time
	if t.IdleConnTimeout > 0 {
		oldTime = time.Now().Add(-t.IdleConnTimeout)
	}

	// 【核心动作 1：去缓存池里拿】
	// 通过当前请求的 Key（比如 https|api.example.com）去找对应的空闲连接列表
	if list, ok := t.idleConn[w.key]; ok {
		stop := false
		delivered := false
		
		// 只要列表里还有连接，并且还没成功拿到，就一直循环找
		for len(list) > 0 && !stop {
			// 【极其重要的细节：LIFO (后进先出) / MRU (最近最常使用)】
			// 注意这里的索引是 len(list)-1，也就是总是拿列表里**最后一个**放进去的连接。
			// 为什么？因为最近刚放回来的连接，它是“热乎”的，底层的 TCP 还没被操作系统或 NAT 路由器掐断的概率最大！
			pconn := list[len(list)-1]

			// 审查1：是否太老了？（闲置太久）
			tooOld := !oldTime.IsZero() && pconn.idleAt.Round(0).Before(oldTime)
			if tooOld {
				// 异步清理：如果太老了，开一个 Goroutine 去温柔地关闭底层的 Socket。
				// 为什么异步？因为现在持有 t.idleMu 全局锁，直接调 Close 会阻塞，影响全局性能。
				go pconn.closeConnIfStillIdle()
			}
			
			// 审查2：连接是否已经损坏 (Broken) 或者 太老 (tooOld)？
			if pconn.isBroken() || tooOld {
				// 这个连接是个废品！
				// 把它从当前列表的尾部切掉 (切片缩容)，然后 continue 进去下一轮循环，检查倒数第二个。
				list = list[:len(list)-1]
				continue
			}
			
			// 审查通过！这是一个好连接！尝试把它交付给我们的请求。
			// tryDeliver 会通过 Channel 把 pconn 塞给 w.result
			delivered = w.tryDeliver(pconn, nil, pconn.idleAt)
			if delivered {
				if pconn.alt != nil {
					// HTTP/2 逻辑：多路复用，一个连接可以给多个人用。
					// 所以拿到了也不把它从空闲池里踢出去，留在里面造福后续请求。
				} else {
					// HTTP/1 逻辑：独占式连接。
					// 既然被当前请求拿走了，就要从 LRU 缓存和空闲列表中彻底抹除。
					t.idleLRU.remove(pconn)
					list = list[:len(list)-1]
				}
			}
			stop = true // 拿到或者尝试交付过了，停止淘宝循环
		}
		
		// 循环结束后的收尾工作：更新挂在字典上的切片
		if len(list) > 0 {
			t.idleConn[w.key] = list // 列表里还有剩的，保存回去
		} else {
			delete(t.idleConn, w.key) // 全被挑空了（或者全馊了），直接删掉这个 Key
		}
		
		// 如果成功拿到了现货，直接带着胜利的果实返回 true
		if stop {
			return delivered
		}
	}

	// 【核心动作 2：拿不到现货，被迫“拿号排队”】
	// 运行到这里，说明池子里真的没货了（或者有货但都被删了）。
	// 此时我们要把当前请求 (w) 注册到等待队列中。
	if t.idleConnWait == nil {
		t.idleConnWait = make(map[connectMethodKey]wantConnQueue)
	}
	
	// 找到当前域名对应的等待队列
	q := t.idleConnWait[w.key]
	
	// 队列清理：把排在队头、但实际上已经等不急取消了的（Context Canceled）请求踢出去
	q.cleanFrontNotWaiting()
	
	// 把当前请求挂到队伍的最末尾
	q.pushBack(w)
	
	// 更新字典里的队伍
	t.idleConnWait[w.key] = q
	
	// 凄凉地返回 false，告诉外层：“我没立刻拿到，但我已经排上号了”
	return false
}
```

1. 为当前的请求 (wantConn w) 寻找一个空闲连接。
2. 它的返回值 delivered 告诉你，是否“当场”就成功交付了一个空闲连接，如果返回 false，说明没拿到，并且 w 已经被加入到了等待队列中。

#### queueForDial

```go
func (t *Transport) queueForDial(w *wantConn) {
	// 测试钩子：用于在单元测试中确认拨号请求是否进入了队列
	w.beforeDial()

	// 极其关键：锁住“单机并发连接数”的计数器
	// 为了防止瞬间并发几万个请求把目标服务器或者本机的端口打满，这里必须严格控制
	t.connsPerHostMu.Lock()
	defer t.connsPerHostMu.Unlock()

	// 场景 1：如果你根本没设置 MaxConnsPerHost (默认值是 0，表示不限制)
	if t.MaxConnsPerHost <= 0 {
		// 直接新开一个 Goroutine 去底层拨号
		t.startDialConnForLocked(w)
		return
	}

	// 场景 2：设置了限制，检查当前这个域名 (w.key) 已经建立或正在建立的连接总数 n
	if n := t.connsPerHost[w.key]; n < t.MaxConnsPerHost {
		// 如果还没达到上限，初始化字典（如果是第一次）
		if t.connsPerHost == nil {
			t.connsPerHost = make(map[connectMethodKey]int)
		}
		// 计数器 +1 (代表我占用了一个名额)
		t.connsPerHost[w.key] = n + 1
		
		// 绿灯！去拨号吧
		t.startDialConnForLocked(w)
		return
	}

	// 场景 3：红灯！当前域名的连接数已经达到 MaxConnsPerHost 上限了！
	// 你不能去拨号了，会引发雪崩的。你必须在这里排队，等别人把连接彻底销毁（或者复用给你）。
	if t.connsPerHostWait == nil {
		t.connsPerHostWait = make(map[connectMethodKey]wantConnQueue)
	}
	
	// 获取当前域名的“拨号等待队列”
	q := t.connsPerHostWait[w.key]
	
	// 防御性清理：把队头那些已经不耐烦（超时或被用户 Cancel）的死请求踢出队列
	q.cleanFrontNotWaiting()
	
	// 委屈地把自己加到等待拨号的队伍末尾
	q.pushBack(w)
	t.connsPerHostWait[w.key] = q
	
	// 注意：这里函数就结束了。
	// w 只能安静地在队列里等。当某个占着名额的连接被关闭时 (调用 t.decConnsPerHost)，
	// 那个关闭连接的 Goroutine 会负责把 w 叫醒，并给它放行。
}

// 附带看一下放行逻辑：startDialConnForLocked
// t.connsPerHostMu 必须在调用前被锁住
func (t *Transport) startDialConnForLocked(w *wantConn) {
	// 记录正在进行中的拨号任务
	t.dialsInProgress.cleanFrontCanceled()
	t.dialsInProgress.pushBack(w)
	
	// 【核心动作】：开一个新的 Goroutine 去执行真正的拨号！
	// 为什么一定要新开 Goroutine？
	// 因为 dialConn 底层要进行 DNS 解析、TCP 三次握手、TLS 握手，可能要耗费几百毫秒。
	// 绝对不能让它阻塞当前正在调度的主流程！
	go func() {
		// 去执行底层的网络建连，并把建好的连接送给 w
		t.dialConnFor(w)
		
		// 拨号结束（无论是成功还是失败），把用于取消拨号的 context 置空
		t.connsPerHostMu.Lock()
		defer t.connsPerHostMu.Unlock()
		w.cancelCtx = nil
	}()
}
```

1. `MaxConnsPerHost` 管的是“工作时”（活跃/并发期）：当前这台机器最多能同时发起多少个真正的网络交互。 
2. `MaxIdleConnsPerHost` 管的是“休息时”（长连接池）：当这些交互打完收工后，我愿意在内存里“白养”多少个闲人（空闲连接）等下一个任务。

#### tryPutIdleConn

```go
func (t *Transport) tryPutIdleConn(pconn *persistConn) error {
	// 【第 1 关：基础拦截】
	// 如果全局不让复用，或者底层的 TCP 已经被标记为损坏 (比如收到了 EOF)
	if t.DisableKeepAlives || pconn.isBroken() {
		return errKeepAlivesDisabled // 拒收，外层会把它物理断开
	}

	t.idleMu.Lock()
	defer t.idleMu.Unlock()

	// 【第 2 关：排队截胡 (Late Binding)】
	// 如果当前域名的等待队列里有人，并且队列没空
	if q, ok := t.idleConnWait[pconn.cacheKey]; ok && q.len() > 0 {
		w := q.popFront()        // 揪出排在最前面的那个请求
		w.tryDeliver(pconn, ...) // 直接把连接塞给它！
		return nil               // 移交成功，连接没有“闲置”，直接结束
	}

	// 【第 3 关：清场指令检查】
	// 如果业务方刚调了 CloseIdleConnections()，当前不收留任何准备闲置的连接
	if t.closeIdle {
		return errCloseIdle 
	}

	// 【第 4 关：单机限流 (防拥挤)】
	idles := t.idleConn[pconn.cacheKey]
	if len(idles) >= t.MaxIdleConnsPerHost {
		return errTooManyIdleHost // 满了，拒收当前连接
	}

	// === 通过所有考验，正式入池 ===
	t.idleConn[pconn.cacheKey] = append(idles, pconn) // 存入单机切片 (LIFO)

	// 【第 5 关：全局淘汰 (末位淘汰)】
	t.idleLRU.add(pconn) // 记录到全局 LRU 链表的头部（最热乎）
	
	// 如果全局空闲数超标了
	if t.MaxIdleConns != 0 && t.idleLRU.len() > t.MaxIdleConns {
		oldest := t.idleLRU.removeOldest() // 从尾部揪出那个最老的连接
		oldest.close()                     // 物理关闭它
		t.removeIdleConnLocked(oldest)     // 把它从对应的单机切片里抹除
	}

	// 【第 6 关：埋下定时炸弹】
	if t.IdleConnTimeout > 0 {
		// 时间一到，触发 closeConnIfStillIdle 函数，把连接干掉
		pconn.idleTimer = time.AfterFunc(t.IdleConnTimeout, pconn.closeConnIfStillIdle)
	}

	return nil // 完美归池
}
```
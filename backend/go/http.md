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
    ContentLength    int64         // 内容长度
    Host             string        // 目标主机名
  
    // 表单数据（需调用 ParseForm 后才有数据）
    Form             url.Values    // 包含 URL 查询参数和 POST 表单数据
    PostForm         url.Values    // 仅包含 POST 表单数据
    MultipartForm    *multipart.Form

    // 上下文（非常重要）
    ctx context.Context

    // 还有 RemoteAddr, TLS, RequestURI 等...
}
```

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

### 连接池

```go
func GetConn() {
	w := &wantConn{
		cm:         cm,
		key:        cm.key(),
		ctx:        dialCtx,
		cancelCtx:  dialCancel,
		result:     make(chan connOrError, 1),
		beforeDial: testHookPrePendingDial,
		afterDial:  testHookPostPendingDial,
	}
  	// Queue for idle connection.
	if delivered := t.queueForIdleConn(w); !delivered {
		t.queueForDial(w)
	}
}

func (t *Transport) queueForIdleConn(w *wantConn) (delivered bool) {
	if t.DisableKeepAlives { // 没开启keep alive则直接返回false，不允许复用连接
		return false
	}

	t.idleMu.Lock() // 加锁，只允许一个goroutine去修改idleConn等字段
	defer t.idleMu.Unlock()

	t.closeIdle = false
	var oldTime time.Time
	if t.IdleConnTimeout > 0 {
		oldTime = time.Now().Add(-t.IdleConnTimeout)
	}

	if list, ok := t.idleConn[w.key]; ok { // 根据scheme、url组成的str去获取对应的空闲队列，从而复用连接（这样被连接方的tcp都是不变的）
		stop := false
		delivered := false
		for len(list) > 0 && !stop {
			pconn := list[len(list)-1]

			tooOld := !oldTime.IsZero() && pconn.idleAt.Round(0).Before(oldTime)
			if tooOld {
				go pconn.closeConnIfStillIdle()
			}
			if pconn.isBroken() || tooOld { // 连接太老或者坏了就需要移除
				list = list[:len(list)-1]
				continue
			}
			delivered = w.tryDeliver(pconn, nil, pconn.idleAt) // 尝试请求，如果当前请求已经完成了就返回false（比如其他情况抢先把请求完成）
			if delivered {
				if pconn.alt != nil { // h2可共享连接，不需要移除
					// HTTP/2: multiple clients can share pconn.
					// Leave it in the list.
				} else { // h1独占连接，需要移除避免给其他连接复用
					// HTTP/1: only one client can use pconn.
					// Remove it from the list.
					t.idleLRU.remove(pconn)
					list = list[:len(list)-1]
				}
			}
			stop = true
		}
		if len(list) > 0 {
			t.idleConn[w.key] = list
		} else {
			delete(t.idleConn, w.key)
		}
		if stop {
			return delivered
		}
	}

	// Register to receive next connection that becomes idle.
	if t.idleConnWait == nil {
		t.idleConnWait = make(map[connectMethodKey]wantConnQueue)
	}
	q := t.idleConnWait[w.key]
	q.cleanFrontNotWaiting()
	q.pushBack(w) // 没获取到就放入等待队列
	t.idleConnWait[w.key] = q
	return false // 返回false，尝试
}

func (t *Transport) queueForDial(w *wantConn) {
	w.beforeDial()

	t.connsPerHostMu.Lock()
	defer t.connsPerHostMu.Unlock()

	if t.MaxConnsPerHost <= 0 {
		t.startDialConnForLocked(w)
		return
	}

	if n := t.connsPerHost[w.key]; n < t.MaxConnsPerHost { // 如果没超过限制就开始拨号，不等空闲连接
		if t.connsPerHost == nil {
			t.connsPerHost = make(map[connectMethodKey]int)
		}
		t.connsPerHost[w.key] = n + 1
		t.startDialConnForLocked(w)
		return
	}

	if t.connsPerHostWait == nil {
		t.connsPerHostWait = make(map[connectMethodKey]wantConnQueue)
	}
	q := t.connsPerHostWait[w.key]
	q.cleanFrontNotWaiting()
	q.pushBack(w)
	t.connsPerHostWait[w.key] = q
}

func (t *Transport) tryPutIdleConn(pconn *persistConn) error {
	if t.DisableKeepAlives || t.MaxIdleConnsPerHost < 0 { // 没开启或者MaxIdleConnsPerHost小于0，就不考虑连接复用
		return errKeepAlivesDisabled
	}
	if pconn.isBroken() {
		return errConnBroken
	}
	pconn.markReused()

	t.idleMu.Lock()
	defer t.idleMu.Unlock()

	if pconn.alt != nil && t.idleLRU.m[pconn] != nil {
		return nil
	}

	key := pconn.cacheKey
	if q, ok := t.idleConnWait[key]; ok { // 从等待空闲连接中取请求
		done := false
		if pconn.alt == nil {
			// HTTP/1.
			// Loop over the waiting list until we find a w that isn't done already, and hand it pconn.
			for q.len() > 0 {
				w := q.popFront()
				if w.tryDeliver(pconn, nil, time.Time{}) {
					done = true
					break
				}
			}
		} else {
			// HTTP/2.
			// 连接可以复用，不需要跳出
			for q.len() > 0 {
				w := q.popFront()
				w.tryDeliver(pconn, nil, time.Time{})
			}
		}
		if q.len() == 0 {
			delete(t.idleConnWait, key)
		} else {
			t.idleConnWait[key] = q
		}
		if done {
			return nil
		}
	}

	if t.closeIdle {
		return errCloseIdle
	}
	if t.idleConn == nil {
		t.idleConn = make(map[connectMethodKey][]*persistConn)
	}
	idles := t.idleConn[key]
	if len(idles) >= t.maxIdleConnsPerHost() {
		return errTooManyIdleHost
	}
	for _, exist := range idles {
		if exist == pconn {
			log.Fatalf("dup idle pconn %p in freelist", pconn)
		}
	}
	t.idleConn[key] = append(idles, pconn)
	t.idleLRU.add(pconn) // idleLRU管理整个空闲连接，剔除 MaxIdleConns 的数量
	if t.MaxIdleConns != 0 && t.idleLRU.len() > t.MaxIdleConns {
		oldest := t.idleLRU.removeOldest()
		oldest.close(errTooManyIdle)
		t.removeIdleConnLocked(oldest)
	}

	if t.IdleConnTimeout > 0 && pconn.alt == nil {
		if pconn.idleTimer != nil {
			pconn.idleTimer.Reset(t.IdleConnTimeout)
		} else {
			pconn.idleTimer = time.AfterFunc(t.IdleConnTimeout, pconn.closeConnIfStillIdle)
		}
	}
	pconn.idleAt = time.Now()
	return nil
}

func (t *Transport) decConnsPerHost(key connectMethodKey) {
	if t.MaxConnsPerHost <= 0 {
		return
	}

	t.connsPerHostMu.Lock()
	defer t.connsPerHostMu.Unlock()
	n := t.connsPerHost[key]
	if n == 0 {
		panic("net/http: internal error: connCount underflow")
	}

	if q := t.connsPerHostWait[key]; q.len() > 0 { // 减少连接数量，也就意味着在等待去请求新连接的请求可以发起连接了
		done := false
		for q.len() > 0 {
			w := q.popFront()
			if w.waiting() {
				t.startDialConnForLocked(w)
				done = true
				break
			}
		}
		if q.len() == 0 {
			delete(t.connsPerHostWait, key)
		} else {
			// q is a value (like a slice), so we have to store
			// the updated q back into the map.
			t.connsPerHostWait[key] = q
		}
		if done {
			return
		}
	}

	// Otherwise, decrement the recorded count.
	if n--; n == 0 {
		delete(t.connsPerHost, key)
	} else {
		t.connsPerHost[key] = n
	}
}
```

`tryPutIdleConn` 是在连接“工作完想休息”时调用的，而 `decConnsPerHost` 是在连接“彻底报废”时调用的

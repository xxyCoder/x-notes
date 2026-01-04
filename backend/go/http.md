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

var DefaultClient = &Client{}

// 简化
func (c *Client) Do(req *Request) (*Response, error) {
    // 1. 基础检查
    if req.URL == nil {
        return nil, errors.New("http: nil Request.URL")
    }

    var (
        deadline      time.Time
        didTimeout    func() bool
        resp          *Response
        err           error
        // ... 其他状态变量
    )

    // 2. 超时处理：计算截止时间
    deadline = c.deadline() // 根据 c.Timeout 计算

    for {
        // 3. 准备当前请求：注入 Cookie
        if c.Jar != nil {
            for _, cookie := range c.Jar.Cookies(req.URL) {
                req.AddCookie(cookie)
            }
        }

        // 4. 发送请求：核心调用 Transport.RoundTrip
        resp, didTimeout, err = c.send(req, deadline)
        if err != nil {
            return nil, err
        }

	if c.Jar != nil {
		if rc := resp.Cookies(); len(rc) > 0 {
			c.Jar.SetCookies(req.URL, rc)
		}
	}

        // 5. 处理重定向
        redirectMethod, shouldRedirect, includeBody := redirectBehavior(req.Method, resp, req)
        if !shouldRedirect {
            return resp, nil // 不需要重定向，直接返回响应
        }

        // 6. 检查重定向次数 (默认上限 10 次)
        if len(reqs) >= 10 {
            return nil, errors.New("http: too many redirects")
        }

        // 7. 更新请求对象，准备进入下一次循环
        req = nextRequest // 构造重定向后的新请求
    }
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
			snapshot := *v
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
2. `NewRequestWithContext`方法组装 `Request`结构体内容，设置 `GetBody`方法
3. `WithContext`则是创建一个新的 `Request`，设置 `ctx`并返回

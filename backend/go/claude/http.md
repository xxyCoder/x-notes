## 第一部分：HTTP 客户端

### 1. 快捷函数 `http.Get` / `http.Post`
```go
resp, err := http.Get(url)
resp, err := http.Post(url, contentType, body)
```
- 内部本质是 `http.DefaultClient.Get/Post`
- `body`参数是`io.Reader`，`bytes.Buffer`/`strings.Reader`都能传
- **不推荐生产环境用**：无超时设置

### 2. `http.Response` 结构
- `StatusCode`：建议用`http.StatusOK`等常量，不要硬编码数字
- `Header.Get("Key")`：**永远用`.Get()`**，不要直接用map语法（大小写不敏感问题）
- `Body`是`io.ReadCloser`，**只能读一次**

### 3. Body 读取与资源释放
- **黄金法则**：`err`判断在前，`defer resp.Body.Close()`紧跟其后
- Body关联TCP连接，不Close会导致连接池失效、资源泄漏
- 三种读取方式：`io.ReadAll` / `json.NewDecoder().Decode()` / 分块`Read`
- `io.TeeReader(r, w)`：边读边复制一份，适合"流式处理+留副本"场景（如边下载边算hash），但如果副本目标是内存（`bytes.Buffer`），并不省内存，效果等同于`ReadAll`

### 4. `http.NewRequest` + `client.Do`
```go
req, _ := http.NewRequest(http.MethodPut, url, body)
req.Header.Set("Authorization", "Bearer token")
resp, err := client.Do(req)
```
- 支持任意方法、自定义Header
- `Get`/`Post`底层也是这套机制的封装

### 5. `http.Client` 与 `Transport`
- `http.DefaultClient`无超时，**生产环境禁止直接用**
- `Client.Timeout`覆盖**整个生命周期**：连接+发送+等响应头+**读完Body**
- `Transport`才是真正维护**连接池**的对象，`Client`本身很轻量
- **Client/Transport应该全局复用**，不要每次请求都new
- `MaxIdleConnsPerHost`默认只有2，高并发要调大
- 经验公式：`所需并发连接数 ≈ QPS × 平均耗时`，`MaxIdleConnsPerHost`应设为此值的1.2~1.5倍
- QPS本身不能直接换算成并发连接数，必须结合耗时

### 6. Query/Form/JSON 构造
- Query参数、Form表单：都用`url.Values` + `.Encode()`，前者拼URL，后者放Body
- JSON：`json.Marshal`或`json.NewEncoder(&buf).Encode()`（后者少一次内存分配）
- Content-Type要写对：`application/x-www-form-urlencoded` / `application/json`

---

## 第二部分：HTTP 服务端

### 7. 基础服务
```go
http.HandleFunc("/hello", handler)
http.ListenAndServe(":8080", nil)
```
- handler签名固定：`func(w http.ResponseWriter, r *http.Request)`
- **每个请求 = 一个独立goroutine**，共享变量需要并发安全保护
- Go时间格式化用固定参考时间：`"2006-01-02 15:04:05"`（不能随便写数字占位）

### 8. `http.Handler` 接口设计
```go
type Handler interface { ServeHTTP(w, r) }
type HandlerFunc func(ResponseWriter, *Request)
func (f HandlerFunc) ServeHTTP(w, r) { f(w, r) }
```
- 接口是**隐式实现**的（不需要写implements）
- `http.HandlerFunc(fn)`是**类型转换**，不是函数调用，目的是让裸函数获得`ServeHTTP`方法
- `http.Handle`接受已实现Handler接口的对象；`http.HandleFunc`接受裸函数（内部自动转换）
- 这套设计是中间件模式的基础——Handler可以互相包装

### 9. `http.Request` 详解
- `r.URL.Query()`：Query参数
- `r.Header.Get()`：请求头
- `r.Method`：判断方法
- `r.Body`：**服务端不需要手动Close**（框架自动处理）
- `r.ParseForm()` + `r.FormValue()`：自动兼容GET query和POST body
- `r.RemoteAddr`：直连客户端地址，反向代理后可能不是真实IP

### 10. `http.ResponseWriter` 顺序陷阱
```go
type ResponseWriter interface {
	Header() Header
	Write([]byte) (int, error)
	WriteHeader(statusCode int)
}
```
- **黄金顺序**：`Header().Set()` → `WriteHeader()` → `Write()`
- 第一次调用`Write`会自动锁定状态码（默认200）和Header，之后修改无效
- 错误处理必须**先WriteHeader再写Body**

### 11. `http.ServeMux` 路由规则（传统）
- pattern不以`/`结尾 → **精确匹配**
- pattern以`/`结尾 → **子树匹配**（前缀匹配）
- **精确匹配 > 子树匹配**（优先级更高，不管字符串长短）
- 多个子树规则冲突，最长前缀优先
- `"/"` 是终极兜底，几乎不会出现404
- **特殊行为**：访问"子树pattern去掉尾斜杠"的路径，且该路径未被单独注册，会触发**301重定向**到带斜杠的版本

### 12. Go 1.22+ 新路由特性
```go
mux.HandleFunc("GET /users/{id}", handler)
id := r.PathValue("id")
mux.HandleFunc("GET /files/{path...}", handler) // 通配符，匹配剩余全部路径
```
- pattern格式：`"METHOD PATH"`，方法不匹配自动返回405
- **字面量路径段优先于`{参数}`**（如`/user/me`优先于`/user/{id}`）
- 优先级只跟pattern具体程度有关，**跟注册顺序无关**

---

## 第三部分：中间件与工程化

### 13. 中间件模式
```go
func middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w, r) {
		// 前置逻辑
		next.ServeHTTP(w, r)
		// 后置逻辑
	})
}
```
- 本质：接收Handler，返回新Handler的高阶函数
- **执行顺序（洋葱模型）**：最外层最先执行前置逻辑，最后执行后置逻辑
- 组合：`middlewareA(middlewareB(handler))`，可写`chain`辅助函数简化

### 14. 实战中间件
- **包装ResponseWriter**记录状态码（因为原生接口只能写不能读）：
```go
type statusRecorder struct {
	http.ResponseWriter
	statusCode int
}
func (r *statusRecorder) WriteHeader(code int) {
	r.statusCode = code
	r.ResponseWriter.WriteHeader(code) // 必须调用内嵌对象的原方法，否则死递归
}
```
- 传给下游的必须是**包装后的对象**：`next.ServeHTTP(recorder, r)`
- panic恢复：`defer + recover()`，配合`debug.Stack()`打印堆栈
- 鉴权中间件如何传值给下游 → 引出context

### 15. `context.Context`
```go
ctx := context.WithValue(r.Context(), key, value) // 传值，key用自定义类型防冲突
r = r.WithContext(ctx) // 生成新Request，重新赋值传递

ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second) // 超时
defer cancel()

ctx, cancel := context.WithCancel(parent) // 手动取消
defer cancel()
```
- Context不可变，每次"添加"是包装出新的一层
- `r.Context()`：客户端断开/超时会自动取消
- `WithCancel`取消会**向下传播**给所有子context，反向不成立
- **`select`里绝对不能加`default`**去"检测"ctx.Done()——有`default`就变成非阻塞，会立即走default分支，等待/竞争完全失效
- 正确写法：`select { case <-ctx.Done(): ...; case <-realWork: ... }`

### 16. 静态文件服务
```go
http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("./static"))))
http.ServeFile(w, r, "./files/report.pdf")
```
- `StripPrefix`用于配合子树路由剥掉URL前缀
- `ServeFile`支持Range请求（断点续传）

**安全深挖：目录穿越（Path Traversal）**
- `http.Dir.Open`内部会把路径当"绝对路径"清理（先加`/`再`Clean`），`../`会被"吸收"在根目录内，**这套保护只在"根目录固定、路径来自URL"这种标准用法下生效**
- 一旦**自己手动拼接字符串**（如`"./files/"+用户输入`），攻击者的`../`可能混入"根目录"部分，绕开保护
- 防御三层：`filepath.Clean`（不够）→ 验证最终路径是否以baseDir为前缀（核心防线）→ 白名单映射（最安全）
- Go新版本提供`filepath.IsLocal(path)`判断路径是否会跳出当前目录
- Go没有提供"一键安全拼接"的公开函数（社区提案被拒），设计哲学是**只提供底层判断工具，拼接逻辑和安全责任留给开发者**

**目录列表禁用原理**
- `FileServer`默认会在目录无`index.html`时列出目录内容
- 禁用技巧：包装`http.FileSystem`，重写`Open`方法——检测到是目录且无`index.html`时，**故意返回错误，伪装成"打不开"**，让`FileServer`认为路径不存在直接404
- 本质：不能改`FileServer`内部逻辑，就在它依赖的接口上做文章（跟包装ResponseWriter是同一种思路）
- Go没有提供现成开关，因为"该返回404还是403、要不要自定义页面"属于策略层面，交给开发者通过`FileSystem`接口自行实现

---

## 接口（Interface）深入理解

- 接口 = 一组方法签名的约定，**隐式实现**
- 接口变量内部结构：`(动态类型, 动态值)`
- **经典坑**：`var d *Dog = nil; var a Animal = d`，此时`a != nil`（类型部分非空，只有值是nil）
- **方法集规则**：
  - 值接收者方法：值类型和指针类型都拥有
  - 指针接收者方法：**只有指针类型**拥有
  - 原因：值接收者方法如果改字段，改的是拷贝，不会影响原对象，所以指针接收者方法不能"降级"给值类型使用
- 实用技巧：`var _ http.ResponseWriter = &MyType{}`，编译期提前验证接口实现

---

## `sync/atomic` 用法

```go
var counter atomic.Int32       // 新式：类型化，方法调用
counter.Add(1); counter.Load(); counter.Store(10)

var counter int32              // 老式：普通类型+包函数+指针
atomic.AddInt32(&counter, 1)
```
- 新式更安全（不会忘记用atomic操作），老式能直接比较但容易忘记用atomic
- **经典竟态坑**：先`Load`检查、再`Add`修改，这两步分开不是原子操作，并发下会"超限"。正确做法：先`Add`拿到新值再判断，超了就`Add(-1)`撤销

---

## 第四部分：进阶主题

### 17. Cookie 与 Session
```go
http.SetCookie(w, &http.Cookie{
	Name: "token", Value: "xxx", Path: "/",
	MaxAge: 3600, HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode,
})
cookie, err := r.Cookie("token") // 判断errors.Is(err, http.ErrNoCookie)
```
- 删除Cookie：重新设置同名Cookie，`MaxAge: -1`，**Path必须跟设置时一致**
- `http.SetCookie`本质就是调用`w.Header().Add("Set-Cookie", 拼好的字符串)`，只是帮你处理好格式细节（多个Cookie必须用`Add`不能用`Set`，否则会互相覆盖）
- Session核心思想：Cookie只存随机ID，真实数据存服务端（内存/Redis），内存版需要`sync.Mutex`保护map并发安全，生产环境用`crypto/rand`生成ID

### 18. 文件上传/下载（Multipart）
```go
// 服务端接收
r.Body = http.MaxBytesReader(w, r.Body, 10<<20) // 限制大小
r.ParseMultipartForm(10 << 20)
file, header, err := r.FormFile("file")
defer file.Close()
// header.Filename不可信，要用filepath.Base()清理

// 客户端发送
writer := multipart.NewWriter(&buf)
part, _ := writer.CreateFormFile("file", filename)
io.Copy(part, file)
writer.Close() // 必须关闭，否则数据不完整
req.Header.Set("Content-Type", writer.FormDataContentType())
```
- 下载：`Content-Disposition: attachment; filename=xxx` 提示浏览器下载而非直接显示

### 19. HTTPS / TLS
```go
server := &http.Server{
	Addr: ":443", Handler: mux,
	TLSConfig: &tls.Config{MinVersion: tls.VersionTLS12},
}
server.ListenAndServeTLS("cert.pem", "key.pem")
```
- 服务端`r.URL.Scheme`/`r.URL.Host`几乎总是空的（请求行不带这些信息），**不能用来判断当前是不是HTTPS**，应该用独立的handler分离HTTP/HTTPS逻辑
- `InsecureSkipVerify: true`：跳过全部证书校验，**绝对不能用于生产**（谁的证书都信，无法防中间人攻击）
- 更安全的做法：把自签名证书加进`tls.Config.RootCAs`，只信任这一个特定证书（证书锚定），校验逻辑依然执行，只是信任范围收窄

### 20. 优雅关闭
```go
go server.ListenAndServe()
quit := make(chan os.Signal, 1)
signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
<-quit
ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
defer cancel()
server.Shutdown(ctx)
```
- `Shutdown`：停止接受新连接，等待现有请求完成
- `SIGTERM`是容器编排系统（Docker/K8s）优雅停止时发送的信号，必须监听
- `http.ErrServerClosed`是`Shutdown`触发后的**正常**返回值，不是错误
- **关键澄清**：`Shutdown`超时后，**不会主动强制断开**正在处理的连接，只是自己"放弃等待"返回错误；请求最终是否被中断，取决于**进程本身是否退出**（进程退出才会连带杀死所有goroutine）
- Shutdown不会等待被`Hijack`的长连接（如WebSocket），需要额外处理

### 21. 反向代理 `httputil.ReverseProxy`
```go
target, _ := url.Parse("http://localhost:9000")
proxy := httputil.NewSingleHostReverseProxy(target)
```
- `Director`：转发前修改请求；`ModifyResponse`：响应返回前修改；`ErrorHandler`：转发失败时处理
- **关键模型**：代理同时是两条独立TCP连接的中间人——对客户端是"服务端"（有自己的`w1`），对后端是"客户端"（通过`Transport.RoundTrip`拿到`*http.Response`）。后端handler写的是它自己独立的`w2`，跟`w1`毫无关系。代理是把从`resp`里读到的内容"重新写"进`w1`，这是`w1`第一次被调用`WriteHeader`，完全符合"只能写一次"规则，不矛盾
- `ErrorHandler`和`Director`可以通过包级共享状态（如`atomic.Bool`）实现故障转移
- 反向代理本身也是`Handler`，可以套用中间件

---
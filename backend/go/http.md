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
            // 将当前缓冲区填满并刷新到内核
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

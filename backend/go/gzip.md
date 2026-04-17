## 核心结构

gzip stream 结构：`[header][deflate 压缩数据][tail(CRC32 + 原始size)]`

多个 stream 可以首尾拼接，这是 RFC 1952 的合法格式。

### Header

```go
type Header struct {
    Comment string    // gzip header 里的注释字段，很少用
    Extra   []byte    // gzip header 里的扩展字段，bgzf 等格式用它存元数据
    ModTime time.Time // 原始文件的修改时间，压缩普通内容时通常为零值
    Name    string    // 原始文件名
    OS      byte      // 产生该文件的操作系统类型，255 表示 unknown
}
```

Header 被 Writer 和 Reader 共同嵌入，Writer 写入时把这些字段编码进 gzip header，Reader 解析后把它们暴露出来。

### Writer

```go
type Writer struct {
    Header               // 嵌入，写入前可设置 Name/ModTime 等元数据
    w           io.Writer  // 压缩数据的目标输出
    level       int        // 压缩级别，Reset 时保留
    wroteHeader bool       // header 是否已写入，懒写入的标志位
    closed      bool       // 是否已 Close，防止重复关闭
    buf         [10]byte   // 复用的临时缓冲区，写 header 和 tail 时用
    compressor  *flate.Writer // 底层 deflate 压缩器，Reset 时复用避免重新分配
    digest      uint32     // 滚动计算的 CRC-32，每次 Write 时累加，Close 时写入 tail
    size        uint32     // 累计的原始数据字节数，Close 时写入 tail
    err         error      // 记录第一个错误，之后所有操作直接返回该错误
}
```

### Reader

```go
type Reader struct {
    Header               // 嵌入，NewReader/Reset 后可读取当前 stream 的元数据
    r            flate.Reader  // 底层字节读取器，需实现 io.ByteReader 才能精确定位 stream 边界
    decompressor io.ReadCloser // 底层 deflate 解压器，Reset 时复用
    digest       uint32        // 滚动计算的 CRC-32，读完后与 tail 中的值校验
    size         uint32        // 已读取的原始字节数，读完后与 tail 中的值校验
    buf          [512]byte     // 读 header 字符串字段（Name/Comment）时的临时缓冲区
    err          error         // 记录第一个错误
    multistream  bool          // 是否自动穿透多个 stream，默认 true
}
```

---

## Writer

### NewWriter

```go
func NewWriter(w io.Writer) *Writer {
    z, _ := NewWriterLevel(w, DefaultCompression)
    return z
}
```

只初始化结构体，**不写任何字节**到 w。

### Write

```go
func (z *Writer) Write(p []byte) (int, error) {
    if !z.wroteHeader {
        z.wroteHeader = true
        // 写 10 字节 gzip header
        z.w.Write(z.buf[:10])
        // 初始化 flate.Writer
        z.compressor, _ = flate.NewWriter(z.w, z.level)
    }
    z.size += uint32(len(p))
    z.digest = crc32.Update(z.digest, crc32.IEEETable, p)
    z.compressor.Write(p)
}
```

header 是**懒写入**的，第一次 Write 时才写。同时累计 CRC32 和原始数据大小，供 Close 写 tail 用。

### Flush

```go
func (z *Writer) Flush() error {
    z.err = z.compressor.Flush() // Z_SYNC_FLUSH
    return z.err
}
```

把压缩缓冲区的数据强制刷到底层 writer，但不写 tail，stream 还没结束。适用于网络流式传输场景，让对端能立即收到部分数据。**写文件/buffer 时不需要手动调，Close 会处理。**

### Close

```go
func (z *Writer) Close() error {
    z.closed = true
    z.compressor.Close()          // flush + 结束 deflate stream
    le.PutUint32(z.buf[:4], z.digest)
    le.PutUint32(z.buf[4:8], z.size)
    z.w.Write(z.buf[:8])          // 写 tail
    return z.err
}
```

两件事：结束压缩流 + 写 8 字节 tail（CRC32 + 原始大小）。Close 内部包含了 flush，不需要在 Close 前手动 Flush。

### Reset

```go
func (z *Writer) Reset(w io.Writer) {
    z.init(w, z.level)
}

func (z *Writer) init(w io.Writer, level int) {
    compressor := z.compressor
    if compressor != nil {
        compressor.Reset(w) // 复用，避免重新分配
    }
    *z = Writer{w: w, level: level, compressor: compressor}
}
```

清空所有状态（`wroteHeader`、`closed`、CRC、size 归零），换上新的目标 writer，复用 `flate.Writer`（内部有压缩状态表，复用比重新分配便宜）。用于写多个独立 stream 时避免重复 `NewWriter`：

```go
w := gzip.NewWriter(&buf)
for _, msg := range msgs {
    w.Reset(&buf)
    w.Write([]byte(msg))
    w.Close()
}
```

---

## Reader

### NewReader

```go
func NewReader(r io.Reader) (*Reader, error) {
    z := new(Reader)
    z.r = makeReader(r)
    z.multistream = true
    z.Header, z.err = z.readHeader()
    return z, z.err
}
```

立即读取并解析第一个 gzip header，失败则返回错误（比如数据不是 gzip 格式）。

### Read

读取解压后的数据。`multistream=true` 时，读完一个 stream 后如果后面还有合法 header，会自动继续读下一个 stream，对调用者透明。

### Multistream

```go
func (z *Reader) Multistream(ok bool) {
    z.multistream = ok
}
```

控制是否自动穿透多个 stream：

- `true`（默认）：多个 stream 合并读取，`cat a.gz b.gz` 拼接的文件能正确解压
- `false`：读完当前 stream 就返回 `io.EOF`，调用者自己决定是否继续读下一个

`false` 的使用场景：需要感知每个 stream 边界的自定义格式，如 bgzf（BAM 基因组文件）。

### Reset

```go
func (z *Reader) Reset(r io.Reader) error {
    *z = Reader{
        decompressor: z.decompressor, // 复用
        multistream:  true,           // 重置为默认值
    }
    z.r = makeReader(r)
    z.Header, z.err = z.readHeader() // 立即读下一个 header
    return z.err
}
```

三步：清空状态、换底层 reader、读取下一个 stream 的 header。返回 `io.EOF` 说明没有更多 stream 了。

注意：Reset 会把 `multistream` 重置为 `true`，所以逐个读 stream 时要在每次 Reset 后重新调 `Multistream(false)`：

```go
r, _ := gzip.NewReader(&buf)
for i := 0; ; i++ {
    r.Multistream(false)
    data, _ := io.ReadAll(r)
    fmt.Printf("stream %d: %s\n", i, string(data))

    if err := r.Reset(&buf); err == io.EOF {
        break
    }
}
```

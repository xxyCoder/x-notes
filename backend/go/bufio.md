# bufio

bufio 在内存中维护缓冲区，减少对底层 `io.Reader`/`io.Writer` 的系统调用次数。

---

## Reader 结构体

```go
type Reader struct {
    buf          []byte    // 内部缓冲区
    rd           io.Reader // 底层真实 Reader
    r, w         int       // r = 下次读取位置；w = 有效数据末尾
    err          error     // 上次底层读取的错误，延迟返回
    lastByte     int       // 最后读取的字节，供 UnreadByte 用；-1 表示无效
    lastRuneSize int       // 最后读取的 rune 字节长度，供 UnreadRune 用；-1 表示无效
}
```

`buf[r:w]` 是已从底层读入、但还未被上层消费的有效数据：

```
buf:  [ _ _ _ _ d d d d d _ _ _ ]
                ^         ^
                r         w
```

- 上层消费数据 → `r` 右移
- `r == w` 时触发 `fill()`，重新从底层读取
- `err` 延迟返回：底层返回 `(n, err)` 时先存数据，下次调用再返回 err，保证数据不丢

---

## fill() — 核心内部方法

```go
func (b *Reader) fill() {
    if b.r > 0 {
        copy(b.buf, b.buf[b.r:b.w]) // 未消费数据挪到 buf 头部
        b.w -= b.r
        b.r = 0
    }
    // 从 b.w 往后填充
    n, err := b.rd.Read(b.buf[b.w:])
    b.w += n
    b.err = err
}
```

调用前提：`b.w < len(b.buf)`（缓冲区未满），否则 panic。所有调用 `fill()` 的地方都会先检查这个条件。

连续 100 次底层返回 `(0, nil)` 会设 `io.ErrNoProgress`，防止异常 Reader 死循环。

---

## Read

```go
if b.r == b.w {                   // 缓冲区空
    if len(p) >= len(b.buf) {     // 且 p >= 缓冲区大小
        n, b.err = b.rd.Read(p)   // 直接读到 p，跳过缓冲（避免多一次 copy）
        return n, b.readErr()
    }
    // 否则先 fill 一次（注意：直接调 b.rd.Read 而非 fill()）
    n, b.err = b.rd.Read(b.buf)
    b.w += n
}
n = copy(p, b.buf[b.r:b.w])
b.r += n
```

这里不用 `fill()` 而直接调 `b.rd.Read`，因为 `fill()` 内部会循环重试，而 `Read` 语义是**最多一次底层读取**。

**注意**：返回的 `n` 可能小于 `len(p)`，要读满用 `io.ReadFull(b, p)`。

---

## ReadByte / UnreadByte

```go
// ReadByte：缓冲区空就 fill，然后取 buf[r]
for b.r == b.w { b.fill() }
c := b.buf[b.r]
b.r++
b.lastByte = int(c)
```

`UnreadByte` 有一个边界情况：

```go
if b.r > 0 {
    b.r--                  // 正常情况：r 回退
} else {
    // b.r == 0 && b.w == 0：缓冲区完全空
    b.w = 1                // 把 lastByte 写回 buf[0]，人为制造一个有效字节
}
b.buf[b.r] = byte(b.lastByte)
```

`b.r == 0 && b.w > 0` 时返回错误：r 已在头部无法回退，且缓冲区还有其他数据，不安全。

**注意**：`Peek`、`Discard`、`WriteTo` 调用后会把 `lastByte` 置 -1，之后调 `UnreadByte` 会报错。

---

## ReadRune / UnreadRune

```go
// fill 的触发条件：剩余数据不足 4 字节 且 不是完整 rune 且 缓冲区未满
for b.r+utf8.UTFMax > b.w && !utf8.FullRune(b.buf[b.r:b.w]) && b.err == nil && b.w-b.r < len(b.buf) {
    b.fill()
}
```

防止多字节字符被截断在缓冲区边界。

`UnreadRune` 比 `UnreadByte` 更严格：**只能**在 `ReadRune` 之后调用，其他任何读操作后调用都报错。

---

## ReadSlice / ReadBytes / ReadString — 三层关系

```
ReadString / ReadBytes
    └── collectFragments（循环拼接）
            └── ReadSlice（单次查找，返回 buf 内切片）
                    └── fill
```

### ReadSlice

```go
s := 0
for {
    if i := bytes.IndexByte(b.buf[b.r+s:b.w], delim); i >= 0 {
        line = b.buf[b.r : b.r+i+1]  // 返回 buf 内部切片，零拷贝
        b.r += i + 1
        break
    }
    if b.Buffered() >= len(b.buf) {
        err = ErrBufferFull            // 缓冲区满了还没找到 delim，直接报错
        break
    }
    s = b.w - b.r  // 记录已扫描位置，fill 后不重复扫描
    b.fill()
}
```

两个核心限制：
1. 返回的是 `buf` 内部切片，**下次任何读操作都会覆盖这块内存**
2. 行长超过缓冲区大小直接返回 `ErrBufferFull`，不扩容

### collectFragments

```go
for {
    frag, e = b.ReadSlice(delim)
    if e == nil { break }            // 找到 delim
    if e != ErrBufferFull { break }  // 真正的错误
    // ErrBufferFull：这段没有 delim，clone 保存，继续读下一段
    fullBuffers = append(fullBuffers, bytes.Clone(frag))
}
```

`ReadBytes/ReadString` 能处理超长行的原因：把 `ErrBufferFull` 当作"继续"信号，每段 `Clone` 后拼接，代价是多次内存分配。

### 选择依据

| 方法 | 返回 | 超长行 | 内存 |
|------|------|--------|------|
| `ReadSlice` | buf 内切片（会被覆盖）| 报 ErrBufferFull | 零拷贝 |
| `ReadBytes` | 独立 `[]byte` | 支持 | 分配新内存 |
| `ReadString` | 独立 `string` | 支持 | 分配新内存 |

---

## ReadLine — 不推荐直接使用

直接调 `ReadSlice('\n')`，超长行设 `isPrefix=true` 返回，让调用方自己拼接。还要处理 `\r\n` 跨缓冲区边界的情况。官方注释明确说：

> Most callers should use ReadBytes('\n') or ReadString('\n') instead or use a Scanner.

---

## Peek

```go
for b.w-b.r < n && b.w-b.r < len(b.buf) && b.err == nil {
    b.fill()
}
return b.buf[b.r : b.r+n], err  // 返回 buf 内切片，不移动 r
```

- 预读 n 字节但不消费（`r` 不移动）
- `n > len(b.buf)` 时返回 `ErrBufferFull`
- 返回的切片在下次读操作后失效
- 调用后 `lastByte` 和 `lastRuneSize` 被置 -1，`UnreadByte/UnreadRune` 失效

---

## 创建

```go
r := bufio.NewReader(rd)              // 默认 4096 字节缓冲
r := bufio.NewReaderSize(rd, 65536)   // 自定义缓冲大小，最小 16 字节
```

`NewReaderSize` 如果传入的 `rd` 本身已经是缓冲足够大的 `*bufio.Reader`，直接返回原对象，不重复包装。

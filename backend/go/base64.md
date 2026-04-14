## Encoding

```go
const (
    StdPadding rune = '=' // Standard padding character
    NoPadding  rune = -1  // No padding
)

type Encoding struct {
	encode    [64]byte   // mapping of symbol index to symbol byte value
	decodeMap [256]uint8 // mapping of symbol byte value to symbol index
	padChar   rune
	strict    bool
}

type CorruptInputError int64

func (e CorruptInputError) Error() string {
    return "illegal base64 data at input byte " + strconv.FormatInt(int64(e), 10)
}
```

`Encoding` 代表了一种特定的 Base64 编码规则

1. `encode` 充当 索引到字符 的查询表，因为base64是6 bit一组，正好范围是0~63（2^6）
2. `decodeMap` 充当 字符到索引 的查询表，因为一个ascii字符占1 bit，范围是0~255（2^8）
3. `strict` 表示是否严格模式，如果是严格模式则解码器会严格检查这些未对齐的填充位是否真的为 0，如果不是，则直接抛出 `CorruptInputError` 错误（在解码时，如果数据长度不是 3 的倍数，我们在编码时会填充多余的零）

### NewEncoding

```go
func NewEncoding(encoder string) *Encoding {
	if len(encoder) != 64 {
		panic("encoding alphabet is not 64-bytes long")
	}

	e := new(Encoding)
	e.padChar = StdPadding
	copy(e.encode[:], encoder)
	copy(e.decodeMap[:], decodeMapInitialize)

	for i := 0; i < len(encoder); i++ {
		// Note: While we document that the alphabet cannot contain
		// the padding character, we do not enforce it since we do not know
		// if the caller intends to switch the padding from StdPadding later.
		switch {
		case encoder[i] == '\n' || encoder[i] == '\r':
			panic("encoding alphabet contains newline character")
		case e.decodeMap[encoder[i]] != invalidIndex:
			panic("encoding alphabet includes duplicate symbols")
		}
		e.decodeMap[encoder[i]] = uint8(i)
	}
	return e
}
```

1. `decodeMapInitialize` 是被定义为一个包含了 256 个 `\xff` 的字符串，用于检查`encoder`是否有重复的字符串

### EncodeToString

```go
func (enc *Encoding) EncodeToString(src []byte) string {
	buf := make([]byte, enc.EncodedLen(len(src)))
	enc.Encode(buf, src)
	return string(buf)
}
```

帮你分配好内存+编码后返回字符串
缺点：底层每次都会 make 申请一块新的内存来存放生成的字符串，如果高并发且数据量大，会给 GC（垃圾回收）带来压力。

### DecodeString

```go
func (enc *Encoding) DecodeString(s string) ([]byte, error) {
	dbuf := make([]byte, enc.DecodedLen(len(s)))
	n, err := enc.Decode(dbuf, []byte(s))
	return dbuf[:n], err
}
```

同样是自动分配好结果切片的内存，解码后返回

### Encode/Decode

绝对不帮分配内存，一切控制权和责任都交给调用者

### AppendEncode/AppendDecode

```go
func (enc *Encoding) AppendEncode(dst, src []byte) []byte {
	n := enc.EncodedLen(len(src))
	dst = slices.Grow(dst, n)
	enc.Encode(dst[len(dst):][:n], src)
	return dst[:len(dst)+n]
}

func (enc *Encoding) AppendDecode(dst, src []byte) ([]byte, error) {
	// Compute the output size without padding to avoid over allocating.
	n := len(src)
	for n > 0 && rune(src[n-1]) == enc.padChar {
		n--
	}
	n = decodedLen(n, NoPadding)

	dst = slices.Grow(dst, n)
	n, err := enc.Decode(dst[len(dst):][:n], src)
	return dst[:len(dst)+n], err
}
```

作用：把编码/解码后的结果追加到 dst 后面，同样自带动态扩容和安全保障

## NewEncoder

```go
type encoder struct {
	err  error
	enc  *Encoding
	w    io.Writer
	buf  [3]byte    // buffered data waiting to be encoded
	nbuf int        // number of bytes in buf
	out  [1024]byte // output buffer
}

func NewEncoder(enc *Encoding, w io.Writer) io.WriteCloser {
    return &encoder{enc: enc, w: w}
}
```

1. `encoder` 就是为了解决 “海量数据无法一次性装入内存” 的问题而诞生的
2. `buf` 是被转移后数据的暂存区（必须凑够3字节），而`nbuf`是索引指针
3. `out` 是输出暂存区
4. `w` 只能是io.Write，这是因为如果要关闭只能关闭编码器自己的业务逻辑，而不是关闭下游的物理管道

```go
func (e *encoder) Write(p []byte) (n int, err error) {
	if e.err != nil {
		return 0, e.err
	}

	// Leading fringe.
	if e.nbuf > 0 {
		var i int
		for i = 0; i < len(p) && e.nbuf < 3; i++ {
			e.buf[e.nbuf] = p[i]
			e.nbuf++
		}
		n += i
		p = p[i:]
		if e.nbuf < 3 {
			return
		}
		e.enc.Encode(e.out[:], e.buf[:])
		if _, e.err = e.w.Write(e.out[:4]); e.err != nil {
			return n, e.err
		}
		e.nbuf = 0
	}

	// Large interior chunks.
	for len(p) >= 3 {
		nn := len(e.out) / 4 * 3
		if nn > len(p) {
			nn = len(p)
			nn -= nn % 3
		}
		e.enc.Encode(e.out[:], p[:nn])
		if _, e.err = e.w.Write(e.out[0 : nn/3*4]); e.err != nil {
			return n, e.err
		}
		n += nn
		p = p[nn:]
	}

	// Trailing fringe.
	copy(e.buf[:], p)
	e.nbuf = len(p)
	n += len(p)
	return
}

// Close flushes any pending output from the encoder.
// It is an error to call Write after calling Close.
func (e *encoder) Close() error {
    // If there's anything left in the buffer, flush it out
    if e.err == nil && e.nbuf > 0 {
        e.enc.Encode(e.out[:], e.buf[:e.nbuf])
        _, e.err = e.w.Write(e.out[:e.enc.EncodedLen(e.nbuf)])
        e.nbuf = 0
    }
    return e.err
}
```

1. `out` 只是一个极小的临时复用空间。直接调用 `w.Write`，就是为了在下一轮循环覆盖它之前，把里面的数据“排泄”到真正的目的地，防止数据丢失
2. `Close` 会把缓冲中的数据进行输出

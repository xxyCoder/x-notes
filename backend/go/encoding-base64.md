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

1. `encode` 充当 索引到字符 的查询表，因为base64是6 bit一组，正好范围是0~63（2^6）
2. `decodeMap` 充当 字符到索引 的查询表，因为一个ascii字符占1 bit，范围是0~255（2^8）
3. `strict` 表示是否严格模式，如果是严格模式则解码器会严格检查这些未对齐的填充位是否真的为 0，如果不是，则直接抛出 `CorruptInputError` 错误（在解码时，如果数据长度不是 3 的倍数，我们在编码时会填充多余的零）

## NewEncoding

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

## Encode

```go
func (enc *Encoding) Encode(dst, src []byte) {
	if len(src) == 0 {
		return
	}
	// enc is a pointer receiver, so the use of enc.encode within the hot
	// loop below means a nil check at every operation. Lift that nil check
	// outside of the loop to speed up the encoder.
	_ = enc.encode

	di, si := 0, 0
	n := (len(src) / 3) * 3
	for si < n {
		// Convert 3x 8bit source bytes into 4 bytes
		val := uint(src[si+0])<<16 | uint(src[si+1])<<8 | uint(src[si+2])

		dst[di+0] = enc.encode[val>>18&0x3F]
		dst[di+1] = enc.encode[val>>12&0x3F]
		dst[di+2] = enc.encode[val>>6&0x3F]
		dst[di+3] = enc.encode[val&0x3F]

		si += 3
		di += 4
	}

	remain := len(src) - si
	if remain == 0 {
		return
	}
	// Add the remaining small block
	val := uint(src[si+0]) << 16
	if remain == 2 {
		val |= uint(src[si+1]) << 8
	}

	dst[di+0] = enc.encode[val>>18&0x3F]
	dst[di+1] = enc.encode[val>>12&0x3F]

	switch remain {
	case 2:
		dst[di+2] = enc.encode[val>>6&0x3F]
		if enc.padChar != NoPadding {
			dst[di+3] = byte(enc.padChar)
		}
	case 1:
		if enc.padChar != NoPadding {
			dst[di+2] = byte(enc.padChar)
			dst[di+3] = byte(enc.padChar)
		}
	}
}
```

1. LCM(6, 8) = 24, 24 / 6 = 4, 24 / 8 = 3
2. 主要流程都是把3个byte转为4个base64组成的字符，多出的字符再进行转换，最后判断是否需要填充

## EncodeToString
```go
func (enc *Encoding) EncodeToString(src []byte) string {
	buf := make([]byte, enc.EncodedLen(len(src)))
	enc.Encode(buf, src)
	return string(buf)
}
```

## AppendEncode

```go
func (enc *Encoding) AppendEncode(dst, src []byte) []byte {
	n := enc.EncodedLen(len(src))
	dst = slices.Grow(dst, n)
	enc.Encode(dst[len(dst):][:n], src)
	return dst[:len(dst)+n]
}
```

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

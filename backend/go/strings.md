## Builder

```go
type Builder struct {
	addr *Builder // of receiver, to detect copies by value
	buf []byte
}

func (b *Builder) copyCheck() {
	if b.addr == nil {
		// just "b.addr = b".
		b.addr = (*Builder)(abi.NoEscape(unsafe.Pointer(b)))
	} else if b.addr != b {
		panic("strings: illegal use of non-zero Builder copied by value")
	}
}
```

addr用来检测是否执行过 `b2 := b1`操作

### 长度和容量

```go
func (b *Builder) Len() int { return len(b.buf) }

func (b *Builder) Cap() int { return cap(b.buf) }
```

返回的内部buf的长度和容量

### 扩容

```go
func (b *Builder) grow(n int) {
	buf := bytealg.MakeNoZero(2*cap(b.buf) + n)[:len(b.buf)]
	copy(buf, b.buf)
	b.buf = buf
}

func (b *Builder) Grow(n int) {
	b.copyCheck()
	if n < 0 {
		panic("strings.Builder.Grow: negative count")
	}
	if cap(b.buf)-len(b.buf) < n {
		b.grow(n)
	}
}
```

扩容输入的n必须大于0，并且只有当容量 减去 长度不足n才会进行扩容，扩容方案为2倍的buf容量加上n的值，长度指定为 `len(buf)`

### 重置

```go
func (b *Builder) Reset() {
	b.addr = nil
	b.buf = nil
}
```

### 写数据

```go
func (b *Builder) Write(p []byte) (int, error) {
	b.copyCheck()
	b.buf = append(b.buf, p...)
	return len(p), nil
}
```

实际写入的是buf中，如果调用了 `Reset`再进行 `Write`也没有事，`append`会将nil当作一个长度为 0 的空切片来处理

## Reader

```go
type Reader struct {
	s        string
	i        int64 // current reading index
	prevRune int   // index of previous rune; or < 0
}

func NewReader(s string) *Reader { return &Reader{s, 0, -1} }
```

### Len和Size

```go
func (r *Reader) Len() int {
	if r.i >= int64(len(r.s)) {
		return 0
	}
	return int(int64(len(r.s)) - r.i)
}

func (r *Reader) Size() int64 { return int64(len(r.s)) }
```

`len`返回的是字符串剩余未被读取的长度，`size`返回的是字符串长度

### 重置

```go
func (r *Reader) Reset(s string) { *r = Reader{s, 0, -1} }
```

就是重新赋值了

### 读数据

```go
func (r *Reader) Read(b []byte) (n int, err error) {
	if r.i >= int64(len(r.s)) {
		return 0, io.EOF
	}
	r.prevRune = -1
	n = copy(b, r.s[r.i:])
	r.i += int64(n)
	return
}

func (r *Reader) WriteTo(w io.Writer) (n int64, err error) {
	r.prevRune = -1
	if r.i >= int64(len(r.s)) {
		return 0, nil
	}
	s := r.s[r.i:]
	m, err := io.WriteString(w, s)
	if m > len(s) {
		panic("strings.Reader.WriteTo: invalid WriteString count")
	}
	r.i += int64(m)
	n = int64(m)
	if m != len(s) && err == nil {
		err = io.ErrShortWrite
	}
	return
}
```

`i`表示当前已经读到的索引位置，故使用copy+切片将数据存储在传递进来的 `b`字段中

也可以传递 `io.Writer`进行读取数据

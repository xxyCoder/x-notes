## Reader

```go
type Reader interface {
	Read(p []byte) (n int, err error)
}
```

`Reader`是封装了 `Read`的基本接口，将数据读到 `p中`，要求最多读取  `len(p)`个字节

1. 当读取到的字节数量大于0或者遇到了EOF，会返回已经读取到的字节数
2. 如果缓冲区没满但有数据，就应该立即返回，不要为了填满 `p` 而阻塞等待
3. 实现不建议返回 n = 0的时候，错误为nil，除非 `len(p)`为0
4. 绝对不允许对p保留引用

## Writer

```go
type Writer interface {
	Write(p []byte) (n int, err error)
}
```

`Writer`是封装了 `Write`的接口，将 `p`中的数据拿走，要求最多拿走 `len(p)`个字节

1. 返回成功拿走的字节数
2. 绝对不允许对p保留引用，也不允许永久或是临时修改p中的数据

## Seeker

```go
type Seeker interface {
	Seek(offset int64, whence int) (int64, error)
}
```

1. Seek 设置下一次 **Read** 或 **Write** 操作的偏移量（offset），偏移量的解释取决于 **whence** 参数
   * **[SeekStart]** ：表示相对于文件的 **起始位置**
   * **[SeekCurrent]** ：表示相对于 **当前偏移位置**
   * **[SeekEnd]** ：表示相对于文件的 **末尾** （例如，`offset = -2` 表示指向文件的倒数第二个字节）
2. 跳转到文件起始位置之前的偏移量是错误的，跳转到任何正偏移量可能是允许的，但如果新的偏移量超过了底层对象的大小，则后续 I/O 操作的行为将取决于具体的实现

## LimiterReader

```go
type LimitedReader struct {
	R Reader // underlying reader
	N int64  // max bytes remaining
}

func (l *LimitedReader) Read(p []byte) (n int, err error) {
	if l.N <= 0 {
		return 0, EOF
	}
	if int64(len(p)) > l.N {
		p = p[0:l.N]
	}
	n, err = l.R.Read(p)
	l.N -= int64(n)
	return
}
```

1. 从底层 Reader **R** 中读取数据，但将返回的数据总量限制在 **N** 个字节以内
2. 每次调用 **Read** 方法都会更新  **N** ，以反映剩余可读的字节数。当 **N <= 0** 或者底层的 **R** 返回 **EOF** 时，**Read** 将返回 **EOF**

## 装饰器

1. 限制读

```go
func LimitReader(r Reader, n int64) Reader { return &LimitedReader{r, n} }
```

2. 双通接口

```
func TeeReader(r Reader, w Writer) Reader {
	return &teeReader{r, w}
}

type teeReader struct {
	r Reader
	w Writer
}

func (t *teeReader) Read(p []byte) (n int, err error) {
	n, err = t.r.Read(p)
	if n > 0 {
		if n, err := t.w.Write(p[:n]); err != nil {
			return n, err
		}
	}
	return
}
```

3. 多次读

```go
func MultiReader(readers ...Reader) Reader {
	r := make([]Reader, len(readers))
	copy(r, readers)
	return &multiReader{r}
}

func (mr *multiReader) Read(p []byte) (n int, err error) {
	for len(mr.readers) > 0 {
		// Optimization to flatten nested multiReaders (Issue 13558).
		if len(mr.readers) == 1 {
			if r, ok := mr.readers[0].(*multiReader); ok {
				mr.readers = r.readers
				continue
			}
		}
		n, err = mr.readers[0].Read(p)
		if err == EOF {
			// Use eofReader instead of nil to avoid nil panic
			// after performing flatten (Issue 18232).
			mr.readers[0] = eofReader{} // permit earlier GC
			mr.readers = mr.readers[1:]
		}
		if n > 0 || err != EOF {
			if err == EOF && len(mr.readers) > 0 {
				// Don't return EOF yet. More readers remain.
				err = nil
			}
			return
		}
	}
	return 0, EOF
}
```

将多个reader读到 `p`中直到 `p`缓存区满

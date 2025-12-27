- 操作[]byte类型方法

## Clone

```go
func Clone(b []byte) []byte {
	if b == nil {
		return nil
	}
	return append([]byte{}, b...)
}
```

不能直接通过 `[:len(b)]bytes`返回，切片类型为以下结构，通过 `[:len(b)]bytes`返回的结构，array指向同一个位置

```go
// src/runtime/slice.go
type slice struct {
	array unsafe.Pointer
	len   int
	cap   int
}
```

## 查找

```go
// Contains
func Contains(b, subslice []byte) bool {
	return Index(b, subslice) != -1
}

// ContainsAny
func ContainsAny(b []byte, chars string) bool {
	return IndexAny(b, chars) >= 0
}
```

1. Index必须匹配完整的substr
2. IndexAny只需要匹配char中任意一个字符即可

## Cut

```go
func Cut(s, sep []byte) (before, after []byte, found bool) {
	if i := Index(s, sep); i >= 0 {
		return s[:i], s[i+len(sep):], true
	}
	return s, nil, false
}

func CutPrefix(s, prefix []byte) (after []byte, found bool) {
	if !HasPrefix(s, prefix) {
		return s, false
	}
	return s[len(prefix):], true
}

func CutSuffix(s, suffix []byte) (before []byte, found bool) {
	if !HasSuffix(s, suffix) {
		return s, false
	}
	return s[:len(s)-len(suffix)], true
}

func HasPrefix(s, prefix []byte) bool {
	return len(s) >= len(prefix) && Equal(s[:len(prefix)], prefix)
}

func HasSuffix(s, suffix []byte) bool {
	return len(s) >= len(suffix) && Equal(s[len(s)-len(suffix):], suffix)
}

func Equal(a, b []byte) bool {
	// Neither cmd/compile nor gccgo allocates for these string conversions.
	return string(a) == string(b)
}
```

## 计数

```go
func Count(s, sep []byte) int {
	// special case
	if len(sep) == 0 {
		return utf8.RuneCount(s) + 1
	}
	if len(sep) == 1 {
		return bytealg.Count(s, sep[0])
	}
	n := 0
	for {
		i := Index(s, sep)
		if i == -1 {
			return n
		}
		n++
		s = s[i+len(sep):]
	}
}
```

每次找到后都需要切除找到的部分，然后再次进行匹配查找

## Join

```go
func Join(s [][]byte, sep []byte) []byte {
	if len(s) == 0 {
		return []byte{}
	}
	if len(s) == 1 {
		// Just return a copy.
		return append([]byte(nil), s[0]...)
	}

	var n int
	if len(sep) > 0 {
		if len(sep) >= maxInt/(len(s)-1) {
			panic("bytes: Join output length overflow")
		}
		n += len(sep) * (len(s) - 1)
	}
	for _, v := range s {
		if len(v) > maxInt-n {
			panic("bytes: Join output length overflow")
		}
		n += len(v)
	}

	b := bytealg.MakeNoZero(n)[:n:n]
	bp := copy(b, s[0])
	for _, v := range s[1:] {
		bp += copy(b[bp:], sep)
		bp += copy(b[bp:], v)
	}
	return b
}
```

1. 对于长度为0或1直接返回copy
2. 预算长度，只需要执行一次内存分配
3. **`bytealg.MakeNoZero(n)`** ：这是一个内部优化函数。普通的 `make([]byte, n)` 会在分配后将内存清零（memset 0），而 `MakeNoZero` 只是申请内存但不清零。因为后面我们会立刻覆盖这些字节，跳过清零步骤可以显著提升性能

## Repeat

```go
func Repeat(b []byte, count int) []byte {
	if count == 0 {
		return []byte{}
	}

	// Since we cannot return an error on overflow,
	// we should panic if the repeat will generate an overflow.
	// See golang.org/issue/16237.
	if count < 0 {
		panic("bytes: negative Repeat count")
	}
	hi, lo := bits.Mul(uint(len(b)), uint(count))
	if hi > 0 || lo > uint(maxInt) {
		panic("bytes: Repeat output length overflow")
	}
	n := int(lo) // lo = len(b) * count

	if len(b) == 0 {
		return []byte{}
	}

	const chunkLimit = 8 * 1024
	chunkMax := n
	if chunkMax > chunkLimit {
		chunkMax = chunkLimit / len(b) * len(b)
		if chunkMax == 0 {
			chunkMax = len(b)
		}
	}
	nb := bytealg.MakeNoZero(n)[:n:n]
	bp := copy(nb, b)
	for bp < n {
		chunk := min(bp, chunkMax)
		bp += copy(nb[bp:], nb[:chunk])
	}
	return nb
}
```

## 分割与裁剪

```go
func Split(s, sep []byte) [][]byte { return genSplit(s, sep, 0, -1) }

func SplitAfter(s, sep []byte) [][]byte {
	return genSplit(s, sep, len(sep), -1)
}

func genSplit(s, sep []byte, sepSave, n int) [][]byte {
	if n == 0 {
		return nil
	}
	if len(sep) == 0 {
		return explode(s, n)
	}
	if n < 0 {
		n = Count(s, sep) + 1
	}
	if n > len(s)+1 {
		n = len(s) + 1
	}

	a := make([][]byte, n)
	n--
	i := 0
	for i < n {
		m := Index(s, sep)
		if m < 0 {
			break
		}
		a[i] = s[: m+sepSave : m+sepSave]
		s = s[m+len(sep):]
		i++
	}
	a[i] = s
	return a[:i+1]
}
```

分割的数量为Count(s, sep) + 1，通过Index辅助进行分割

其中sepSave表示额外要保留的长度，`SplitAfter`为分隔符长度（即保留分隔符）

`s[low:high:max]` 被称为扩展切片表达式，可以让容量和长度一致，后续对 `a[i]`调用 `append`方法则可以不覆盖原数据 `s`

- **起始指针** ：指向原切片索引为 `low` 的元素
- **长度 (**$Length$**)** ：**$high - low$**
- **容量 (**$Capacity$**)** ：**$max - low$**

```go
func Trim(s []byte, cutset string) []byte {
	if len(s) == 0 {
		// This is what we've historically done.
		return nil
	}
	if cutset == "" {
		return s
	}
	if len(cutset) == 1 && cutset[0] < utf8.RuneSelf {
		return trimLeftByte(trimRightByte(s, cutset[0]), cutset[0])
	}
	if as, ok := makeASCIISet(cutset); ok {
		return trimLeftASCII(trimRightASCII(s, &as), &as)
	}
	return trimLeftUnicode(trimRightUnicode(s, cutset), cutset)
}
```

去除左右相关的字符串

## 替换

```go
func Replace(s, old, new []byte, n int) []byte {
	m := 0
	if n != 0 {
		// Compute number of replacements.
		m = Count(s, old)
	}
	if m == 0 {
		// Just return a copy.
		return append([]byte(nil), s...)
	}
	if n < 0 || m < n {
		n = m
	}

	// Apply replacements to buffer.
	t := make([]byte, len(s)+n*(len(new)-len(old)))
	w := 0
	start := 0
	if len(old) > 0 {
		for range n {
			j := start + Index(s[start:], old)
			w += copy(t[w:], s[start:j])
			w += copy(t[w:], new)
			start = j + len(old)
		}
	} else { // len(old) == 0
		w += copy(t[w:], new)
		for range n - 1 {
			_, wid := utf8.DecodeRune(s[start:])
			j := start + wid
			w += copy(t[w:], s[start:j])
			w += copy(t[w:], new)
			start = j
		}
	}
	w += copy(t[w:], s[start:])
	return t[0:w]
}

func ReplaceAll(s, old, new []byte) []byte {
	return Replace(s, old, new, -1)
}
```

n与Count返回的数量中取最大值

通过make + 一次分配好内存后，通过Index找到被替换项进行替换

## 数据结构

```go
// src/runtime/slice.go
type slice struct {
	array unsafe.Pointer // 指向底层数组的指针
	len   int
	cap   int
}
```

赋值、切片语句其实就是结构体进行复制，也就说会导致底层数组共享

### 隐藏bug

1. 如果你在切分一个非常大的数组，而只需要其中很小一部分，原来的大数组会一直驻留在内存中无法被 GC（垃圾回收），因为小切片持有大数组的引用，推荐使用`copy`方法
2. 切片共享，修改一个会影响另一个
3. 必须 `s = append(s, val)` 也就是需要用变量接收返回值，因为go是值传递，`append`修改结构体不会影响旧结构体的`len`字段

## append

```go
func nextslicecap(newLen, oldCap int) int {
	newcap := oldCap
	doublecap := newcap + newcap
	if newLen > doublecap {
		return newLen
	}

	const threshold = 256
	if oldCap < threshold {
		return doublecap
	}
	for {
		// Transition from growing 2x for small slices
		// to growing 1.25x for large slices. This formula
		// gives a smooth-ish transition between the two.
		newcap += (newcap + 3*threshold) >> 2

		// We need to check `newcap >= newLen` and whether `newcap` overflowed.
		// newLen is guaranteed to be larger than zero, hence
		// when newcap overflows then `uint(newcap) > uint(newLen)`.
		// This allows to check for both with the same comparison.
		if uint(newcap) >= uint(newLen) {
			break
		}
	}

	// Set newcap to the requested cap when
	// the newcap calculation overflowed.
	if newcap <= 0 {
		return newLen
	}
	return newcap
}
```

1. 先考虑双倍旧容量，如果比新长度要小则使用新长度
2. 否则判断阈值（256），当旧容量小于阈值才可以使用翻倍值作为新容量
3. 大于等于阈值则新容量以三倍阈值作为增长量进行累加直到超过新长度

## Clone

```go
func Clone[S ~[]E, E any](s S) S {
	// Preserve nilness in case it matters.
	if s == nil {
		return nil
	}
	// Avoid s[:0:0] as it leads to unwanted liveness when cloning a
	// zero-length slice of a large array; see https://go.dev/issue/68488.
	return append(S{}, s...) // S 就相当于 []int、[]string ...
}

```

## 迭代器

```go
type Seq[V any] func(yield func(V) bool)

type Seq2[K, V any] func(yield func(K, V) bool)

func AppendSeq[Slice ~[]E, E any](s Slice, seq iter.Seq[E]) Slice {
	for v := range seq {
		s = append(s, v)
	}
	return s
}

// Collect collects values from seq into a new slice and returns it.
// If seq is empty, the result is nil.
func Collect[E any](seq iter.Seq[E]) []E {
	return AppendSeq([]E(nil), seq)
}
```

1. 迭代器本身就是一个函数
2. range 支持遍历函数（迭代器）

## Concat

```go
func Concat[S ~[]E, E any](slices ...S) S {
	size := 0
	for _, s := range slices {
		size += len(s)
		if size < 0 {
			panic("len out of range")
		}
	}
	// Use Grow, not make, to round up to the size class:
	// the extra space is otherwise unused and helps
	// callers that append a few elements to the result.
	newslice := Grow[S](nil, size)
	for _, s := range slices {
		newslice = append(newslice, s...)
	}
	return newslice
}
```

## Grow

```go
func Grow[S ~[]E, E any](s S, n int) S {
	if n < 0 {
		panic("cannot be negative")
	}
	if n -= cap(s) - len(s); n > 0 {
		// This expression allocates only once (see test).
		s = append(s[:cap(s)], make([]E, n)...)[:len(s)]
	}
	return s
}
```

增加切片的容量：
1. 如果n的长度小于剩余可用量则不进行扩展
2. 否则额外扩展n个容量

## Reverse

```go
func Reverse[S ~[]E, E any](s S) {
	for i, j := 0, len(s)-1; i < j; i, j = i+1, j-1 {
		s[i], s[j] = s[j], s[i]
	}
}
```

1. 利用 x, y = y, x方式，进行头尾交换实现reverse****
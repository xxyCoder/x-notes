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
## Source

```go
type Source interface {
    Uint64() uint64
}
```

它定义了一个极其简单的契约：任何想要成为“随机源”的类型，都必须提供一个 Uint64() 方法。每次调用这个方法，它都必须返回一个均匀分布的 64 位无符号整数（取值范围是 [0, 1<<64-1]）

## Rand

```go
type Rand struct {
	src Source
}

func New(src Source) *Rand {
    return &Rand{src: src}
}
```

Rand 结构体自己其实并不会算随机数。它的工作原理是：内部包含一台发动机（src）。当上层代码需要随机数时，它就驱动内部的 src 去干活。

### 随机数方法

```go
// Int64 returns a non-negative pseudo-random 63-bit integer as an int64.
func (r *Rand) Int64() int64 { return int64(r.src.Uint64() &^ (1 << 63)) }

// Uint32 returns a pseudo-random 32-bit value as a uint32.
func (r *Rand) Uint32() uint32 { return uint32(r.src.Uint64() >> 32) }

func (r *Rand) Uint64() uint64 { return r.src.Uint64() }
```

当你需要普通的整数时，Rand 绝不去做复杂的数学运算，而是直接在二进制层面“切分”比特。

### Lemire 区间映射算法

```go
func (r *Rand) Int64N(n int64) int64 {
	if n <= 0 {
		panic("invalid argument to Int64N")
	}
	return int64(r.uint64n(uint64(n)))
}

func (r *Rand) uint64n(n uint64) uint64 {
    if is32bit && uint64(uint32(n)) == n {
        return uint64(r.uint32n(uint32(n)))
    }
    if n&(n-1) == 0 { // n is power of two, can mask
        return r.Uint64() & (n - 1)
    }

    hi, lo := bits.Mul64(r.Uint64(), n)
    if lo < n {
        thresh := -n % n
        for lo < thresh {
            hi, lo = bits.Mul64(r.Uint64(), n)
        }
    }
    return hi
}
```

#### 核心痛点

在过去，求 $[0, n)$ 范围随机数的标准做法是取模：r.Uint64() % n。但这在工程实践中存在两大硬伤：
1. 性能极差：CPU 执行除法/取模指令（DIV）的周期极长，通常是乘法指令（MUL）的 10 倍以上。在需要高频生成随机数的场景中，这是巨大的性能瓶颈。
2. 取模偏差（Modulo Bias）：如果 $2^{64}$ 不能被 $n$ 整除，那么多出来的“零头”会导致较小的数字出现概率略高，随机数分布不再绝对均匀。

#### 核心原理

Lemire 算法彻底抛弃了除法映射，转而利用**比例缩放（乘法）**的思想。
1. 按比例映射：将底层的 64 位纯随机数 $x$ 看作是一个在 $[0, 1)$ 区间的进度百分比，即 $\frac{x}{2^{64}}$。我们要把它映射到 $n$ 的范围内，只需计算：$n \times \frac{x}{2^{64}}$。
2. 128 位乘法的妙用：在计算机底层，两个 64 位整数 $x$ 和 $n$ 相乘，会得到一个 128 位的结果，由高 64 位 hi 和低 64 位 lo 组成。数学公式可表示为：$$x \times n = hi \times 2^{64} + lo$$等式两边同除以 $2^{64}$：$$\frac{x \times n}{2^{64}} = hi + \frac{lo}{2^{64}}$$
3. 结论：等号右边的 hi 是一个完整的整数，而 $\frac{lo}{2^{64}}$ 永远是一个小于 1 的小数。因此，乘积的高 64 位 hi，正是我们完美映射到 $[0, n)$ 范围的目标随机数！

#### 拒绝偏差

假设底层随机源生成的总状态数为 $N$（在 64 位系统中 $N = 2^{64}$），我们需要生成目标范围为 $[0, n)$ 的随机数。

根据带余除法，总状态数可以表示为：

$$N = q \cdot n + r$$ 

- $q$ (商)：表示 $[0, n)$ 中每个数字保底能分到底层状态的数量。
- $r$ (余数)：即多出来的“零头状态” ($0 \le r < n$)。

如果直接强行映射（例如传统的取模运算 $x \pmod n$），这 $r$ 个零头状态会被分配给前面的 $r$ 个数字。这就导致：

- 前 $r$ 个数字出现的概率为 $\frac{q+1}{N}$
- 剩下的数字出现的概率为 $\frac{q}{N}$

在严苛的统计学或算法中，这种结构性的概率倾斜是不可接受的。拒绝采样的解决方案：既然多出了 $r$ 个会导致不公平的“零头状态”，我们就直接剔除这 $r$ 个状态。

当底层生成的随机数恰好落入这 $r$ 个状态代表的“不公平区间”时，程序直接丢弃它并重新生成，直到生成的数字落入公平区间。剔除后，有效状态总数变成了 $N - r = q \cdot n$。此时每一个目标数字出现的概率都完美地变成了：$$\frac{q}{q \cdot n} = \frac{1}{n}$$从而实现了绝对的数学公平。

#### 极速通道

计算 thresh 需要用到取模运算（本质是 CPU 的除法指令）。除法指令极慢，如果每次生成随机数都要算一次除法，Lemire 算法“用乘法替代除法”的性能优势将荡然无存。

1. 根据数学常识，余数必定严格小于除数。因此，精确阈值 thresh 必然满足：$$thresh < n$$
2. 既然如此，如果当前算出的 lo >= n，那么就可以 100% 确定：$$lo > thresh$$
3. 只要 $lo > thresh$，就说明当前结果绝对没有落入需要拒绝的零头区间，可以直接安全返回 hi。
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

## PCG

```go
type PCG struct {
	hi uint64
	lo uint64
}

// NewPCG returns a new PCG seeded with the given values.
func NewPCG(seed1, seed2 uint64) *PCG {
	return &PCG{seed1, seed2}
}

// Seed resets the PCG to behave the same way as NewPCG(seed1, seed2).
func (p *PCG) Seed(seed1, seed2 uint64) {
	p.hi = seed1
	p.lo = seed2
}
```

第一步：状态流转（内部引擎）它的内部依然是一个最简单的 LCG。

在 Go 的 rand.NewPCG(seed1, seed2) 中，底层只维护了两个 64 位的状态变量。

每次生成随机数时，它的内部状态 $S$ 会按照极其简单的数学公式更新：

$$S_{n+1} = (S_n \times \text{multiplier} + \text{increment}) \pmod{2^{64}}$$

这个公式保证了状态能够在 $2^{64}$ 的空间里完美循环一遍，绝不重复。但这时的 $S_{n+1}$ 是带有明显规律的。

第二步：输出排列（魔法打乱）这是 PCG 的灵魂所在。

它绝不直接输出内部状态 $S_{n+1}$，而是把它丢进一个“排列器”（Permutation）中进行位运算。

典型的 PCG 排列操作（如 PCG-XSH-RR）会这样做：取高位：利用内部状态的高位（随机性最好的一部分），来决定一个“旋转位数”（Rotation amount）。

异或与位移：把内部状态自己和自己进行位移并做异或运算（XOR），混合比特位。

动态旋转：根据第 1 步算出的旋转位数，把第 2 步的结果进行循环移位。

结果：经过这一通位运算的蹂躏，原本线性、有规律的内部状态，被彻底炸成了一团毫无规律的比特流，也就是最终返回给 Rand 加工厂的那 64 位 Uint64() 原石。

### Uint64

```go
func (p *PCG) next() (hi, lo uint64) {
	const (
		mulHi = 2549297995355413924
		mulLo = 4865540595714422341
		incHi = 6364136223846793005
		incLo = 1442695040888963407
	)

	// state = state * mul + inc
	hi, lo = bits.Mul64(p.lo, mulLo)
	hi += p.hi*mulLo + p.lo*mulHi
	lo, c := bits.Add64(lo, incLo, 0)
	hi, _ = bits.Add64(hi, incHi, c)
	p.lo = lo
	p.hi = hi
	return hi, lo
}

// Uint64 return a uniformly-distributed random uint64 value.
func (p *PCG) Uint64() uint64 {
	hi, lo := p.next()
	
	const cheapMul = 0xda942042e4dd58b5
	hi ^= hi >> 32
	hi *= cheapMul
	hi ^= hi >> 48
	hi *= (lo | 1)
	return hi
}

```

### ChaCha8

```go
type ChaCha8 struct {
	state chacha8rand.State

	// The last readLen bytes of readBuf are still to be consumed by Read.
	readBuf [8]byte
	readLen int // 0 <= readLen <= 8
}

type State struct {
    buf  [32]uint64
    seed [4]uint64
    i    uint32
    n    uint32
    c    uint32
}

// NewChaCha8 returns a new ChaCha8 seeded with the given seed.
func NewChaCha8(seed [32]byte) *ChaCha8 {
	c := new(ChaCha8)
	c.state.Init(seed)
	return c
}
```

为了解决 预测性问题

1. PCG 的软肋：PCG 内部状态很小（只有两个 64 位整数）。如果在一个对外的网络服务中（比如某种带有随机机制的游戏或抽奖），攻击者连续收集了你生成的十几个随机数，他们就可以通过数学反推，逆向算出你 PCG 的内部种子（Seed）。一旦种子暴露，你未来要生成的所有随机数，对攻击者来说就是全透明的。
2. ChaCha8 的强项：ChaCha8 的内部状态极大，它的种子是一个完整的 [32]byte（256 位，相当于 4 个 uint64）。再加上其底层源自密码学的单向扰乱特性，即使攻击者拿到了成千上万个生成的随机数，也几乎不可能反推出它的内部状态

#### 工作原理


```go
func (c *ChaCha8) Uint64() uint64 {
	for {
		x, ok := c.state.Next()
		if ok {
			return x
		}
		c.state.Refill()
	}
}
```

1. ChaCha8 内部不维护简单的数字，而是维护一个 $4 \times 4$ 的矩阵（包含 16 个 32 位的数字，总计 64 字节）。这个矩阵里装填了：固定的魔法常量（"expand 32-byte k"）你传入的 256 位种子（Key）一个不断递增的计数器（Counter）
2. 当需要生成随机数时，它会对这个矩阵进行 8 轮剧烈的数学搅拌。搅拌只使用三种最基础、最快速的 CPU 指令，简称 ARX（ADD、Rotate、XOR）
3. 这一块 64 字节的数据，刚好可以切割成 8 个 64 位的 uint64 原石。
   所以，当你调用 ChaCha8.Uint64() 时： 
   - 如果缓存里还有货，它直接从这 8 个数字里拿一个给你（极快，纯内存读取）。 
   - 当 8 个数字全用光了，它就把内部计数器 +1，再执行一次 8 轮矩阵搅拌，重新批发 8 个数字存起来。

## globalRand

```go
var globalRand = &Rand{src: runtimeSource{}}

//go:linkname runtime_rand runtime.rand
func runtime_rand() uint64

// runtimeSource is a Source that uses the runtime fastrand functions.
type runtimeSource struct{}

func (runtimeSource) Uint64() uint64 {
	return runtime_rand()
}

func rand() uint64 {
    // Note: We avoid acquirem here so that in the fast path
    // there is just a getg, an inlined c.Next, and a return.
    // The performance difference on a 16-core AMD is
    // 3.7ns/call this way versus 4.3ns/call with acquirem (+16%).
    mp := getg().m
    c := &mp.chacha8
    for {
        // Note: c.Next is marked nosplit,
        // so we don't need to use mp.locks
        // on the fast path, which is that the
        // first attempt succeeds.
        x, ok := c.Next()
        if ok {
            return x
        }
        mp.locks++ // hold m even though c.Refill may do stack split checks
        c.Refill()
        mp.locks--
    }
}

var globalRand struct {
    lock  mutex
    seed  [32]byte
    state chacha8rand.State
    init  bool
}
```

Go 语言的系统运行时（Runtime）内部，直接内置了一个极高强度的 ChaCha8 随机数发生器。

Go 运行时（Runtime）不再大厅里放一个全局状态本，而是给每一个物理线程（M）的口袋里，单独塞一个私有的 ChaCha8 状态本。（将状态绑定在底层的 M 上，正是为了彻底规避多个 Goroutine（G）同时争用同一个 ChaCha8 引擎。）

### seed是怎么生成的

1. 当 Go 程序刚刚启动时，运行时（Runtime）会执行一个名为 randinit() 的底层初始化函数。它的第一件事就是向操作系统索要最高级别的安全随机数
2. 由于向操作系统要随机数需要进行系统调用（Syscall），速度非常慢。如果 Go 每创建一个协程或线程都去求操作系统，性能早就崩盘了。
3. 在 randinit() 函数中，Go 会把第一步从操作系统拿到的那批物理随机数，小心翼翼地灌进这个 `globalRand`.seed 里面
4. Go 的调度器开始发力。每当 Go 需要在 CPU 上启动一个新的物理线程（Machine，即 M）来干活时，它就会调用 mrandinit(mp *m) 为这个新兵分配装备。
```go
// mrandinit 初始化一个 M 的随机数状态
func mrandinit(mp *m) {
    var seed [4]uint64 // 准备一个 32 字节 (4 x 64bit) 的空壳作为专属种子
    
    for i := range seed {
        // 向全局的母体发生器 (globalRand) 申请生成全新的随机数！
        seed[i] = bootstrapRand() 
    }
    
    bootstrapRandReseed() // 擦除刚才用过的母体内部临时数据，防止被黑客窥探
    
    // 把这 32 字节的专属种子，喂给当前线程口袋里的私有 chacha8 引擎！
    mp.chacha8.Init64(seed) 
}
```
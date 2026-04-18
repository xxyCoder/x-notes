# rand/v2

Go 1.22 引入，替代 `math/rand`。核心变化：全局函数自动种子、算法升级、命名规范化。

---

## 架构

```
Source（接口）          只需实现 Uint64() uint64
  ├── *PCG             快速、高质量，适合通用场景
  └── *ChaCha8         密码学强度，适合安全敏感场景

Rand（结构体）          包装 Source，提供全部高层方法
```

所有高层方法（`IntN`、`Float64`、`Shuffle` 等）都基于 `Source.Uint64()` 派生，随机质量完全取决于底层 Source。

---

## Source 接口

```go
type Source interface {
    Uint64() uint64
}
```

PCG 和 ChaCha8 只实现这一个方法，本身没有其他随机数方法。

---

## 两种 Source

### PCG（Permuted Congruential Generator）

```go
src := rand.NewPCG(seed1, seed2 uint64)
```

- 算法：线性同余 + 输出置换，64 位状态
- 特点：极快、统计质量好、可复现（固定种子 → 固定序列）
- 适用：测试、模拟、游戏等通用场景

### ChaCha8

```go
var seed [32]byte
src := rand.NewChaCha8(seed)
```

- 算法：ChaCha 流密码，8 轮（标准 ChaCha20 的简化版）
- 特点：密码学安全，不可从输出反推状态
- 适用：需要不可预测性的场景（token、验证码等）
- 注意：比 PCG 慢，但仍远快于 `crypto/rand`

---

## 创建 Rand 实例

```go
r := rand.New(rand.NewPCG(42, 0))
```

全局函数使用内部自动种子的 Rand 实例，无需手动创建。

---

## API 一览

### 无上界——返回类型全范围

| 函数 | 返回范围 |
|------|----------|
| `Int64()` | `[0, math.MaxInt64]` |
| `Int32()` | `[0, math.MaxInt32]` |
| `Uint64()` | `[0, math.MaxUint64]` |
| `Uint32()` | `[0, math.MaxUint32]` |

### 有上界 N——返回 `[0, n)`

| 函数 | 说明 |
|------|------|
| `IntN(n int)` | n 为 int 类型 |
| `Int64N(n int64)` | n 超过 int 最大值时用 |
| `Uint64N(n uint64)` | 无符号版本 |
| `Uint32N(n uint32)` | 无符号版本 |

### 浮点

| 函数 | 返回范围 |
|------|----------|
| `Float64()` | `[0.0, 1.0)` |
| `Float32()` | `[0.0, 1.0)` |

### 统计分布

| 函数 | 分布 |
|------|------|
| `NormFloat64()` | 正态分布，μ=0，σ=1 |
| `ExpFloat64()` | 指数分布，λ=1 |

### 排列与乱序

```go
rand.Perm(n int) []int                        // 返回 [0,n) 的随机排列
rand.Shuffle(n int, swap func(i, j int))      // Fisher-Yates 原地乱序
```

---

## 各方法实现原理

### Int32() / Uint32()

取 `Uint64()` 的高 32 位：

```
Uint64() >> 32
```

### IntN(n) / Int64N(n)

用**拒绝采样（rejection sampling）**消除模偏差：

```
threshold = (2^64 - n) % n   // 计算需要丢弃的下界
loop:
    v = Uint64()
    if v >= threshold: return v % n
```

直接取模会导致小数字出现概率略高（模偏差），拒绝采样保证均匀分布。

### Float64()

取 `Uint64()` 的高 53 位（IEEE 754 double 尾数位数），除以 2⁵³：

```
float64(Uint64() >> 11) / (1 << 53)
```

结果均匀分布在 `[0.0, 1.0)`。

### Float32()

同理取高 24 位除以 2²⁴。

### NormFloat64()

使用 **ziggurat 算法**将均匀分布转为正态分布。核心思路：
- 将正态分布曲线下面积切成若干水平矩形层（ziggurat）
- 大多数采样落在矩形内，直接接受（快速路径）
- 边缘情况才走精确计算（慢速路径，概率极低）
- 比 Box-Muller 快约 4 倍

### ExpFloat64()

同样用 ziggurat 算法处理指数分布。

### Shuffle(n, swap)

**Fisher-Yates 洗牌算法**，O(n) 时间，原地操作：

```
for i = n-1; i > 0; i--:
    j = IntN(i + 1)
    swap(i, j)
```
每个排列出现概率严格相等。

### Perm(n)

内部调用 Shuffle，先生成 `[0,n)` 的有序切片再乱序。

---

## 与 v1 的主要区别

| | v1 | v2 |
|--|----|----|
| 全局种子 | 需手动 `rand.Seed(...)` | 自动，无需操作 |
| 默认算法 | 线性同余（质量差） | PCG / ChaCha8 |
| 命名 | `Intn` / `Int63n` | `IntN` / `Int64N`（规范化） |
| 并发安全 | 全局有锁 | 全局无锁（每 goroutine 独立状态） |

---

## 常用模式

```go
// 范围随机整数 [min, max)
val := min + rand.IntN(max-min)

// 随机选取切片元素
item := slice[rand.IntN(len(slice))]

// 可复现的测试随机数
r := rand.New(rand.NewPCG(42, 0))
r.IntN(100)

// 乱序切片
rand.Shuffle(len(s), func(i, j int) { s[i], s[j] = s[j], s[i] })
```

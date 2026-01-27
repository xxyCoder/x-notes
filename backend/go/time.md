## Time结构体

```go
type Time struct {
	wall uint64
	ext  int64
	loc *Location
}
```

`wall`字段 Bit 63为 **hasMonotonic 标志位** (1 表示包含单调时钟，0 表示不包含)，Bit 30-62 **秒数** (在 hasMonotonic=1下 表示距离基准年 1885 多少秒，否则为全0)，Bit 0-29 **纳秒** (范围 [0, 999999999])

`ext`  **单调时钟** 存储程序启动后的完整的纳秒数，**非单调时钟** 存储距离 **公元元年1月1日**的完整秒数

### 函数

```go
unixToInternal int64 = (1969*365 + 1969/4 - 1969/100 + 1969/400) * secondsPerDay

func Now() Time {
	sec, nsec, mono := runtimeNow() // 距离 UTC 1970年1月1日 00:00:00 的秒数/纳秒偏移量/代表系统启动（开机）以来的纳秒数
	if mono == 0 { // 不支持单调时钟
		return Time{uint64(nsec), sec + unixToInternal, Local}
	}
	mono -= startNano
	sec += unixToInternal - minWall
	if uint64(sec)>>33 != 0 {
		// Seconds field overflowed the 33 bits available when
		// storing a monotonic time. This will be true after
		// March 16, 2157.
		return Time{uint64(nsec), sec + minWall, Local}
	}
	return Time{hasMonotonic | uint64(sec)<<nsecShift | uint64(nsec), mono, Local}
}
```

1. `runtimeNow`不会陷入内核，而是从只读内存 vDSO 读取（由内核进行校准）
2. Unix是从1970年开始计数，go选择从公元元年(Year 1)开始计数，故而需要加 `unixToInternal`（从公元1年 到 1970年 之间总共的秒数）
3. `startNano` 是Go 进程启动时刻的系统单调时钟值，`minWall` 是从 **公元元年 (0001-01-01)** 到 **1885年1月1日** 之间的总秒数

```go
func Unix(sec int64, nsec int64) Time {
	if nsec < 0 || nsec >= 1e9 {
		n := nsec / 1e9
		sec += n
		nsec -= n * 1e9
		if nsec < 0 {
			nsec += 1e9
			sec--
		}
	}
	return Time{uint64(nsec), sec + unixToInternal, Local}
}
```

1. 传递自1970年1月1日UTC起的秒数和纳秒数


## Location

```go
type Location struct {
	name string
	zone []zone
	tx   []zoneTrans

	extend string

	cacheStart int64
	cacheEnd   int64
	cacheZone  *zone
}

type zone struct {
	name   string // abbreviated name, "CET"
	offset int    // seconds east of UTC
	isDST  bool   // 是否夏令时
}

type zoneTrans struct {
	when         int64 // transition time, in seconds since 1970 GMT
	index        uint8 // the index of the zone that goes into effect at that time
	isstd, isutc bool  // ignored - no idea what these mean
}
```

`zone` 只存定义

`tx` 是历史记录表，它记录了**在这个时刻（Unix秒），切换到哪个规则（zone index）**

`cache` 记住了**最近一次查询结果的有效期**

### 例子

位于 America/Los_Angeles 为例

```go
// loc.zone slice
[
  {Name: "PST", Offset: -28800, isDST: false}, // Index 0: 标准时间 (-8h)
  {Name: "PDT", Offset: -25200, isDST: true},  // Index 1: 夏令时间 (-7h)
]

// loc.tx slice
// ZoneIndex 是 uint8 类型，指向上面的 zone 数组下标
[
  ...
  {When: 1699174800, Index: 0}, // [A] 2023-11-05 09:00:00 UTC -> 切回 PST (冬)
  {When: 1710061200, Index: 1}, // [B] 2024-03-10 10:00:00 UTC -> 切入 PDT (夏)
  {When: 1730624400, Index: 0}, // [C] 2024-11-03 09:00:00 UTC -> 切回 PST (冬)
  {When: 1741510800, Index: 1}, // [D] 2025-03-09 10:00:00 UTC -> 切入 PDT (夏)
  ...
]
```

cache初始化

```go
loc.cacheStart = 0
loc.cacheEnd   = 0
loc.cacheZone  = nil
```

查询 解析 **2024-06-01** (Unix: `1717200000`) **预期**是夏令时 (PDT)

1. 检查cache，不位于 `cacheStart`和 `cacheEnd` 之间
2. 二分查询查询tx表，拿到 `Index`，更新cache的 `cacheStart`和 `cacheEnd`
3. 查询zone列表，获取 `offset`，更新 `cacheZone`指向 zone[idx]

后续查询命中cache，直接返回

1. 检查cache，位于 `cacheStart`和 `cacheEnd` 之间
2. 返回 `cacheZone`中 `offset`即可

## Duration

```go
type Duration int64
```

单位固定是 **纳秒**

不考虑使用 uint64 是因为时间也会设计加减，如果小时间减大时间，可以表示相差多少，但是如果用 uint64 就无法正确表示

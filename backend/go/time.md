范围：时间点与时长、时间计算和比较、格式化与解析、时区、时间戳、等待与计时器。

---

## 1. 基础类型：`Time` 和 `Duration`

| 类型 | 含义 | 典型用途 |
|---|---|---|
| `time.Time` | 一个确定的时间点，并关联时区信息 | 创建时间、过期时间、开始时间 |
| `time.Duration` | 一段时长或两个时间点之间的差值 | 超时时长、有效期、执行耗时 |

`Time` 对应“什么时候”，`Duration` 对应“多长时间”。`Duration` 本身没有指定起点和终点，也可以是负值。

```go
createdAt := time.Now()          // time.Time：创建时刻
validFor := 30 * time.Minute     // time.Duration：有效时长
```

### `time.Now()` 记录调用时的时刻

```go
createdAt := time.Now()
```

`createdAt` 保存的是执行这一行时取得的时间值。后面时间继续流逝，这个变量不会自动刷新。

这不代表变量不能改变。重新赋值仍然可以更新它：

```go
createdAt = time.Now()
```

`Now()` 返回的时间关联运行环境的本地时区。

### `Duration` 的单位

`Duration` 的底层类型是 `int64`，计数单位是纳秒：

```go
type Duration int64
```

常用写法：

```go
500 * time.Millisecond // 500 毫秒
3 * time.Second       // 3 秒
30 * time.Minute      // 30 分钟
2 * time.Hour         // 2 小时
```

---

## 2. 时间计算：`Add`、`Sub`、`Since`

三个方法的关系：

| 写法 | 运算含义 | 返回类型 |
|---|---|---|
| `t.Add(d)` | 时间点 + 时长 | `time.Time` |
| `a.Sub(b)` | 时间点 a − 时间点 b | `time.Duration` |
| `time.Since(t)` | 当前时间 − 时间点 t | `time.Duration` |

### `Add`：计算另一个时间点

订单创建后 30 分钟过期：

```go
createdAt := time.Now()
validFor := 30 * time.Minute

expiresAt := createdAt.Add(validFor)
```

假设创建时刻是 14:00：

| 变量 | 值 |
|---|---|
| `createdAt` | 14:00 |
| `validFor` | 30 分钟 |
| `expiresAt` | 14:30 |

**`Add` 返回新值，不会原地修改原来的时间。**

```go
createdAt.Add(30 * time.Minute)
// 返回值被丢弃，createdAt 不变
```

需要保留结果时，赋给另一个变量，或者赋回原变量：

```go
expiresAt := createdAt.Add(30 * time.Minute)

createdAt = createdAt.Add(30 * time.Minute)
```

这两种写法改变的变量不同。

### `Sub`：计算两个时间点之间的差值

```go
validFor := expiresAt.Sub(createdAt)
```

`a.Sub(b)` 的顺序就是 `a - b`。

```go
expiresAt.Sub(createdAt) //  30 分钟
createdAt.Sub(expiresAt) // -30 分钟
```

常见计算：

```go
elapsed := now.Sub(createdAt)    // 从创建到现在，经过多久
remaining := expiresAt.Sub(now)  // 从现在到过期，还剩多久
```

假设订单 14:00 创建、14:30 过期，现在是 14:10：

- `now.Sub(createdAt)`：10 分钟。
- `expiresAt.Sub(now)`：20 分钟。
- 如果当前时间已经超过过期时间，`expiresAt.Sub(now)` 会得到负值。

### `Since`：计算从某个时刻到现在的耗时

```go
elapsed := time.Since(createdAt)
```

相当于：

```go
elapsed := time.Now().Sub(createdAt)
```

它使用的是调用 `Since` 时的当前时间。`Sub` 的两个时间点由调用者指定，`Since` 把结束时间取为“现在”。[Go Packages](https://pkg.go.dev/time?utm_source=chatgpt.com)

统计业务耗时：

```go
start := time.Now()

// 执行业务逻辑：查询数据库、调用接口、处理数据……

elapsed := time.Since(start)
fmt.Println("耗时:", elapsed)
```

开始时间必须在业务执行前记录。

```go
// 业务已经执行完毕
elapsed := time.Since(time.Now())
```

这行计算的是“刚刚取得当前时间”到 `Since` 进行计算之间的间隔，通常很小，不能覆盖前面已经结束的业务过程。

---

## 3. 时间比较：`Before`、`After`、`Equal`

| 写法 | 含义 |
|---|---|
| `a.Before(b)` | a 是否早于 b |
| `a.After(b)` | a 是否晚于 b |
| `a.Equal(b)` | a 和 b 是否表示同一个时间点 |

返回值都是 `bool`。

`Before`、`After` 都是严格比较，不包含相等：

| a 与 b 的关系 | `a.Before(b)` | `a.After(b)` | `a.Equal(b)` |
|---|---:|---:|---:|
| a 早于 b | `true` | `false` | `false` |
| a 晚于 b | `false` | `true` | `false` |
| 同一个时间点 | `false` | `false` | `true` |

判断是否为同一个时间点，使用 `Equal`。`==` 还会比较时区等内部信息，含义与 `Equal` 不同。

### 过期判断要明确相等边界

如果业务规定“到期那一刻就算过期”：

```go
now := time.Now()

if now.Before(expiresAt) {
    fmt.Println("尚未过期")
} else {
    fmt.Println("已过期")
}
```

也可以直接计算是否过期：

```go
expired := !now.Before(expiresAt)
```

这里包含两种情况：

- 当前时间等于过期时间。
- 当前时间晚于过期时间。

单独使用下面这句，会排除“恰好相等”的情况：

```go
expired := now.After(expiresAt)
```

---

## 4. 字符串转换：`Format` 和 `Parse`

| 操作 | 转换方向 |
|---|---|
| `t.Format(layout)` | `time.Time` → `string` |
| `time.Parse(layout, value)` | `string` → `time.Time`，同时返回解析错误 |

### 格式模板

Go 使用特定的参考时间表示格式。常用模板是：

```go
"2006-01-02 15:04:05"
```

| 模板字段 | 含义 |
|---|---|
| `2006` | 四位年份 |
| `01` | 两位月份 |
| `02` | 两位日期 |
| `15` | 小时，24 小时制 |
| `04` | 两位分钟 |
| `05` | 两位秒数 |

模板中的这些数字用于指定时间字段。格式化时，会填入目标时间的实际值。分隔符也属于格式的一部分。

### `Format`：生成字符串

假设 `t` 按自身时区显示为 `2026-11-01 14:30:08`：

```go
fmt.Println(t.Format("2006-01-02 15:04:05"))
// 2026-11-01 14:30:08

fmt.Println(t.Format("2006/01/02"))
// 2026/11/01

fmt.Println(t.Format("15:04:05"))
// 14:30:08
```

`Format` 返回字符串，不改变原来的 `t`：

```go
text := t.Format("2006-01-02")

// t    仍是 time.Time
// text 是 string
```

输出中的年月日、时分秒，使用 `t` 所关联的时区。`Format` 本身不会把时间统一转换成 UTC。

### `Parse`：解析字符串

参数顺序：

```go
time.Parse(格式模板, 实际字符串)
```

示例：

```go
t, err := time.Parse("2006/01/02", "2026/11/01")
if err != nil {
    fmt.Println("解析失败:", err)
    return
}

fmt.Println(t)
// 2026-11-01 00:00:00 +0000 UTC
```

两个返回值分别是：

- `t`：解析得到的 `time.Time`。
- `err`：解析错误，成功时为 `nil`。

模板与输入的书写格式需要匹配。例如：

```go
time.Parse("2006-01-02", "2026/11/01")
```

这里模板使用 `-`，输入使用 `/`，解析会失败。应改成：

```go
time.Parse("2006/01/02", "2026/11/01")
```

格式不匹配、月份超出范围、日期不合法等情况，都可能返回错误。

### 缺少时间或时区信息时的规则

对于 `"2026/11/01"` 这样的输入：

- 没有提供时分秒，得到的时分秒为 `00:00:00`。
- 没有提供时区，`Parse` 默认按 **UTC** 解析。

**`Parse` 对无时区字符串使用 UTC，不会自动按服务器的本地时区解释。**

---

## 5. 时区：`LoadLocation`、`ParseInLocation`、`In`

需要区分两件事：

1. 根据日期、时间文字和时区，确定一个时间点。
2. 已经有了时间点，再换一种时区表示它。

对应关系：

| API | 作用 |
|---|---|
| `time.LoadLocation(name)` | 获取指定时区的规则 |
| `time.ParseInLocation(layout, value, loc)` | 使用指定时区解析字符串 |
| `t.In(loc)` | 将已有时间点转换为指定时区的表示 |

### 按北京时间解析字符串

业务约定下面这段文字表示北京时间：

```text
2026/11/01 14:30:00
```

先取得时区，再解析：

```go
loc, err := time.LoadLocation("Asia/Shanghai")
if err != nil {
    fmt.Println("加载时区失败:", err)
    return
}

t, err := time.ParseInLocation(
    "2006/01/02 15:04:05",
    "2026/11/01 14:30:00",
    loc,
)
if err != nil {
    fmt.Println("解析失败:", err)
    return
}

fmt.Println(t)
// 2026-11-01 14:30:00 +0800 CST
```

这里：

- `loc` 的类型是 `*time.Location`。
- `Asia/Shanghai` 用来指定本例中的北京时间。
- `+0800` 表示 UTC+8。

对于**没有时区信息的字符串**，`Parse` 使用 UTC，`ParseInLocation` 使用传入的 `loc`。这个区别针对无时区输入；输入自带时区时，还需要按相应解析规则处理。

### 相同文字，按不同时区解析，可能得到不同时间点

以本例的字符串为例：

| 解析方式 | 得到的时间 | 对应的 UTC 时间 |
|---|---|---|
| `Parse` | UTC 的 14:30 | 14:30 UTC |
| `ParseInLocation`，指定上海时区 | 北京时间的 14:30 | 06:30 UTC |

这两个解析结果相差 8 小时。

字符串中的 `14:30` 只是钟面上的时间。需要结合时区，才能确定它对应哪一个时刻。

### `In`：保留时间点，改变时区表示

沿用前面按北京时间解析得到的 `t`：

```go
utcTime := t.In(time.UTC)
```

此时两个值的关系是：

| 变量 | 关联时区 | 显示时间 |
|---|---|---|
| `t` | `Asia/Shanghai` | 2026-11-01 14:30:00 |
| `utcTime` | `UTC` | 2026-11-01 06:30:00 |

它们表示同一个时间点：

```go
fmt.Println(t.Equal(utcTime))
// true
```

`In` 返回一个新的 `time.Time`，不修改原来的值。[go.dev]

```go
fmt.Println(t.Format("15:04:05"))
// 14:30:00

fmt.Println(utcTime.Format("15:04:05"))
// 06:30:00
```

要改变 `t` 这个变量保存的时区表示，需要重新赋值：

```go
t = t.In(time.UTC)

fmt.Println(t.Format("15:04:05"))
// 06:30:00
```

这与 `Add` 的返回值规则相同：新值赋给谁，谁才会更新。

### 时间点和 UTC 的关系

一个确定的时间点可以用 UTC 表示，也可以用北京时间等其他时区表示。

因此，“`t` 已经确定了一个时间点”不等于“`t` 当前关联的时区就是 UTC”。

- `Equal` 比较是否为同一个时间点。
- `Format` 按该值关联的时区生成文字。
- `In` 改变返回值的时区表示。
- `Add` 会把时间点向前或向后移动。

---

## 6. 时间戳：`Unix`、`UnixMilli`

Unix 时间戳用数字表示目标时间点与以下固定起点的关系：

```text
1970-01-01 00:00:00 UTC
```

常见单位是秒和毫秒。

时间戳仍然表示一个时间点；它与业务耗时使用的 `Duration` 含义不同。

### `time.Time` 转为时间戳

```go
now := time.Now()

sec := now.Unix()     // 秒时间戳，int64
ms := now.UnixMilli() // 毫秒时间戳，int64
```

| 方法 | 返回单位 | 保留精度 |
|---|---|---|
| `Unix()` | 秒 | 到秒 |
| `UnixMilli()` | 毫秒 | 到毫秒 |

例如，距离 Unix 起点 1.5 秒的时间点：

| 表示方式 | 数值 |
|---|---:|
| 秒时间戳 | `1` |
| 毫秒时间戳 | `1500` |

同一个时间点的时间戳不随显示时区改变。

```go
utcTime := t.In(time.UTC)

fmt.Println(t.Unix() == utcTime.Unix())
// true
```

### 时间戳转回 `time.Time`

```go
t1 := time.Unix(sec, 0)
t2 := time.UnixMilli(ms)
```

`time.Unix` 有两个参数：

```go
time.Unix(秒数, 额外的纳秒数)
```

手里只有秒时间戳时，第二个参数填 `0`。

单位必须与转换方法对应：

| 输入单位 | 转成 `time.Time` |
|---|---|
| 秒 | `time.Unix(sec, 0)` |
| 毫秒 | `time.UnixMilli(ms)` |

这些构造函数返回的时间默认关联运行环境的本地时区。需要固定显示时区时，再使用 `In`：

```go
t := time.UnixMilli(ms).In(loc)
```

这一步改变表示方式，时间戳确定的实际时刻不变。

### 转换会损失更细的精度

```go
sec := now.Unix()
restored := time.Unix(sec, 0)
```

`restored` 只保留到了秒。原来不足一秒的部分已经丢失，无法通过这次反向转换恢复。

同理，经过 `UnixMilli()` 转换再还原，只能保留到毫秒。

因此，时间戳往返转换之后，不能默认还原值一定与原始 `time.Time` 精确相等。接口约定的时间单位和精度需要一起确认。

---

## 7. `Sleep`：暂停当前 goroutine

```go
fmt.Println("开始")

time.Sleep(2 * time.Second)

fmt.Println("继续执行")
```

执行到 `Sleep` 时，当前 goroutine 暂停。至少经过指定时长后，才有机会继续执行后面的代码；实际恢复时间还受调度影响。

暂停的是当前 goroutine，其他 goroutine 仍然可以继续运行。

常见用法：

```go
time.Sleep(500 * time.Millisecond)
time.Sleep(2 * time.Second)
```

由于参数类型是 `time.Duration`：

```go
time.Sleep(2)
```

这行能够编译，但参数表示 **2 纳秒**。

`Sleep` 适合明确安排一段等待，例如失败后等待 500 毫秒，再发起重试。它本身没有“等待业务结果，结果到达就提前结束”的分支选择能力。

---

## 8. `After`：一次性计时通知

这里的两个 `After` 是不同的 API：

| 写法 | 参数 | 返回值 | 作用 |
|---|---|---|---|
| `t.After(u)` | 另一个时间点 | `bool` | 比较时间先后 |
| `time.After(d)` | 一段时长 | `<-chan time.Time` | 取得一次到时通知 |

### 调用与接收是两个动作

```go
ch := time.After(2 * time.Second)

fmt.Println("计时已经开始")

<-ch

fmt.Println("收到计时通知")
```

`time.After` 在调用时开始计时并返回 channel，不会先等待指定时长再返回。

等待发生在接收操作上：

```go
<-ch
```

如果通知尚未就绪，当前 goroutine 会在接收处阻塞；如果通知已经可以接收，就直接继续执行。计时不会因为执行到 `<-ch` 才重新开始。

channel 中传递的值是 `time.Time`。只关心“到点”时，可以直接接收并丢弃该值。

`After` 提供一次通知，通知之后不会自动关闭 channel，也不会持续产生后续通知。

### 配合 `select` 等待结果或超时

假设另一个 goroutine 完成工作后，会把结果发送到 `resultCh`：

```go
select {
case result := <-resultCh:
    fmt.Println("收到结果:", result)

case <-time.After(2 * time.Second):
    fmt.Println("等待超时")
}
```

两个分支分别等待：

| 分支 | 等待内容 |
|---|---|
| `<-resultCh` | 业务结果 |
| `<-time.After(...)` | 计时到点的通知 |

这个 `select` 没有 `default`：

- 两个分支都不能执行时，当前 goroutine 等待。
- 有分支可以执行时，选择一个执行。
- 选择时如果两个分支都已就绪，Go 会伪随机选择其中一个。
- 执行所选分支后，继续执行 `select` 后面的代码。

所以这里不存在“两个分支都就绪时，业务结果一定优先”的保证。

两秒是计时器的到期时长，实际执行超时分支的时刻还受调度影响。

### 超时与取消任务是两件事

上面的超时分支只让当前代码结束这次等待。

如果后台 goroutine 仍在查数据库、调用接口或处理数据，这段 `select` 没有让它停止。后台任务是否取消，需要相应的取消机制。

同样，超时分支执行结束，也不等于所在函数或外层循环自动结束；需要退出时，要由相应的 `return`、循环退出条件等控制。

---

## 9. `NewTimer`：可控制的一次性计时器

`time.NewTimer` 返回 `*time.Timer`：

```go
timer := time.NewTimer(2 * time.Second)
```

创建后开始计时，通过 `timer.C` 接收一次通知：

```go
<-timer.C
fmt.Println("计时到点")
```

与 `After` 的关系是：

```go
time.After(d)
```

相当于取得：

```go
time.NewTimer(d).C
```

`NewTimer` 额外保留了计时器对象，可以主动调用 `Stop`。

### 提前停止不再需要的计时器

```go
timer := time.NewTimer(2 * time.Second)

select {
case result := <-resultCh:
    timer.Stop()
    fmt.Println("收到结果:", result)

case <-timer.C:
    fmt.Println("等待超时")
}
```

假设业务结果在 500 毫秒时到达，结果分支可以停止不再需要的计时器。

`Timer.Stop()` 返回 `bool`，表示这次调用是否停止了计时器。上面这种单次等待场景，直接调用它进行停止操作即可，没有依赖返回值处理后续接收。

### `Stop` 的边界

`Stop` 不会：

- 关闭 `timer.C`。
- 通过 `timer.C` 发送“已经取消”的通知。
- 自动结束另一个正在等待 `timer.C` 的 goroutine。
- 取消业务任务，或撤销已经执行的业务操作。

因此，接收端需要退出时，应有自己的退出路径。上面的例子中，接收到 `resultCh` 的结果就是另一条路径。

也可以使用：

```go
defer timer.Stop()
```

它安排的是**函数退出时**停止计时器。需要在某个分支立即停止时，仍应在那个分支直接调用 `Stop`。

### 版本备注

Go 1.23 引入的新计时器语义支持回收已经没有引用的 Timer、Ticker，可由 GC 回收，不必手动 Stop，也增强了停止后不会收到旧计时值的保证。

---

## 10. `NewTicker`：周期性计时通知

`time.NewTicker` 返回 `*time.Ticker`，按指定周期提供通知：

```go
ticker := time.NewTicker(1 * time.Second)
```

通过 `ticker.C` 接收，使用 `ticker.Stop()` 停止。

### 接收三次通知的例子

```go
func runThreeChecks() {
    ticker := time.NewTicker(1 * time.Second)
    defer ticker.Stop()

    for i := 0; i < 3; i++ {
        <-ticker.C
        fmt.Println("执行一次检查")
    }
}
```

这段函数的行为：

- 创建时开始计时。
- 每次接收到通知，执行一次检查。
- 接收三次后，循环结束。
- 函数返回时执行 `ticker.Stop()`。

第一次通知在一个周期之后。创建 ticker 本身不会立即执行一次检查。

### Ticker 提供通知，接收端执行任务

```go
<-ticker.C
fmt.Println("执行一次检查")
```

收到通知后，当前 goroutine 才会执行下面的代码。

Ticker 不会自动为每次通知创建一个 goroutine 来执行任务。在上面的写法中，检查代码是在当前 goroutine 中顺序执行的。

如果接收或处理速度太慢，ticker 可能调整通知间隔或丢弃部分通知。因此，它不保证每个周期都执行一次任务，也不保证把所有错过的通知积压下来逐一补做。

`NewTicker` 的周期必须大于零，否则会 panic

### `Stop` 不会结束接收循环

与 Timer 一样，`ticker.Stop()` 不会关闭 `ticker.C`。

下面这种循环，不会因为其他地方调用了 `ticker.Stop()` 就自动结束：

```go
for range ticker.C {
    // 执行任务
}
```

需要结束循环时，应明确提供退出条件，例如次数限制，或者通过 `select` 等待其他退出信号。

上面的三次检查示例使用次数限制退出，`defer` 负责在函数返回时停止 ticker。

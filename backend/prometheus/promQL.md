## 1. PromQL 是什么

PromQL 是 Prometheus 的查询语言，用来查询、计算、聚合时间序列数据。

一个 Prometheus 指标本质上是很多条时间序列，例如：

```promql
http_requests_total{job="api", instance="A", status="200"}
http_requests_total{job="api", instance="B", status="500"}
```

每条时间序列由三部分组成：

```text
metric name + labels + samples
```

例如：

```text
http_requests_total{job="api", instance="A", status="200"} 1000
```

其中：

```text
http_requests_total 是指标名
job / instance / status 是标签
1000 是当前样本值
```

---

## 2. Instant Vector 和 Range Vector

PromQL 里最重要的是区分两种向量。

### 2.1 Instant Vector：瞬时向量

瞬时向量表示“某个时间点的一组时间序列的当前值”。

例如：

```promql
up{job="api"}
```

可能返回：

```text
up{job="api", instance="A"} 1
up{job="api", instance="B"} 0
```

它查的是当前时刻每个实例的值。

再看本地指标：

```promql
xxy_prome_api_request_total
```

如果当前有 5 条 `xxy_prome_api_request_total` 序列，拆开是：

```text
xxy_prome_api_request_total
└── instant vector
    └── 所有名字叫 xxy_prome_api_request_total 的时间序列
        ├── 序列 1 => 当前查询时刻的一个值
        ├── 序列 2 => 当前查询时刻的一个值
        ├── 序列 3 => 当前查询时刻的一个值
        ├── 序列 4 => 当前查询时刻的一个值
        └── 序列 5 => 当前查询时刻的一个值
```

---

### 2.2 Range Vector：区间向量

区间向量表示“每条时间序列在一段时间窗口内的多个样本”。

例如：

```promql
http_requests_total[5m]
```

意思是：

```text
每条 http_requests_total 时间序列在最近 5 分钟内的所有样本
```

注意：range vector 不是把所有实例混在一起，而是每条时间序列各自取自己的 5 分钟窗口。

再看本地指标：

```promql
xxy_prome_api_request_total[5m]
```

拆开是：

```text
xxy_prome_api_request_total[5m]
└── range vector
    ├── 时间范围
    │   └── 最近 5 分钟
    │
    └── 所有名字叫 xxy_prome_api_request_total 的时间序列
        ├── 序列 1
        │   ├── xxy_prome_api_request_total{code="0",method="POST",path="/v1/chat/completion",status="0",type="request",version="1.0"}
        │   └── 最近 5 分钟内的采样点
        │       ├── t1 => v1
        │       ├── t2 => v2
        │       ├── t3 => v3
        │       └── t4 => v4
        ├── 序列 2
        │   ├── xxy_prome_api_request_total{code="0",method="POST",path="/v1/chat/completion",status="200",type="success",version="1.0"}
        │   └── 最近 5 分钟内的采样点
        │       ├── t1 => v1
        │       ├── t2 => v2
        │       ├── t3 => v3
        │       └── t4 => v4
        ├── 序列 3
        │   ├── xxy_prome_api_request_total{code="400001",method="POST",path="/v1/chat/completion",status="400",type="error",version="1.0"}
        │   └── 最近 5 分钟内的采样点
        │       ├── t1 => v1
        │       ├── t2 => v2
        │       ├── t3 => v3
        │       └── t4 => v4
        ├── 序列 4
        │   ├── xxy_prome_api_request_total{code="400002",method="POST",path="/v1/chat/completion",status="400",type="error",version="1.0"}
        │   └── 最近 5 分钟内的采样点
        │       ├── t1 => v1
        │       ├── t2 => v2
        │       ├── t3 => v3
        │       └── t4 => v4
        └── 序列 5
            ├── xxy_prome_api_request_total{code="400003",method="POST",path="/v1/chat/completion",status="400",type="error",version="1.0"}
            └── 最近 5 分钟内的采样点
                ├── t1 => v1
                ├── t2 => v2
                ├── t3 => v3
                └── t4 => v4
```

加 label 条件时：

```promql
xxy_prome_api_request_total{status="400"}[5m]
```

拆开是：

```text
xxy_prome_api_request_total{status="400"}[5m]
└── range vector
    ├── 时间范围
    │   └── 最近 5 分钟
    │
    └── 只保留 status="400" 的时间序列
        ├── 序列 1
        │   ├── xxy_prome_api_request_total{code="400001",method="POST",path="/v1/chat/completion",status="400",type="error",version="1.0"}
        │   └── 最近 5 分钟内的采样点
        │       ├── t1 => v1
        │       ├── t2 => v2
        │       ├── t3 => v3
        │       └── t4 => v4
        ├── 序列 2
        │   ├── xxy_prome_api_request_total{code="400002",method="POST",path="/v1/chat/completion",status="400",type="error",version="1.0"}
        │   └── 最近 5 分钟内的采样点
        │       ├── t1 => v1
        │       ├── t2 => v2
        │       ├── t3 => v3
        │       └── t4 => v4
        └── 序列 3
            ├── xxy_prome_api_request_total{code="400003",method="POST",path="/v1/chat/completion",status="400",type="error",version="1.0"}
            └── 最近 5 分钟内的采样点
                ├── t1 => v1
                ├── t2 => v2
                ├── t3 => v3
                └── t4 => v4
```

---

## 3. 聚合函数和区间函数的区别

这是最容易混的点。

### 3.1 普通聚合函数

普通聚合函数作用在“多条时间序列之间”。

例如：

```promql
sum(http_requests_total) by (job)
```

意思是：

```text
把同一个 job 下的多条时间序列加起来
```

例如本地指标：

```promql
sum by (status) (xxy_prome_api_request_total)
```

计算过程：

```text
sum by (status) (xxy_prome_api_request_total)
└── 第 1 步：取出当前时刻的所有序列
    ├── xxy_prome_api_request_total{code="0",method="POST",path="/v1/chat/completion",status="0",type="request",version="1.0"} 7
    ├── xxy_prome_api_request_total{code="0",method="POST",path="/v1/chat/completion",status="200",type="success",version="1.0"} 4
    ├── xxy_prome_api_request_total{code="400001",method="POST",path="/v1/chat/completion",status="400",type="error",version="1.0"} 1
    ├── xxy_prome_api_request_total{code="400002",method="POST",path="/v1/chat/completion",status="400",type="error",version="1.0"} 1
    └── xxy_prome_api_request_total{code="400003",method="POST",path="/v1/chat/completion",status="400",type="error",version="1.0"} 1

└── 第 2 步：按 status 分组
    ├── status="0"
    │   └── 7
    ├── status="200"
    │   └── 4
    └── status="400"
        ├── 1
        ├── 1
        └── 1

└── 第 3 步：每组内求和
    ├── status="0"   => 7
    ├── status="200" => 4
    └── status="400" => 1 + 1 + 1 = 3

└── 第 4 步：输出新的 instant vector
    ├── {status="0"}   7
    ├── {status="200"} 4
    └── {status="400"} 3
```

常见聚合函数：

```text
sum
avg
max
min
count
```

它们通常处理的是 instant vector。

---

### 3.2 区间函数

区间函数作用在“同一条时间序列自己的时间窗口内”。

例如：

```promql
max_over_time(cpu_usage[5m])
```

意思是：

```text
每条 cpu_usage 时间序列，在最近 5 分钟内取最大值
```

例如：

```promql
max_over_time(xxy_prome_api_request_total[5m])
```

计算过程：

```text
max_over_time(xxy_prome_api_request_total[5m])
└── 输入：range vector
    ├── 序列 1：xxy_prome_api_request_total{code="0",method="POST",path="/v1/chat/completion",status="0",type="request",version="1.0"} 的窗口采样点
    ├── 序列 2：xxy_prome_api_request_total{code="0",method="POST",path="/v1/chat/completion",status="200",type="success",version="1.0"} 的窗口采样点
    ├── 序列 3：xxy_prome_api_request_total{code="400001",method="POST",path="/v1/chat/completion",status="400",type="error",version="1.0"} 的窗口采样点
    ├── 序列 4：xxy_prome_api_request_total{code="400002",method="POST",path="/v1/chat/completion",status="400",type="error",version="1.0"} 的窗口采样点
    └── 序列 5：xxy_prome_api_request_total{code="400003",method="POST",path="/v1/chat/completion",status="400",type="error",version="1.0"} 的窗口采样点

└── 对每条序列分别计算
    ├── 序列 1：取这串采样点里的最大值
    ├── 序列 2：取这串采样点里的最大值
    ├── 序列 3：取这串采样点里的最大值
    ├── 序列 4：取这串采样点里的最大值
    └── 序列 5：取这串采样点里的最大值

└── 输出：instant vector
    ├── 序列 1 => 最近 5 分钟内最大值
    ├── 序列 2 => 最近 5 分钟内最大值
    ├── 序列 3 => 最近 5 分钟内最大值
    ├── 序列 4 => 最近 5 分钟内最大值
    └── 序列 5 => 最近 5 分钟内最大值
```

常见区间函数：

```text
sum_over_time
avg_over_time
max_over_time
min_over_time
count_over_time
```

你的理解可以总结成：

```text
普通聚合函数：跨时间序列计算
区间函数：单条时间序列在时间窗口内计算
```

---

## 4. `sum` 和 `sum_over_time` 的区别

### 4.1 `sum`

```promql
sum(http_requests_total) by (job)
```

含义：

```text
在当前时刻，把多个时间序列的值加起来
```

它是跨 series 聚合。

---

### 4.2 `sum_over_time`

```promql
sum_over_time(http_requests_total[5m])
```

含义：

```text
对每条时间序列自己最近 5 分钟内的样本求和
```

它是对单条 series 的时间窗口求和。

---

## 5. Counter、Gauge 和常用函数

### 5.1 Counter

Counter 是只增不减的累计值，适合表示：

```text
请求总数
错误总数
任务处理总数
```

典型指标：

```promql
http_requests_total
```

Counter 不能直接看当前值判断 QPS，应该用：

```promql
rate(http_requests_total[5m])
increase(http_requests_total[5m])
```

---

### 5.2 Gauge

Gauge 是可上可下的瞬时值，适合表示：

```text
CPU 使用率
内存使用量
队列长度
当前连接数
```

Gauge 可以直接查，也可以用区间函数：

```promql
max_over_time(queue_length[10m])
avg_over_time(cpu_usage[5m])
```

---

## 6. `rate`、`increase`、`delta`

### 6.1 `rate`

```promql
rate(http_requests_total[5m])
```

含义：

```text
最近 5 分钟内，Counter 每秒平均增长多少
```

常用于 QPS、错误率。

例如：

```promql
sum(rate(http_requests_total[5m])) by (service)
```

表示每个 service 的每秒请求数。

例如：

```promql
rate(xxy_prome_api_request_total[5m])
```

计算过程：

```text
rate(xxy_prome_api_request_total[5m])
└── 输入：range vector
    ├── 序列 1：xxy_prome_api_request_total{code="0",method="POST",path="/v1/chat/completion",status="0",type="request",version="1.0"} 的 counter 采样点
    ├── 序列 2：xxy_prome_api_request_total{code="0",method="POST",path="/v1/chat/completion",status="200",type="success",version="1.0"} 的 counter 采样点
    ├── 序列 3：xxy_prome_api_request_total{code="400001",method="POST",path="/v1/chat/completion",status="400",type="error",version="1.0"} 的 counter 采样点
    ├── 序列 4：xxy_prome_api_request_total{code="400002",method="POST",path="/v1/chat/completion",status="400",type="error",version="1.0"} 的 counter 采样点
    └── 序列 5：xxy_prome_api_request_total{code="400003",method="POST",path="/v1/chat/completion",status="400",type="error",version="1.0"} 的 counter 采样点

└── 对每条序列分别计算
    ├── 序列 1：取窗口内所有采样点，计算 counter 增长，处理 reset，边界外推，除以 300 秒
    ├── 序列 2：取窗口内所有采样点，计算 counter 增长，处理 reset，边界外推，除以 300 秒
    ├── 序列 3：取窗口内所有采样点，计算 counter 增长，处理 reset，边界外推，除以 300 秒
    ├── 序列 4：取窗口内所有采样点，计算 counter 增长，处理 reset，边界外推，除以 300 秒
    └── 序列 5：取窗口内所有采样点，计算 counter 增长，处理 reset，边界外推，除以 300 秒

└── 输出：instant vector
    ├── 序列 1 => 每秒速率
    ├── 序列 2 => 每秒速率
    ├── 序列 3 => 每秒速率
    ├── 序列 4 => 每秒速率
    └── 序列 5 => 每秒速率
```

---

### 6.2 `increase`

```promql
increase(http_requests_total[5m])
```

含义：

```text
最近 5 分钟内，Counter 总共增加了多少
```

可以理解成：

```text
increase ≈ rate * 时间窗口秒数
```

例如：

```promql
increase(xxy_prome_api_request_total[5m])
```

计算过程：

```text
increase(xxy_prome_api_request_total[5m])
└── 输入：range vector
    ├── 序列 1：xxy_prome_api_request_total{code="0",method="POST",path="/v1/chat/completion",status="0",type="request",version="1.0"} 的 counter 采样点
    ├── 序列 2：xxy_prome_api_request_total{code="0",method="POST",path="/v1/chat/completion",status="200",type="success",version="1.0"} 的 counter 采样点
    ├── 序列 3：xxy_prome_api_request_total{code="400001",method="POST",path="/v1/chat/completion",status="400",type="error",version="1.0"} 的 counter 采样点
    ├── 序列 4：xxy_prome_api_request_total{code="400002",method="POST",path="/v1/chat/completion",status="400",type="error",version="1.0"} 的 counter 采样点
    └── 序列 5：xxy_prome_api_request_total{code="400003",method="POST",path="/v1/chat/completion",status="400",type="error",version="1.0"} 的 counter 采样点

└── 对每条序列分别计算
    ├── 序列 1：取窗口内所有采样点，计算 counter 增长，处理 reset，边界外推
    ├── 序列 2：取窗口内所有采样点，计算 counter 增长，处理 reset，边界外推
    ├── 序列 3：取窗口内所有采样点，计算 counter 增长，处理 reset，边界外推
    ├── 序列 4：取窗口内所有采样点，计算 counter 增长，处理 reset，边界外推
    └── 序列 5：取窗口内所有采样点，计算 counter 增长，处理 reset，边界外推

└── 输出：instant vector
    ├── 序列 1 => 最近 5 分钟内增加量
    ├── 序列 2 => 最近 5 分钟内增加量
    ├── 序列 3 => 最近 5 分钟内增加量
    ├── 序列 4 => 最近 5 分钟内增加量
    └── 序列 5 => 最近 5 分钟内增加量
```

具体到一条序列：

```promql
increase(xxy_prome_api_request_total{status="200",type="success"}[5m])
```

如果最近 5 分钟采样点是：

```text
12:00:00 => 4
12:01:00 => 5
12:02:00 => 5
12:03:00 => 6
12:04:00 => 7
12:05:00 => 9
```

没有 reset 时，直觉上接近：

```text
9 - 4 = 5
```

但 `increase` 不是只拿开头和结尾两个点硬减，它会基于窗口内采样点计算增长，并对窗口边界做外推。

如果中间服务重启，counter 归零：

```text
12:00:00 => 7
12:01:00 => 8
12:02:00 => 0
12:03:00 => 1
12:04:00 => 2
12:05:00 => 4
```

简单首尾相减会得到：

```text
4 - 7 = -3
```

这个结果是错的。`increase` 会识别 counter reset，按增长段计算：

```text
7 -> 8  增加 1
8 -> 0  reset，不按负数算
0 -> 1  增加 1
1 -> 2  增加 1
2 -> 4  增加 2

increase 约等于 1 + 1 + 1 + 2 = 5
```

---

### 6.3 `delta`

```promql
delta(memory_usage_bytes[5m])
```

含义：

```text
最近 5 分钟内，Gauge 的首尾差值
```

注意：

```text
Counter 通常用 rate / increase
Gauge 可以用 delta
```

---

## 7. `by` 和 `without`

聚合时，PromQL 会决定保留哪些 label。

### 7.1 `by`

```promql
sum(rate(http_requests_total[5m])) by (service)
```

意思是：

```text
按 service 分组聚合，只保留 service 标签
```

结果可能是：

```text
{service="order"} 100
{service="pay"} 50
```

其他标签如 instance、status、method 会被聚合掉。

### 7.2 `without`

```promql
sum(rate(http_requests_total[5m])) without (instance)
```

意思是：

```text
除了 instance 之外，其他标签相同的时间序列聚合到一起
```

---

## 8. 错误率计算

常见写法：

```promql
sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
/
sum(rate(http_requests_total[5m])) by (service)
```

含义：

```text
每个 service 最近 5 分钟的 5xx 请求速率 / 总请求速率
```

如果要告警，可以加阈值：

```promql
sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
/
sum(rate(http_requests_total[5m])) by (service)
> 0.05
```

表示 5xx 错误率超过 5%。

---

## 9. Histogram 分位数

Histogram 会暴露 bucket 指标，例如：

```promql
http_request_duration_seconds_bucket{le="0.1"}
http_request_duration_seconds_bucket{le="0.5"}
http_request_duration_seconds_bucket{le="1"}
http_request_duration_seconds_bucket{le="+Inf"}
```

计算 P99 延迟常见写法：

```promql
histogram_quantile(
  0.99,
  sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service)
)
```

注意：Histogram 算分位数是估算，因为它只知道每个 bucket 里有多少样本，不知道 bucket 内部每个样本的真实值。

```text
输入：
  q: 分位数，例如 0.99
  buckets: 按 le 排序后的累积 bucket

步骤：
  1. 找到总样本数 total
     total = le="+Inf" 的 bucket count

  2. 计算目标位置
     rank = q * total

  3. 找到第一个 count >= rank 的 bucket
     这个 bucket 就是目标分位数所在的 bucket

  4. 找到前一个 bucket
     prevCount = 前一个 bucket 的累积 count
     prevUpperBound = 前一个 bucket 的 le

  5. 计算当前 bucket 内的样本数
     bucketCount = currentCount - prevCount

  6. 计算目标 rank 在当前 bucket 内的位置
     rankInBucket = rank - prevCount

  7. 假设 bucket 内部均匀分布，做线性插值
     result = bucketStart + (bucketEnd - bucketStart) * (rankInBucket / bucketCount)
```

---

## 10. Summary

Summary 也用于记录观测值分布，例如请求延迟、RPC 耗时、任务耗时。

它通常暴露：

```promql
http_request_duration_seconds{quantile="0.5"}
http_request_duration_seconds{quantile="0.9"}
http_request_duration_seconds{quantile="0.99"}

http_request_duration_seconds_sum
http_request_duration_seconds_count
```

含义：

```text
quantile="0.99"：客户端提前算好的 P99
_sum：所有观测值的总和
_count：观测次数
```

Summary 会暴露预计算的 quantile，而 Histogram 暴露的是 bucket。两者都会暴露 `_sum` 和 `_count`。

---

## Summary 的分位数怎么算

和 Histogram 不同，Summary 的 P99 **不是 Prometheus 查询时算的**，而是客户端在程序里边 observe 边维护。

例如代码里不断执行：

```text
observe(0.12)
observe(0.35)
observe(0.80)
observe(0.20)
observe(0.42)
observe(1.10)
observe(0.18)
observe(0.67)
```

Summary 不会保存所有原始样本，否则内存会无限增长。

它一般维护一个**近似分位数数据结构**，也可以理解成：

```text
保留一小部分有代表性的样本
每个样本记录它大概覆盖的排名范围
查询 P99 时，返回一个排名接近 99% 位置的值
```

Go client 的 Summary 配置里有 `Objectives`，例如：

```go
Objectives: map[float64]float64{
    0.99: 0.001,
}
```

意思是：查询 `0.99` 时，返回值对应的真实分位点允许落在 `0.99 ± 0.001` 之间，也就是 `0.989 ~ 0.991`。注意这个误差是**排名误差**，不是延迟值误差。

---

## 抽象算法

可以把 Summary 的 quantile 估算理解成这样：

```text
输入：
  q：目标分位数，例如 0.99
  ε：允许的排名误差，例如 0.001
  samples：不断 observe 进来的观测值

内部维护：
  一个按 value 排序的压缩样本集合
  每个样本大致记录：
   value：观测值
   rank range：这个值可能处于的排名范围

步骤：
  1. 每 observe 一个值 v，把 v 插入到内部结构中

  2. 内部结构按 value 排序

  3. 为了节省内存，客户端会定期压缩相邻样本
     只要压缩后仍满足误差要求，就可以丢掉部分样本

  4. 查询 quantile=q 时：
     total = 当前样本总数
     targetRank = q * total

  5. 找到一个 value
     它的可能排名范围覆盖 targetRank
     或者足够接近 targetRank

  6. 返回这个 value
```

用更抽象的话说：

```text
Summary 不是按 bucket 插值；
Summary 是维护一个压缩后的有序样本摘要，然后按目标 rank 查值。
```

---

## 具体例子

假设 Summary 配置：

```text
quantile = 0.99
error = 0.001
```

现在最近窗口内有：

```text
total = 10000 个观测值
```

P99 的目标排名是：

```text
targetRank = 0.99 * 10000 = 9900
```

因为允许误差是 `0.001`，所以允许的排名范围是：

```text
lowerRank = 0.989 * 10000 = 9890
upperRank = 0.991 * 10000 = 9910
```

也就是说，客户端返回的值不一定刚好是第 `9900` 个样本。

只要它对应的真实排名大概在：

```text
第 9890 个 ~ 第 9910 个
```

之间，就满足这个 Summary 的精度要求。

假设内部压缩结构里有一个候选值：

```text
value = 0.83s
可能排名范围 = 9898 ~ 9908
```

这个范围覆盖了目标排名 `9900`，所以 Summary 可以返回：

```promql
http_request_duration_seconds{quantile="0.99"} 0.83
```

这个 `0.83s` 就是客户端估算出来的 P99。

---

## Summary 的时间窗口

Summary 的 quantile 通常还有一个客户端侧的时间窗口概念。以 Go client 为例，`MaxAge` 决定观测值对 quantile 保持相关的时间，`AgeBuckets` 用来分桶轮转淘汰旧数据；但这些只影响预计算 quantile，不影响 `_sum` 和 `_count`。

所以 Summary 的窗口不是你在 PromQL 里临时指定的：

```promql
xxx{quantile="0.99"}[5m]
```

不是这么算 P99 的。

Summary 的 P99 是客户端已经算好的，Prometheus 只是把它 scrape 过来。

---

## Summary 为什么不能聚合

错误写法：

```promql
avg(http_request_duration_seconds{quantile="0.99"}) by (service)
```

原因：

```text
多个实例 P99 的平均值，不等于整个服务的 P99。
```

例如：

```text
pod-a：100 个请求，P99 = 100ms
pod-b：10000 个请求，P99 = 900ms
```

平均以后是：

```text
(100ms + 900ms) / 2 = 500ms
```

但 `500ms` 不是整个 service 的 P99。

因为 P99 是分布位置，不是普通数值。Summary 的 quantile 已经在每个客户端本地算完了，Prometheus 拿不到原始分布，所以不能重新合成整体 P99。

---

## 11. PromQL 和告警粒度

告警产生几条，取决于 PromQL 最后返回几个不同 label set。

### 11.1 实例级告警

```promql
up{job="api"} == 0
```

如果 A、B 都挂了，返回：

```text
{job="api", instance="A"} 0
{job="api", instance="B"} 0
```

会产生 2 条告警。

---

### 11.2 job 级告警

```promql
sum(up{job="api"} == 0) by (job) > 0
```

如果 A、B 都挂了，返回：

```text
{job="api"} 2
```

会产生 1 条告警，而且没有 instance 标签。

---

### 11.3 全局级告警

```promql
sum(up == 0) > 0
```

所有标签都被聚合掉，结果类似：

```text
{} 2
```

会产生 1 条全局告警。

---

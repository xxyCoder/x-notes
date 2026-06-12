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

---

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

---

## 10. PromQL 和告警粒度

告警产生几条，取决于 PromQL 最后返回几个不同 label set。

### 10.1 实例级告警

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

### 10.2 job 级告警

```promql
sum(up{job="api"} == 0) by (job) > 0
```

如果 A、B 都挂了，返回：

```text
{job="api"} 2
```

会产生 1 条告警，而且没有 instance 标签。

---

### 10.3 全局级告警

```promql
sum(up == 0) > 0
```

所有标签都被聚合掉，结果类似：

```text
{} 2
```

会产生 1 条全局告警。

---

## 11. PromQL 常见心智模型

```text
range vector：每条时间序列自己的一段历史样本
instant vector：某个时间点的一组时间序列当前值
普通聚合函数：跨多条时间序列计算
_over_time 函数：单条时间序列在时间窗口内计算
rate：Counter 每秒增长速率
increase：Counter 在窗口内总增长量
by：聚合后保留哪些标签
PromQL 最终返回几个 label set，就可能产生几条告警
```

## 1. Recording Rules 是什么

Recording Rules 用来**周期性执行 PromQL 表达式**，并把计算结果写回 Prometheus TSDB，形成新的时间序列。

简单理解：

```text
raw metrics
  ↓ scrape
Prometheus TSDB
  ↓ 定时执行 PromQL
recording rule
  ↓ 写回 TSDB
new metric
  ↓
Grafana / Alerting rule 查询新 metric
```

它不是查询缓存，而是：

```text
定时刷新的物化 PromQL 结果
```

类比数据库：

```text
普通 PromQL 查询 ≈ 每次现场 SELECT
Recording rule ≈ 定时刷新的物化视图
```

---

## 2. 它解决什么问题

Recording rule 的核心价值不是“能算出新东西”，而是：

```text
把查询时重复计算，移动到后台周期性计算。
```

没有 recording rule 时：

```text
Grafana 每次打开 dashboard
Prometheus 都要现场执行原始 PromQL
```

有 recording rule 时：

```text
Prometheus 后台按 interval 周期性计算
Grafana / Alert 直接读取已经写好的新指标
```

所以它的收益主要来自：

```text
一次后台预计算，多次查询复用
```

---

## 3. 它不是性能魔法

Recording rule 并不会让计算消失。

后台仍然会完整执行 expr。

例如：

```yaml
groups:
  - name: api.rules
    interval: 30s
    rules:
      - record: job:http_requests:rate5m
        expr: sum by(job)(rate(http_requests_total[5m]))
```

含义是：

```text
Prometheus 每 30 秒执行一次：
sum by(job)(rate(http_requests_total[5m]))
```

也就是说：

```text
后台还是要算，只是从查询路径移动到了周期性后台任务里。
```

---

## 4. 为什么 Grafana 查询会变轻

假设 Grafana 查询最近 6 小时，step = 30s。

如果直接查原始表达式：

```promql
sum by(job)(rate(http_requests_total[5m]))
```

Prometheus 大约要对很多时间点重复计算：

```text
6 小时 / 30 秒 = 720 个 evaluation points
```

每个点都要：

```text
取过去 5 分钟样本
计算 rate
按 job 聚合
```

如果使用 recording rule，Grafana 查询的是：

```promql
job:http_requests:rate5m
```

这时主要是读取已经写好的结果点，而不是重新对每个点执行原始复杂表达式。

所以更准确地说：

```text
Recording rule 把查询时批量重算历史，变成后台随时间增量产生结果。
```

---

## 5. 配置位置

Recording rules 不写在 `scrape_configs` 里，而是写在独立的 rule 文件中。

主配置示例：

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 30s

rule_files:
  - "rules/*.yml"

scrape_configs:
  - job_name: "api"
    static_configs:
      - targets: ["localhost:8000"]
```

规则文件示例：

```yaml
# rules/api.rules.yml
groups:
  - name: api.rules
    interval: 30s
    rules:
      - record: job:http_requests:rate5m
        expr: sum by(job)(rate(http_requests_total[5m]))
```

---

## 6. group / interval / record / expr

基本结构：

```yaml
groups:
  - name: <rule_group_name>
    interval: <执行频率>
    rules:
      - record: <新指标名>
        expr: <PromQL 表达式>
```

含义：

```text
group    一组规则
interval 这组规则多久执行一次
record   新生成的 metric name
expr     要执行的 PromQL 表达式
```

例子：

```yaml
groups:
  - name: http.rules
    interval: 1m
    rules:
      - record: job:http_requests:rate5m
        expr: sum by(job)(rate(http_requests_total[5m]))

      - record: job:http_requests_errors:rate5m
        expr: sum by(job)(rate(http_requests_total{status=~"5.."}[5m]))
```

生成的新指标大概类似：

```text
job:http_requests:rate5m{job="api"} 123.4
job:http_requests_errors:rate5m{job="api"} 2.1
```

---

## 7. 三个时间概念

容易混淆的是：

```text
scrape_interval
rule interval / evaluation_interval
rate[5m]
```

示例：

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 30s
```

配合：

```promql
rate(http_requests_total[5m])
```

含义是：

```text
scrape_interval = 15s
原始指标每 15 秒 scrape 一次。

rule interval = 30s
recording rule 每 30 秒执行一次。

rate[5m]
每次执行时，从 TSDB 里取当前 evaluation 时间点之前 5 分钟的样本，计算 counter 的每秒平均增长速率。
```

例子：

```text
t = 12:00:00
执行 rule，读取 11:55:00 ~ 12:00:00 的样本。

t = 12:00:30
再次执行 rule，读取 11:55:30 ~ 12:00:30 的样本。

t = 12:01:00
再次执行 rule，读取 11:56:00 ~ 12:01:00 的样本。
```

---

## 8. 常见用途

### 8.1 预计算请求速率

```yaml
- record: job:http_requests:rate5m
  expr: sum by(job)(rate(http_requests_total[5m]))
```

Grafana 查询：

```promql
job:http_requests:rate5m
```

---

### 8.2 预计算错误请求速率

```yaml
- record: job:http_requests_errors:rate5m
  expr: sum by(job)(rate(http_requests_total{status=~"5.."}[5m]))
```

---

### 8.3 预计算错误率

生产里通常先拆分分子和分母：

```yaml
- record: job:http_requests:rate5m
  expr: sum by(job)(rate(http_requests_total[5m]))

- record: job:http_requests_errors:rate5m
  expr: sum by(job)(rate(http_requests_total{status=~"5.."}[5m]))

- record: job:http_requests_errors_per_requests:ratio_rate5m
  expr: |
    job:http_requests_errors:rate5m
    /
    job:http_requests:rate5m
```

这样做的好处：

```text
1. dashboard 可以单独看总 QPS
2. dashboard 可以单独看 5xx QPS
3. alert 可以直接使用错误率
4. 中间结果可以复用
5. 排查时更容易判断是分子涨了，还是分母跌了
```

---

### 8.4 预计算 P99 延迟

原始查询：

```promql
histogram_quantile(
  0.99,
  sum by(job, le)(
    rate(http_request_duration_seconds_bucket[5m])
  )
)
```

Recording rule：

```yaml
- record: job:http_request_duration_seconds:p99_rate5m
  expr: |
    histogram_quantile(
      0.99,
      sum by(job, le)(
        rate(http_request_duration_seconds_bucket[5m])
      )
    )
```

注意：

```text
histogram_quantile 之前必须保留 le 标签。
```

否则 Prometheus 不知道 bucket 边界，无法估算分位数。

---

## 9. Recording rule 和 Alerting rule 的关系

Recording rule 负责产出新指标。

Alerting rule 负责判断是否告警。

例如：

```yaml
- record: job:http_requests_errors_per_requests:ratio_rate5m
  expr: |
    job:http_requests_errors:rate5m
    /
    job:http_requests:rate5m
```

Alert rule 可以直接使用：

```yaml
- alert: HighErrorRate
  expr: job:http_requests_errors_per_requests:ratio_rate5m > 0.05
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "High error rate on {{ $labels.job }}"
```

这样 dashboard 和 alert 可以复用同一套计算口径。

---

## 10. 什么时候适合用 Recording rule

适合：

```text
1. 查询频率高
2. PromQL 计算重
3. 查询逻辑稳定
4. 多个 dashboard / alert 复用
5. 长时间范围查询经常执行
6. histogram_quantile / 大规模聚合这类昂贵查询
```

一句话：

```text
高频 + 昂贵 + 稳定复用
```

---

## 11. 什么时候不适合用 Recording rule

不适合：

```text
1. 临时排障查询
2. 查询频率很低
3. 查询本身很轻
4. 维度太细，容易制造高基数
5. 计算口径还在探索阶段，没有稳定下来
```

例如：

```promql
up
```

不适合，太轻。

```promql
sum by(instance)(rate(node_cpu_seconds_total[5m]))
```

如果只是偶尔排障使用，也不适合。

```promql
sum by(user_id, path)(rate(http_requests_total[5m]))
```

通常不适合，容易产生高基数 recording series。

---

## 12. 主要代价

Recording rule 不是免费优化。

它会带来：

```text
1. 新时间序列，增加存储
2. 后台持续 rule evaluation 压力
3. 如果 label 保留过多，会制造高基数
4. 如果表达式设计有问题，坏结果会被周期性写入 TSDB
```

尤其要注意：

```text
即使没人打开 Grafana，recording rule 也会一直按 interval 执行。
```

所以低频查询做成 recording rule 反而可能亏。

---

## 13. 高基数风险

错误示例：

```yaml
- record: instance_path_user:http_requests:rate5m
  expr: sum by(instance, path, user_id)(rate(http_requests_total[5m]))
```

问题：

```text
保留了 instance、path、user_id 等高基数维度。
recording rule 会把这些组合结果也写成新的 series。
```

如果 `user_id` 很多，会制造大量新时间序列。

合理的 recording rule 通常保留稳定、低基数、真正需要复用的维度，例如：

```text
job
instance
cluster
model
status
```

是否保留某个 label，要先问：

```text
Grafana / Alert 真的需要按这个维度长期查看吗？
```

---

## 14. 检查规则

检查 rule 文件：

```bash
promtool check rules rules/api.rules.yml
```

检查 Prometheus 主配置：

```bash
promtool check config prometheus.yml
```

修改规则后的基本流程：

```text
1. 修改 rules/*.yml
2. promtool check rules
3. promtool check config
4. reload Prometheus
5. 在 Prometheus UI 里查询新 record 指标是否生成
```

---

## 1. TSDB 是什么

TSDB 全称是 **Time Series Database**，即时间序列数据库。

它专门存储这种数据：

```text
某个对象，在某个时间点，有一个数值
```

例如：

```text
12:00:00 CPU 使用率 = 30%
12:00:15 CPU 使用率 = 35%
12:00:30 CPU 使用率 = 28%
```

Prometheus 存储的核心不是普通表结构，而是大量时间序列。

---

## 2. Series 和 Sample

Prometheus 中一条数据可以拆成：

```text
metric name + labels + timestamp + value
```

例如：

```text
http_requests_total{job="api", instance="A", status="200"} 100 @ 12:00:00
```

其中：

```text
metric name + 完整 labels = 一条 time series
```

例如下面是 4 条不同的 series：

```text
http_requests_total{job="api", instance="A", status="200"}
http_requests_total{job="api", instance="A", status="500"}
http_requests_total{job="api", instance="B", status="200"}
http_requests_total{job="api", instance="B", status="500"}
```

虽然 metric name 都是 `http_requests_total`，但 labels 不完全相同，所以是不同的 series。

一条 series 会不断追加 sample：

```text
http_requests_total{job="api", instance="A", status="200"}

12:00:00 -> 100
12:00:15 -> 130
12:00:30 -> 160
12:00:45 -> 190
```

每一个：

```text
timestamp + value
```

就是一个 sample。

可以类比为：

```text
series = 折线图中的一条线
sample = 这条线上的一个点
```

---

## 3. samples/s 怎么计算

如果 Prometheus 每次 scrape 都给每条 active series 写入一个 sample，那么：

```text
samples_per_second = active_series / scrape_interval_seconds
```

例如：

```text
active_series = 300,000
scrape_interval = 15s
```

那么：

```text
300,000 / 15 = 20,000 samples/s
```

也就是每秒大约写入 2 万个 sample。

几个直觉：

```text
active_series 越多，写入越高
scrape_interval 越短，写入越高
scrape_interval 从 15s 改成 30s，samples/s 大约减半
```

---

## 4. retention 是什么

`retention` 表示 Prometheus 本地数据保留多久或保留多大。

常见参数：

```bash
--storage.tsdb.retention.time=15d
```

表示本地 TSDB 最多保留约 15 天数据。

也可以限制容量：

```bash
--storage.tsdb.retention.size=500GB
```

表示 TSDB blocks 最多保留约 500GB。

如果同时配置：

```bash
--storage.tsdb.retention.time=15d
--storage.tsdb.retention.size=500GB
```

可以理解为：

```text
时间先到，就按时间删旧 block
容量先到，就按容量删旧 block
```

注意：删除通常按 block 粒度发生，不是逐个 sample 精确删除。

---

## 5. 总样本数估算

核心公式：

```text
total_samples = active_series / scrape_interval_seconds * retention_seconds
```

例如：

```text
active_series = 200,000
scrape_interval = 20s
retention = 1 day
```

计算：

```text
200,000 / 20 * 24 * 60 * 60
= 10,000 * 86,400
= 864,000,000 samples/day
```

一天大约产生 8.64 亿个 sample。

---

## 6. 磁盘容量粗估

Prometheus 本地 TSDB 的样本压缩后，工程粗估可以先按：

```text
1 ~ 2 bytes/sample
```

为了保守估算，可以用：

```text
2 bytes/sample
```

容量公式：

```text
disk ≈ active_series / scrape_interval_seconds * retention_seconds * bytes_per_sample
```

例如：

```text
active_series = 300,000
scrape_interval = 15s
retention = 1 day
bytes_per_sample = 2
```

计算：

```text
300,000 / 15 * 24 * 60 * 60 * 2 / 1024 / 1024 / 1024
```

拆开：

```text
300,000 / 15 = 20,000 samples/s
20,000 * 86,400 = 1,728,000,000 samples/day
1,728,000,000 * 2 = 3,456,000,000 bytes
3,456,000,000 / 1024 / 1024 / 1024 ≈ 3.22 GiB
```

所以：

```text
300k active series，15s scrape，1 天样本数据粗估 ≈ 3.2 GiB
```

如果按十进制 GB 粗估，大约是 3.46 GB。

---

## 7. 为什么 sample 可以这么小

直觉上：

```text
timestamp 可能 8 bytes
value 可能 8 bytes
```

似乎每个 sample 至少 16 bytes。

但时间序列数据有规律：

```text
12:00:00 -> 100
12:00:15 -> 103
12:00:30 -> 106
12:00:45 -> 110
```

timestamp 往往固定间隔增长，value 也通常平滑变化。

所以 TSDB 不会傻存完整的 timestamp/value，而是压缩存储变化量。

可以理解为：

```text
第一个点完整存
后面的点主要存 delta / 变化量
```

因此 chunks 中的样本数据可以被压缩到较小体积。

---

## 8. Block、Chunk、Index、Series、Sample 的关系

Prometheus 本地 TSDB 按时间范围组织成 block。

一个 block 可以理解成：

```text
某一段时间范围内的一个小型 TSDB
```

例如：

```text
block: 10:00 ~ 12:00
```

目录结构大致类似：

```text
data/
  01HABCDEF.../
    chunks/
      000001
      000002
    index
    meta.json
    tombstones
```

核心包含关系：

```text
TSDB
└── block
    ├── index
    │   └── 记录 label、series、chunk 引用
    │
    └── chunks
        └── chunk
            └── samples
```

更直观地说：

```text
series = 折线图里的一条线
sample = 线上的一个点
chunk = 这条线的一段点集合
block = 某段时间内很多条线的数据包
index = 目录，帮你找到线和线的数据位置
```

---

## 9. 用实际例子理解 index 和 chunks

假设有两条 series：

```text
http_requests_total{job="api", instance="A", status="200"}
http_requests_total{job="api", instance="A", status="500"}
```

它们属于 10:00 ~ 12:00 这个 block。

这个 block 内部可以理解成：

```text
block 10:00 ~ 12:00
├── index
│   ├── 记录有哪些 label
│   │   ├── __name__="http_requests_total"
│   │   ├── job="api"
│   │   ├── instance="A"
│   │   ├── status="200"
│   │   └── status="500"
│   │
│   ├── 记录有哪些 series
│   │   ├── series_id=1:
│   │   │   http_requests_total{job="api", instance="A", status="200"}
│   │   │
│   │   └── series_id=2:
│   │       http_requests_total{job="api", instance="A", status="500"}
│   │
│   └── 记录 series 对应哪些 chunk
│       ├── series_id=1 -> chunk_ref_1
│       └── series_id=2 -> chunk_ref_2
│
└── chunks
    ├── chunk_ref_1
    │   ├── 10:00:00 -> 100
    │   ├── 10:00:15 -> 120
    │   ├── 10:00:30 -> 150
    │   └── 10:00:45 -> 180
    │
    └── chunk_ref_2
        ├── 10:00:00 -> 3
        ├── 10:00:15 -> 4
        ├── 10:00:30 -> 4
        └── 10:00:45 -> 5
```

查询流程大致是：

```text
label matcher
  ↓
index 找到符合条件的 series
  ↓
series 记录里有 chunk 引用
  ↓
去 chunks 文件读 samples
```

一句话：

```text
index 负责“找到哪条线”，chunk 负责“存这条线上的点”。
```

---

## 10. 写入路径：WAL、Head、Block

Prometheus scrape 到一个 sample 后，不是马上直接写入最终 block。

大致路径：

```text
scrape sample
  ↓
WAL
  ↓
Head block
  ↓
持久化成 2h block
  ↓
compaction 合并更大 block
```

### WAL

WAL 全称：

```text
Write-Ahead Log
预写日志
```

作用：

```text
先记录最近写入，防止 Prometheus 崩溃后丢失还没落成 block 的数据。
```

可以类比 MySQL 的 redo log，但不要完全等同。

重点：

```text
WAL = 最近写入的恢复日志
```

### Head

Head 是最近数据的活跃写入区。

例如：

```promql
rate(http_requests_total[5m])
```

这种查询通常主要读取 Head 中的最近样本。

重点：

```text
Head = 最近数据 + 活跃写入区
```

### Block

过一段时间后，Head 中的数据会被切成磁盘上的 block。

初始 block 通常可以理解为约 2 小时时间范围：

```text
10:00 ~ 12:00 一个 block
12:00 ~ 14:00 一个 block
14:00 ~ 16:00 一个 block
```

重点：

```text
Block = 已经固化的历史数据包
```

三者一句话总结：

```text
WAL 保命，Head 承接最近写入，Block 保存历史数据。
```

---

## 11. 为什么按 block 组织

如果每个 sample 都单独落盘，会产生大量小文件。

如果所有数据都放在一个巨大文件中，又会导致：

```text
查询范围不好裁剪
删除过期数据困难
压缩整理困难
损坏影响范围大
```

按 block 组织的好处：

```text
1. 按时间组织数据
2. 查询某个时间范围时可以定位相关 block
3. retention 删除过期数据时可以整块删除
4. compaction 可以把多个小 block 合并整理
```

例如：

```text
block A: 10:00 ~ 12:00
block B: 12:00 ~ 14:00
block C: 14:00 ~ 16:00
```

如果 `10:00 ~ 12:00` 已经过期，可以直接删除整个 block 目录，而不是逐条删除 sample。

---

## 12. Compaction 是什么

Compaction 就是：

```text
后台把多个小 block 合并整理成更大的 block。
```

例如：

```text
10:00 ~ 12:00
12:00 ~ 14:00
14:00 ~ 16:00
16:00 ~ 18:00
```

可能被合并为：

```text
10:00 ~ 18:00
```

作用：

```text
1. 减少 block 数量
2. 减少查询时要打开的 block
3. 整理 index / chunks
4. 清理 tombstones 删除标记
```

注意：

```text
初始落盘通常是 2h block，但 compaction 后磁盘上不一定只剩 2h block。
```

---

## 13. retention.time / retention.size 的生产理解

生产里通常不要只配 `retention.time`。

原因是：

```text
如果 active series 突然暴涨，15 天还没到，磁盘可能已经先满。
```

也不要把 `retention.size` 设置得接近整块数据盘容量。

例如，数据盘是 500GB，不建议：

```bash
--storage.tsdb.retention.size=500GB
```

原因是除了 blocks，还有：

```text
WAL
Head
compaction 临时空间
文件系统开销
突发增长余量
```

更合理的理解：

```text
retention.time 控制“业务想看多久历史”
retention.size 控制“磁盘别被打满”
```

如果机器磁盘是 1TB，可能会考虑类似：

```bash
--storage.tsdb.retention.time=15d
--storage.tsdb.retention.size=700GB
```

含义：

```text
最多保留 15 天
但如果数据增长太快，达到容量限制就提前删除旧 block
```

---

## 14. active series 比 metric name 更重要

Prometheus 容量压力主要来自：

```text
active series 数量
```

不是单纯的 metric name 数量。

例如只有一个指标名：

```text
api_requests_total
```

但它有这些 label：

```text
method: 4 种
status: 5 种
instance: 20 台
```

理论 series 数：

```text
4 * 5 * 20 = 400
```

如果再加一个：

```text
user_id: 100,000 个
```

就会变成：

```text
4 * 5 * 20 * 100,000 = 40,000,000 series
```

这就是高基数灾难。

---

## 15. 高基数 label 的风险

高基数 label 指的是：

```text
某个 label 有非常多可能取值
```

常见危险 label：

```text
user_id
request_id
trace_id
session_id
email
ip
订单号
容器短生命周期 ID
完整 URL path
```

错误例子：

```text
http_requests_total{job="api", path="/api/users/123456/profile", status="200"}
```

如果 `123456` 是用户 ID，那么每个用户都会制造一个新的 `path` 值。

更合理写法：

```text
http_requests_total{job="api", path="/api/users/:id/profile", status="200"}
```

或者：

```text
http_requests_total{job="api", route="/api/users/{id}/profile", status="200"}
```

原则：

```text
监控指标里的 label 应该描述“类别”，不要描述“具体请求实例”。
```

高基数会同时影响：

```text
1. 写入 samples/s
2. chunks 样本数据大小
3. index 大小
4. Head 内存
5. 查询扫描 series 的成本
6. compaction 压力
```

---

## 16. scrape_interval 对容量的影响

公式：

```text
samples_per_second = active_series / scrape_interval_seconds
```

例如 active series 固定为 300,000：

```text
scrape_interval = 15s
300,000 / 15 = 20,000 samples/s
```

如果改成：

```text
scrape_interval = 30s
300,000 / 30 = 10,000 samples/s
```

写入量大约减半，磁盘增长也大约减半。

但代价是：

```text
数据分辨率降低
短暂抖动更不容易看见
rate / alert 的响应可能变慢
```

常见思路：

```text
核心服务：15s 或 30s
普通基础设施：30s 或 60s
低频状态类指标：60s 或更长
```

具体要结合告警敏感度、数据量和 Prometheus 规模判断。

---

## 17. 容量规划时不能只看 sample 粗估

如果 sample 粗估需要 50GB，不能只给 50GB 磁盘。

因为实际还要考虑：

```text
WAL
Head
index
compaction 临时空间
metadata
文件系统开销
增长余量
磁盘安全水位
```

所以：

```text
sample 粗估 = 基础下限
生产磁盘规划 = sample 粗估 + 多种额外开销 + 安全余量
```

---
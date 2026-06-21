# 1. Scrape 基本模型

Prometheus 默认采用 **Pull 模型**：

```text
Prometheus 定期访问 target 的 metrics endpoint
↓
拉取 Prometheus 文本格式指标
↓
解析并写入 TSDB
```

最小配置：

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: "api"
    static_configs:
      - targets:
          - "localhost:8080"
```

核心概念：

```text
scrape_configs = 抓取任务列表
job_name       = 一组 targets 的逻辑名称
targets        = 真正被抓取的 host:port
```

默认情况下，Prometheus 会请求：

```text
http://localhost:8080/metrics
```

---

# 2. `job` / `instance`

Prometheus 抓取 target 后，会自动给时间序列补充标签。

例如：

```yaml
scrape_configs:
  - job_name: "node"
    static_configs:
      - targets:
          - "10.0.0.1:9100"
          - "10.0.0.2:9100"
```

会生成类似：

```promql
up{job="node", instance="10.0.0.1:9100"} 1
up{job="node", instance="10.0.0.2:9100"} 1
```

含义：

```text
job      = 来自 job_name，表示一类服务
instance = 默认来自 target 地址，表示具体实例
```

可以先这样记：

```text
job      = 一类服务
instance = 这类服务里的某一个实例
```

---

# 3. `static_configs`

`static_configs` 是最直接的 target 配置方式。

```yaml
scrape_configs:
  - job_name: "vllm"
    static_configs:
      - targets:
          - "10.0.0.11:8000"
          - "10.0.0.12:8000"
        labels:
          env: "prod"
          cluster: "gpu-a"
```

结果：

```promql
up{job="vllm", instance="10.0.0.11:8000", env="prod", cluster="gpu-a"}
up{job="vllm", instance="10.0.0.12:8000", env="prod", cluster="gpu-a"}
```

理解：

```text
targets = 要抓谁
labels  = 给这一组 targets 增加公共标签
```

适合：

```text
实例固定
规模较小
地址变化不频繁
```

不适合：

```text
实例经常扩缩容
IP 经常变化
服务实例由注册中心动态维护
```

---

# 4. 抓取 URL 组成

Prometheus 实际抓取 URL 可以抽象成：

```text
scheme + "://" + target + metrics_path
```

默认值：

```text
scheme       = http
metrics_path = /metrics
```

所以：

```yaml
targets:
  - "10.0.0.5:8080"
```

默认请求：

```text
http://10.0.0.5:8080/metrics
```

## 4.1 `metrics_path`

如果服务暴露路径不是 `/metrics`：

```yaml
scrape_configs:
  - job_name: "spring-api"
    metrics_path: /actuator/prometheus
    static_configs:
      - targets:
          - "10.0.0.5:8080"
```

请求：

```text
http://10.0.0.5:8080/actuator/prometheus
```

## 4.2 `scheme`

如果服务是 HTTPS：

```yaml
scrape_configs:
  - job_name: "gateway"
    scheme: https
    metrics_path: /internal/metrics
    static_configs:
      - targets:
          - "gw.example.com:9443"
```

请求：

```text
https://gw.example.com:9443/internal/metrics
```

---

# 5. `scrape_interval` / `scrape_timeout`

## 5.1 全局默认

```yaml
global:
  scrape_interval: 15s
  scrape_timeout: 10s
```

含义：

```text
scrape_interval = 多久发起一次抓取
scrape_timeout  = 单次抓取最多等多久
```

## 5.2 Job 级覆盖

```yaml
global:
  scrape_interval: 20s
  scrape_timeout: 5s

scrape_configs:
  - job_name: "vllm"
    scrape_interval: 10s
    static_configs:
      - targets:
          - "10.0.0.11:8000"

  - job_name: "node"
    static_configs:
      - targets:
          - "10.0.0.1:9100"
```

结果：

```text
vllm:
  每 10 秒抓一次
  单次最多等 5 秒

node:
  每 20 秒抓一次
  单次最多等 5 秒
```

规则：

```text
job 配了 scrape_interval，就用 job 的
job 没配，就用 global 的

scrape_timeout 同理
```

---

# 6. 服务发现 Service Discovery

服务发现的核心：

```text
Prometheus 不一定从 prometheus.yml 里拿固定 targets；
它可以从外部系统动态发现 targets。
```

常见来源：

```text
file_sd_configs       读取本地 JSON/YAML 文件
http_sd_configs       请求 HTTP 接口获取 targets
dns_sd_configs        解析 DNS 获取 targets
consul_sd_configs     从 Consul 获取服务实例
kubernetes_sd_configs 从 Kubernetes API 获取 Pod/Service/Endpoint 等
ec2_sd_configs        从云 API 获取实例
```

本轮重点学习：

```text
file_sd_configs
http_sd_configs
dns_sd_configs
```

暂不展开 Kubernetes。

---

# 7. `file_sd_configs`

`file_sd_configs` 可以理解为：

```text
Prometheus 主配置只写“去哪个文件找 targets”
真实 targets 写在外部文件里
```

Prometheus 配置：

```yaml
scrape_configs:
  - job_name: "vllm"
    file_sd_configs:
      - files:
          - "/etc/prometheus/targets/vllm.json"
```

外部文件 `/etc/prometheus/targets/vllm.json`：

```json
[
  {
    "targets": [
      "10.0.0.11:8000",
      "10.0.0.12:8000"
    ],
    "labels": {
      "env": "prod",
      "service": "vllm"
    }
  }
]
```

Prometheus 会抓：

```text
http://10.0.0.11:8000/metrics
http://10.0.0.12:8000/metrics
```

## 关键理解

`file_sd_configs` 本身不会凭空知道新实例。

它解决的是：

```text
Prometheus 主配置不用频繁改
targets 可以由外部文件动态提供
```

动态扩缩容能否生效，取决于：

```text
是否有外部机制及时更新 targets 文件
```

例如：

```text
CMDB / 注册中心 / 云 API / 脚本
        ↓
生成 targets 文件
        ↓
Prometheus file_sd_configs 读取
        ↓
scrape 当前 targets
```

如果文件没更新，新实例不会被抓到。

---

# 8. `http_sd_configs`

`http_sd_configs` 适合自研服务注册中心直接提供 targets 的场景。

配置：

```yaml
scrape_configs:
  - job_name: "vllm"
    scrape_interval: 10s

    http_sd_configs:
      - url: "http://registry.local/prometheus/targets"
        refresh_interval: 60s
```

服务发现接口返回：

```json
[
  {
    "targets": [
      "10.0.0.11:8000",
      "10.0.0.12:8000"
    ],
    "labels": {
      "env": "prod",
      "service": "vllm"
    }
  }
]
```

Prometheus 会：

```text
每 60 秒请求一次 registry 接口
每 10 秒抓一次已发现的 target
```

注意区分：

```text
refresh_interval = 多久刷新 target 列表
scrape_interval  = 多久抓取 target 的 metrics
```

抽象流程：

```text
每 refresh_interval:
  请求 HTTP SD 接口，更新 targets 列表

每 scrape_interval:
  抓取当前 targets 的 /metrics
```

---

# 9. `dns_sd_configs`

`dns_sd_configs` 表示 Prometheus 通过 DNS 解析发现 targets。

## 9.1 A 记录

配置：

```yaml
scrape_configs:
  - job_name: "node"
    dns_sd_configs:
      - names:
          - "nodes.internal"
        type: A
        port: 9100
        refresh_interval: 60s
```

如果 DNS 返回：

```text
10.0.0.1
10.0.0.2
```

Prometheus 会抓：

```text
http://10.0.0.1:9100/metrics
http://10.0.0.2:9100/metrics
```

理解：

```text
A 记录只返回 IP
port 需要在 Prometheus 配置里指定
```

## 9.2 SRV 记录

SRV 记录返回：

```text
host + port
```

例如：

```text
vllm-1.internal:8000
vllm-2.internal:8000
```

理解：

```text
A 记录：DNS 只告诉你 IP，端口靠 Prometheus 配置补
SRV 记录：DNS 告诉你 host 和 port
```

---

# 10. `relabel_configs`

`relabel_configs` 发生在 **scrape 之前**，处理的是 target。

用途：

```text
决定 target 要不要抓
改写 target 的标签
改写 __address__
改写 __metrics_path__
改写 __scheme__
```

流程：

```text
服务发现 / static_configs
        ↓
relabel_configs
        ↓
决定最终 targets
        ↓
scrape /metrics
```

## 10.1 `keep`

只保留匹配 target：

```yaml
relabel_configs:
  - source_labels: [env]
    regex: prod
    action: keep
```

含义：

```text
只抓 env=prod 的 target
不匹配的 target 丢弃
```

## 10.2 `drop`

丢弃匹配 target：

```yaml
relabel_configs:
  - source_labels: [env]
    regex: dev
    action: drop
```

含义：

```text
env=dev 的 target 不抓
```

## 10.3 `replace`

写入或覆盖某个标签：

```yaml
relabel_configs:
  - source_labels: [cluster_name]
    target_label: cluster
    action: replace
```

等价于：

```text
cluster = cluster_name 的值
```

注意：

```text
replace = set target_label
如果 target_label 不存在，就创建
如果 target_label 已存在，就覆盖
```

例如原始标签：

```text
cluster_name="gpu-b"
cluster="old"
```

经过规则后：

```text
cluster="gpu-b"
```

## 10.4 多个 `source_labels`

多个 source labels 会先拼接。

默认分隔符是：

```text
;
```

例如：

```yaml
relabel_configs:
  - source_labels: [env, service]
    regex: prod;vllm
    action: keep
```

如果 target 标签是：

```text
env="prod"
service="api"
```

拼接值是：

```text
prod;api
```

不匹配 `prod;vllm`，所以被丢弃。

也可以指定分隔符：

```yaml
relabel_configs:
  - source_labels: [env, service]
    separator: "/"
    regex: prod/vllm
    action: keep
```

---

# 11. 内部标签

Prometheus 在 target 处理阶段有一些特殊内部标签。

## 11.1 `__address__`

表示实际抓取地址：

```text
host:port
```

例如：

```text
__address__="10.0.0.11:8000"
```

默认最终 URL：

```text
http://__address__/metrics
```

可以通过 relabel 改写：

```yaml
relabel_configs:
  - source_labels: [__address__]
    regex: (.*)
    target_label: __address__
    replacement: $1:9100
    action: replace
```

如果原始：

```text
__address__="10.0.0.11"
```

结果：

```text
__address__="10.0.0.11:9100"
```

## 11.2 `__metrics_path__`

表示实际请求路径。

例如：

```text
__metrics_path__="/actuator/prometheus"
```

规则：

```yaml
relabel_configs:
  - source_labels: [metrics_path]
    target_label: __metrics_path__
    action: replace
```

如果：

```text
__address__="10.0.0.12:8000"
metrics_path="/actuator/prometheus"
```

最终请求：

```text
http://10.0.0.12:8000/actuator/prometheus
```

## 11.3 `__scheme__`

表示协议：

```text
http 或 https
```

规则：

```yaml
relabel_configs:
  - source_labels: [scheme]
    target_label: __scheme__
    action: replace
```

如果：

```text
__address__="gateway.example.com:9443"
scheme="https"
```

最终请求：

```text
https://gateway.example.com:9443/metrics
```

## 11.4 URL 公式

最终可以记成：

```text
__scheme__ + "://" + __address__ + __metrics_path__
```

---

# 12. `metric_relabel_configs`

`metric_relabel_configs` 发生在 **scrape 之后，写入 TSDB 之前**。

它处理的是：

```text
已经抓回来的 metric sample
```

用途：

```text
丢弃某些指标
删除某些标签
改写某些 metric 标签
降低写入量
控制高基数
```

流程：

```text
服务发现 / static_configs
        ↓
relabel_configs
        ↓
scrape /metrics
        ↓
metric_relabel_configs
        ↓
写入 TSDB
```

对比：

```text
relabel_configs        = 抓之前，处理 target，决定抓不抓
metric_relabel_configs = 抓之后，处理 metric，决定存不存
```

## 12.1 丢弃指标

```yaml
metric_relabel_configs:
  - source_labels: [__name__]
    regex: "debug_.*"
    action: drop
```

含义：

```text
指标名以 debug_ 开头的样本不写入 TSDB
```

例如抓回来：

```promql
debug_cache_items
http_requests_total
debug_worker_threads
up
```

最终写入：

```promql
http_requests_total
up
```

说明：

```text
__name__ = 指标名
```

---

# 13. `labeldrop` 与高基数风险

## 13.1 删除标签

```yaml
metric_relabel_configs:
  - regex: "user_id"
    action: labeldrop
```

`labeldrop` 匹配的是：

```text
标签名
```

不是标签值。

例如：

```promql
request_total{
  job="api",
  instance="10.0.0.5:8080",
  user_id="u123",
  status="200"
}
```

执行后：

```promql
request_total{
  job="api",
  instance="10.0.0.5:8080",
  status="200"
}
```

## 13.2 多个标签一起删除

```yaml
metric_relabel_configs:
  - regex: "user_id|request_id|trace_id"
    action: labeldrop
```

含义：

```text
删除标签名为 user_id、request_id、trace_id 的标签
```

## 13.3 风险：Series 冲突

原始两条：

```promql
request_total{job="api", user_id="u1", status="200"} 10
request_total{job="api", user_id="u2", status="200"} 20
```

删除 `user_id` 后都会变成：

```promql
request_total{job="api", status="200"}
```

这会导致：

```text
metric name 相同
labels 完全相同
同一次 scrape 中出现重复 series
```

重要结论：

```text
labeldrop 只是删标签，不做聚合
```

它不会自动变成：

```text
总请求数 = 10 + 20
```

如果想聚合，应该用 PromQL：

```promql
sum without(user_id) (request_total)
```

或者：

```promql
sum by (job, status) (request_total)
```

## 13.4 适合谨慎处理的高基数标签

常见不适合进 Prometheus 的标签：

```text
request_id
trace_id
span_id
user_id
session_id
payload_hash
```

但更推荐：

```text
从应用源头不要暴露这些高基数标签
```

而不是后面靠 `labeldrop` 强删。

不能随便删的标签：

```text
job
instance
status
method
route
le
quantile
```

尤其是 histogram 的：

```text
le
```

不能乱删，否则 bucket 语义会坏。

---

# 14. `honor_labels`

Prometheus 抓指标时，标签可能来自两个地方：

```text
1. Prometheus target 标签：job、instance、env、cluster 等
2. Exporter 暴露出来的指标标签
```

如果两边冲突，例如：

target 标签：

```text
job="api"
instance="10.0.0.5:8080"
```

exporter 暴露：

```promql
my_metric{job="custom"} 1
```

默认：

```yaml
honor_labels: false
```

表示：

```text
Prometheus 自己生成的 target 标签优先
```

最终类似：

```promql
my_metric{
  job="api",
  instance="10.0.0.5:8080",
  exported_job="custom"
}
```

如果：

```yaml
honor_labels: true
```

表示：

```text
尊重 exporter 暴露的标签
```

先记：

```text
honor_labels: false 默认值
  Prometheus target 标签优先

honor_labels: true
  exporter 暴露标签优先
```

普通业务服务、node exporter、常规 exporter 一般保持默认即可。

---

# 15. 抓取状态与排查指标

## 15.1 `up`

Prometheus 为每个 target 自动生成：

```promql
up
```

含义：

```text
up = 1  本次 scrape 成功
up = 0  本次 scrape 失败
```

例如：

```promql
up{job="vllm", instance="10.0.0.11:8000"} 0
```

表示：

```text
Prometheus 按配置抓这个 target，但这次失败了
```

可能原因：

```text
服务没启动
端口不通
metrics_path 配错
scheme 配错
scrape_timeout 太短
认证失败
TLS 配置错误
/metrics 返回格式不合法
网络不通
```

## 15.2 其他 scrape 指标

```promql
scrape_duration_seconds
```

表示本次 scrape 耗时。

```promql
scrape_samples_scraped
```

表示本次 scrape 抓到了多少 samples。

```promql
scrape_samples_post_metric_relabeling
```

表示经过 `metric_relabel_configs` 后还剩多少 samples。

例如：

```text
scrape_samples_scraped = 5000
scrape_samples_post_metric_relabeling = 3000
```

说明：

```text
抓回来 5000 个样本
metric_relabel_configs 丢掉了 2000 个
最终留下 3000 个
```

## 15.3 Targets 页面

Prometheus 页面：

```text
Status → Targets
```

常看字段：

```text
Endpoint
State
Labels
Last Scrape
Scrape Duration
Error
```

常见 Error：

```text
connection refused
  端口没人监听 / 服务没启动 / 端口错

context deadline exceeded
  请求超时 / 服务太慢 / 网络问题

server returned HTTP status 404
  metrics_path 配错

server returned HTTP status 401 / 403
  认证或权限问题

TLS handshake error
  HTTPS / 证书配置问题

text format parsing error
  /metrics 返回格式不符合 Prometheus exposition format
```

---

# 16. 抓取保护配置

这些配置用于防止异常 target 或异常服务发现结果打爆 Prometheus。

## 16.1 `sample_limit`

限制单个 target 单次 scrape 最多允许多少 samples。

```yaml
scrape_configs:
  - job_name: "api"
    sample_limit: 10000
    static_configs:
      - targets:
          - "10.0.0.5:8080"
```

含义：

```text
如果 metric relabel 之后 samples 数量超过 10000
这次 scrape 失败
```

注意：

```text
不是只取前 10000 个
而是整次 scrape 失败
```

## 16.2 `label_limit`

限制每个 sample 最多有多少个标签。

```yaml
label_limit: 30
```

例如：

```promql
request_total{
  job="api",
  instance="10.0.0.5:8080",
  method="GET",
  status="200",
  route="/v1/chat"
}
```

这条 sample 有 5 个标签：

```text
job
instance
method
status
route
```

如果：

```yaml
label_limit: 4
```

则超过限制，可能导致这次 scrape 失败。

## 16.3 标签长度限制

```yaml
label_name_length_limit: 100
label_value_length_limit: 200
```

含义：

```text
label_name_length_limit  = 标签名最长长度
label_value_length_limit = 标签值最长长度
```

## 16.4 `target_limit`

限制一个 scrape job 经过 target relabel 后最多允许多少 targets。

```yaml
scrape_configs:
  - job_name: "vllm"
    target_limit: 100
    http_sd_configs:
      - url: "http://registry.local/prometheus/vllm-targets"
```

如果服务发现返回 300 个 targets，而 `target_limit: 100`：

```text
不会正常 scrape 这 300 个 targets
```

作用：

```text
防止服务发现配置错误导致目标数量爆炸
```

## 16.5 区分

```text
target_limit:
  管这个 job 最多发现多少 targets

sample_limit:
  管单个 target 一次 scrape 最多返回多少 samples

label_limit:
  管每个 sample 最多带多少 labels
```

---

# 17. 认证、自定义 Header 与 TLS

## 17.1 Basic Auth

```yaml
scrape_configs:
  - job_name: "secure-api"
    scheme: https
    static_configs:
      - targets:
          - "api.example.com:443"

    basic_auth:
      username: "prometheus"
      password_file: "/etc/prometheus/secrets/api-password"
```

推荐使用 `password_file`，避免明文密码写在配置文件里。

## 17.2 Bearer Token

推荐使用：

```yaml
authorization:
  type: Bearer
  credentials_file: "/etc/prometheus/secrets/api-token"
```

也可以直接写：

```yaml
authorization:
  type: Bearer
  credentials: "your-token-here"
```

效果类似请求头：

```http
Authorization: Bearer your-token-here
```

很多旧资料会看到：

```yaml
bearer_token: "your-token-here"
```

或：

```yaml
bearer_token_file: "/etc/prometheus/secrets/api-token"
```

但更通用的理解方式是：

```yaml
authorization:
  type: Bearer
  credentials / credentials_file
```

## 17.3 自定义请求头 `http_headers`

如果接口需要：

```http
X-API-Key: abc123
```

可以写：

```yaml
scrape_configs:
  - job_name: "custom-header-api"
    scheme: https
    static_configs:
      - targets:
          - "api.example.com:443"

    http_headers:
      X-API-Key:
        values:
          - "abc123"
```

敏感值可以考虑：

```yaml
http_headers:
  X-API-Key:
    secrets:
      - "abc123"
```

或：

```yaml
http_headers:
  X-API-Key:
    files:
      - "/etc/prometheus/secrets/api-key"
```

分工：

```text
basic_auth     -> 用户名 / 密码
authorization  -> Authorization: Bearer xxx
http_headers   -> X-API-Key / X-Tenant-ID / 自定义 Header
tls_config     -> CA / client cert / TLS 校验
```

## 17.4 TLS

HTTPS：

```yaml
scheme: https
```

自签证书 CA：

```yaml
tls_config:
  ca_file: "/etc/prometheus/certs/ca.crt"
```

客户端证书：

```yaml
tls_config:
  ca_file: "/etc/prometheus/certs/ca.crt"
  cert_file: "/etc/prometheus/certs/client.crt"
  key_file: "/etc/prometheus/certs/client.key"
```

---

# 18. 配置检查与 Reload

Prometheus 主配置通常是：

```text
prometheus.yml
```

修改配置后，不会自动生效，需要 reload 或重启。

推荐流程：

```text
1. 修改 prometheus.yml
2. promtool check config prometheus.yml
3. reload Prometheus
```

检查：

```bash
promtool check config prometheus.yml
```

reload 方式 1：

```bash
curl -X POST http://localhost:9090/-/reload
```

前提是启动 Prometheus 时开启：

```bash
--web.enable-lifecycle
```

reload 方式 2：

```bash
kill -HUP <prometheus_pid>
```

记忆：

```text
改配置
↓
promtool check config
↓
reload
```

---

# 19. 生产级 Scrape Job 示例

```yaml
scrape_configs:
  - job_name: "vllm"
    scrape_interval: 10s
    scrape_timeout: 5s

    scheme: https
    metrics_path: /metrics

    http_sd_configs:
      - url: "http://registry.local/prometheus/vllm-targets"
        refresh_interval: 30s

    authorization:
      type: Bearer
      credentials_file: "/etc/prometheus/secrets/vllm-token"

    relabel_configs:
      - source_labels: [env]
        regex: prod
        action: keep

      - source_labels: [service]
        regex: vllm
        action: keep

      - source_labels: [cluster_name]
        target_label: cluster
        action: replace

    metric_relabel_configs:
      - source_labels: [__name__]
        regex: "debug_.*"
        action: drop

      - regex: "trace_id|request_id|user_id"
        action: labeldrop

    sample_limit: 20000
    target_limit: 500
```

拆解：

```text
抓取频率：
  scrape_interval / scrape_timeout

发现 targets：
  http_sd_configs

请求方式：
  scheme / metrics_path / authorization

抓之前处理 target：
  relabel_configs

抓之后处理 metric：
  metric_relabel_configs

保护阈值：
  sample_limit / target_limit
```

完整流程：

```text
HTTP SD 获取 targets
        ↓
relabel_configs 过滤 / 改写 targets
        ↓
Prometheus 请求 https://target/metrics
        ↓
metric_relabel_configs 丢弃或改写指标
        ↓
检查 sample_limit / label_limit 等限制
        ↓
写入 TSDB
```

---

# 20. 易混点总结

## 20.1 `scrape_interval` vs `refresh_interval`

```text
scrape_interval:
  多久抓一次 target 的 /metrics

refresh_interval:
  多久刷新一次服务发现结果
```

例子：

```yaml
global:
  scrape_interval: 10s

scrape_configs:
  - job_name: "vllm"
    http_sd_configs:
      - url: "http://registry.local/prometheus/targets"
        refresh_interval: 60s
```

含义：

```text
每 60 秒请求一次 registry
每 10 秒抓一次已经发现的 target
```

## 20.2 `relabel_configs` vs `metric_relabel_configs`

```text
relabel_configs:
  scrape 前
  处理 target
  决定抓不抓、怎么抓

metric_relabel_configs:
  scrape 后
  处理 metric sample
  决定存不存、标签怎么改
```

## 20.3 `labeldrop` vs 聚合

```text
labeldrop:
  删除标签
  不做聚合
  可能导致 series 冲突

sum without:
  查询时聚合
  不破坏原始 series
```

## 20.4 `replace`

```text
replace = 设置 target_label

target_label 不存在：
  新增

target_label 已存在：
  覆盖
```

## 20.5 `sample_limit`

```text
超过 sample_limit
不是截断前 N 个
而是整次 scrape 失败
```

## 20.6 服务发现动态性的来源

```text
static_configs:
  人手维护 prometheus.yml

file_sd_configs:
  外部程序更新文件

http_sd_configs:
  registry 接口返回最新 targets

dns_sd_configs:
  DNS 记录变化

kubernetes_sd_configs:
  Kubernetes API 反映 Pod/Service/Endpoint 变化
```

---


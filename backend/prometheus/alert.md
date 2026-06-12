## 1. Prometheus 告警整体链路

Prometheus 告警链路可以理解为：

```text
PromQL 表达式
  ↓
Prometheus alerting rule
  ↓
pending / firing / resolved
  ↓
Alertmanager
  ↓
route / group_by / silence / inhibition
  ↓
receiver
  ↓
飞书 / Slack / 邮件 / Webhook / PagerDuty
```

核心分工：

```text
Prometheus：负责判断是否触发告警
Alertmanager：负责通知、分组、路由、静默、抑制
```

---

## 2. Alerting Rule 基本结构

一个典型告警规则：

```yaml
groups:
- name: api.rules
  rules:
  - alert: InstanceDown
    expr: up{job="api"} == 0
    for: 5m
    labels:
      severity: critical
      team: backend
    annotations:
      summary: "API instance down"
      description: "{{ $labels.instance }} has been down for more than 5 minutes."
```

---

## 3. `alert` 是什么

```yaml
alert: InstanceDown
```

`alert` 后面的名字是告警类型名。

它最终会变成 alert 的一个 label：

```text
alertname="InstanceDown"
```

所以：

```text
alert 决定这是什么告警
alertname 是 Alertmanager 里常用的分组、路由、静默字段
```

---

## 4. `expr` 决定产生几条告警

```yaml
expr: up{job="api"} == 0
```

Prometheus 会周期性执行这个 PromQL。

如果当前数据是：

```text
up{job="api", instance="A"} 0
up{job="api", instance="B"} 0
up{job="api", instance="C"} 1
```

表达式：

```promql
up{job="api"} == 0
```

返回：

```text
{job="api", instance="A"} 0
{job="api", instance="B"} 0
```

所以产生 2 条 alert。

结论：

```text
expr 最终返回几个不同 label set，就可能产生几条告警
```

---

## 5. `for` 是什么

```yaml
for: 5m
```

表示：

```text
expr 连续满足 5 分钟后，告警才从 pending 变成 firing
```

状态变化：

```text
inactive：条件不满足
pending：条件满足，但还没持续够 for 时间
firing：条件持续满足够久，正式触发
```

例子：

```text
10:00 up == 0 → pending
10:01 up == 0 → pending
10:02 up == 1 → 恢复，pending 清掉
```

不会 firing。

---

## 6. `[5m]` 和 `for: 10m` 的区别

例如：

```yaml
expr: rate(http_requests_total{status=~"5.."}[5m]) > 10
for: 10m
```

区别：

```text
[5m]：PromQL 每次计算时，看最近 5 分钟的数据
for: 10m：这个 expr 条件要连续满足 10 分钟才 firing
```

也就是：

```text
[5m] 是计算窗口
for 是告警防抖时间
```

---

## 7. `labels` 是什么

```yaml
labels:
  severity: critical
  team: backend
```

rule labels 会附加到 alert 上。

如果触发告警，最终 alert 可能是：

```text
alertname="InstanceDown"
job="api"
instance="A"
severity="critical"
team="backend"
```

这些 label 来源：

```text
alertname              来自 alert: InstanceDown
job / instance         来自 expr 返回的指标标签
severity / team        来自 rule 里的 labels
```

`labels` 的主要用途：

```text
路由：team=backend 发给后端组
分级：severity=critical 走紧急通知
分组：Alertmanager group_by 可以使用这些字段
静默：silence 可以匹配这些字段
抑制：inhibition 可以匹配这些字段
```

---

## 8. `annotations` 是什么

```yaml
annotations:
  summary: "API instance down"
  description: "{{ $labels.instance }} has been down for more than 5 minutes."
```

annotations 主要给人看，用于通知内容。

常见字段：

```text
summary
message
description
runbook_url
dashboard_url
```

区别：

```text
labels：给机器用，参与路由、分组、静默、抑制
annotations：给人看，描述问题和排查方式
```

不要把频繁变化的值放进 labels，例如：

```yaml
labels:
  current_value: "{{ $value }}"   # 不推荐
```

应该放进 annotations：

```yaml
annotations:
  current_value: "{{ $value }}"
```

---

## 9. PromQL 聚合决定告警粒度

### 9.1 实例级

```promql
up{job="api"} == 0
```

A、B 挂了，会产生：

```text
A 一条 alert
B 一条 alert
```

---

### 9.2 job 级

```promql
sum(up{job="api"} == 0) by (job) > 0
```

A、B 挂了，只产生：

```text
job="api" 一条 alert
```

没有 instance 标签。

---

### 9.3 全局级

```promql
sum(up == 0) > 0
```

所有标签都被聚合掉，只产生一条全局 alert。

---

## 10. Prometheus 配置如何加载规则

主配置 `prometheus.yml`：

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - "rules/*.yml"

alerting:
  alertmanagers:
    - static_configs:
        - targets:
            - "127.0.0.1:9093"
```

含义：

```text
evaluation_interval：多久执行一次 rule expression
rule_files：加载哪些 rule 文件
alerting.alertmanagers：把 alert 发给哪个 Alertmanager
```

注意：`rule_files` 可以加载两类规则：

```text
alerting rules：告警规则
recording rules：预计算规则
```

---

## 11. Alertmanager 的作用

Prometheus 只判断告警，不负责最终通知。

Alertmanager 负责：

```text
route：根据 labels 选择 receiver
group_by：多条 alert 怎么合并成一条通知
group_wait：新组第一次通知前等多久
group_interval：同一组有变化时，至少多久再通知
repeat_interval：告警一直没恢复时，多久重复提醒
silence：人工静默
inhibition：上游告警压制下游告警
receiver：真正的通知方式
```

---

## 12. `group_by`

`group_by` 写在 Alertmanager 的 route 里：

```yaml
route:
  receiver: default
  group_by: ["alertname", "job"]
```

它决定：

```text
哪些 alert 算同一个通知组
```

比如 Alertmanager 收到：

```text
alertname="InstanceDown", job="api", instance="A"
alertname="InstanceDown", job="api", instance="B"
```

如果：

```yaml
group_by: ["alertname", "job"]
```

A、B 同组，发送 1 条通知。

如果：

```yaml
group_by: ["alertname", "job", "instance"]
```

A、B 不同组，发送 2 条通知。

注意：

```text
group_by 不改变 alert 数量，只改变通知合并方式
```

同组不是丢掉 A/B，而是通知包里包含多条 alert：

```text
group key:
  alertname="InstanceDown"
  job="api"

alerts:
  instance="A"
  instance="B"
```

---

## 13. `group_wait`、`group_interval`、`repeat_interval`

配置：

```yaml
route:
  receiver: default
  group_by: ["alertname", "job"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
```

### 13.1 `group_wait`

```text
一个新告警组第一次出现后，等多久再发第一条通知
```

作用：等同组告警一起进来，减少刷屏。

例子：

```text
10:00:00 A firing
10:00:20 B firing
10:00:30 第一次通知，包含 A 和 B
```

---

### 13.2 `group_interval`

```text
同一组已经发过通知后，如果有新变化，至少等多久再发更新通知
```

例子：

```text
10:00:30 第一次通知：A
10:01:00 B firing
10:05:30 才可能发更新通知：A、B
```

---

### 13.3 `repeat_interval`

```text
同一组告警一直没恢复，也没有新变化，多久重复提醒一次
```

例子：

```text
10:00:30 发送：A、B 挂了
14:00:30 A、B 还没恢复，重复提醒
```

记忆方式：

```text
group_wait：第一次通知前等多久
group_interval：同组有变化时多久更新一次
repeat_interval：一直没恢复时多久重复一次
```

---

## 14. `route` 和 `receiver`

Alertmanager 配置：

```yaml
route:
  receiver: default-webhook
  group_by: ["alertname", "job"]

  routes:
  - matchers:
    - team="backend"
    receiver: backend-webhook

  - matchers:
    - team="infra"
    receiver: infra-webhook

receivers:
- name: default-webhook
  webhook_configs:
  - url: "http://default.example.com/alert"

- name: backend-webhook
  webhook_configs:
  - url: "http://backend.example.com/alert"

- name: infra-webhook
  webhook_configs:
  - url: "http://infra.example.com/alert"
```

含义：

```text
team=backend → backend-webhook
team=infra   → infra-webhook
其他没匹配到 → default-webhook
```

`route.receiver` 是默认接收人。

`routes[].receiver` 是子路由匹配后使用的接收人。

`receivers` 里定义 receiver 名字对应的真实通知方式。

---

## 15. route 继承和 `continue`

子 route 没写的配置，会继承父 route。

例如：

```yaml
route:
  receiver: default
  group_by: ["alertname"]

  routes:
  - matchers:
    - team="backend"
    receiver: backend
```

`team="backend"` 的告警：

```text
receiver = backend
group_by = ["alertname"]，继承父级
```

默认情况下，Alertmanager 匹配到第一个子 route 后就停止继续匹配。

如果想继续往下匹配，需要：

```yaml
continue: true
```

例子：

```yaml
route:
  receiver: default
  routes:
  - matchers:
    - team="backend"
    receiver: backend
    continue: true

  - matchers:
    - severity="critical"
    receiver: pager
```

如果 alert 是：

```text
team="backend"
severity="critical"
```

会同时发给：

```text
backend
pager
```

---

## 16. Silence 静默

Silence 通常不是写死在 `alertmanager.yml` 里，而是在 Alertmanager UI / API / amtool 里临时创建。

它包含：

```text
matchers：匹配哪些 alert
start：开始时间
end：结束时间
comment：说明
creator：创建人
```

例子：

```text
matchers:
  job="api"
  env="prod"
时间：02:00 - 03:00
```

表示：

```text
02:00 到 03:00 之间，所有 job="api" 且 env="prod" 的 alert 不通知
```

注意：

```text
silence 不会让 alert 消失，只是不发通知
```

适用场景：

```text
发布维护
机器迁移
已知故障正在处理
临时降噪
```

---

## 17. Inhibition 抑制

Inhibition 写在 `alertmanager.yml`：

```yaml
inhibit_rules:
- source_matchers:
  - alertname="ClusterDown"

  target_matchers:
  - severity="warning"

  equal:
  - cluster
```

含义：

```text
如果有 ClusterDown 正在 firing，
则抑制同一个 cluster 内 severity="warning" 的告警通知。
```

三段判断：

```text
1. 是否存在 source alert 正在 firing
2. 当前 alert 是否匹配 target_matchers
3. source 和 target 在 equal 指定的 labels 上是否相同
```

三者都满足，target 被抑制。

例子：

```text
source:
alertname="ClusterDown"
cluster="prod-a"

 target:
alertname="HighCPU"
cluster="prod-a"
severity="warning"
```

会被抑制。

如果 target 是：

```text
alertname="HighCPU"
cluster="prod-a"
severity="critical"
```

不会被抑制，因为 target 不满足：

```text
severity="warning"
```

---

## 18. Silence 和 Inhibition 区别

| 能力 | 配置方式 | 是否需要其他告警 | 典型场景 |
|---|---|---|---|
| silence | UI / API / amtool 临时创建 | 不需要 | 维护、发布、已知故障 |
| inhibition | alertmanager.yml 配置 | 需要 source alert firing | 根因告警压制下游噪音 |

记忆：

```text
silence = 人说“这段时间别吵”
inhibition = 系统说“根因已经报了，下游别吵”
```

---

## 19. 排查告警链路

### 19.1 Prometheus UI 没有 firing

优先查 Prometheus：

```text
rule_files 是否加载
PromQL expr 是否写对
label 过滤是否正确
for 是否还没满足
evaluation_interval 是否还没评估
```

---

### 19.2 Prometheus 有 firing，但没有通知

再查 Alertmanager：

```text
Prometheus 是否配置 alerting.alertmanagers
Alertmanager 是否收到 alert
route 是否匹配正确 receiver
是否被 silence
是否被 inhibition
receiver 配置是否正确
通知渠道是否可用
```

---

## 20. 配置检查命令

检查 Prometheus 配置：

```bash
promtool check config /etc/prometheus/prometheus.yml
```

检查规则文件：

```bash
promtool check rules /etc/prometheus/rules/*.yml
```

检查 Alertmanager 配置：

```bash
amtool check-config /etc/alertmanager/alertmanager.yml
```

---

## 21. 告警核心心智模型

```text
Prometheus：
  rule_files 加载规则
  evaluation_interval 周期计算 expr
  expr 决定产生几条 alert
  alert 生成 alertname
  labels 补充 team/severity/env 等处理字段
  for 控制 pending → firing

Alertmanager：
  route 根据 labels 选择 receiver
  group_by 决定多条 alert 怎么合并通知
  group_wait 控制第一次通知前等待
  group_interval 控制同组更新频率
  repeat_interval 控制长期未恢复重复提醒
  silence 人工静默
  inhibition 上游告警压制下游告警
```

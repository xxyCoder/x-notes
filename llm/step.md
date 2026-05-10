## 核心概念

### Prefill vs Decode

- **Prefill**：把用户发来的 prompt 全部跑一遍 Transformer，把每个 token 的 KV 存入 KV cache。
- **Decode**：prompt 算完后，每次生成 1 个新 token，直到结束。
- 两个阶段走同一个 `step()` 入口，没有分开的流程。

### 为什么 prompt 没算完不能 decode？

Decode 生成第 N+1 个 token，依赖前 N 个 token 的 KV cache。如果 prompt 只算了一半，后半段 KV 不存在，attention 看不到完整上下文，结果是错的。必须等 `num_computed_tokens == num_tokens` 才能开始 decode。

---

## 主循环入口

**`vllm/v1/engine/core.py:402`**

```python
def step(self):
    scheduler_output = self.scheduler.schedule()          # 决定这次处理哪些请求、多少 token
    future = self.model_executor.execute_model(scheduler_output)  # GPU 跑模型
    model_output = future.result()
    engine_core_outputs = self.scheduler.update_from_output(scheduler_output, model_output)  # 处理输出
```

每次 step = 调度 → 执行 → 处理输出，prefill 和 decode 共用。

---

## 关键字段

### Request 字段（`vllm/v1/request.py`）

| 字段 | 含义 |
|---|---|
| `num_prompt_tokens` | prompt 的总 token 数 |
| `num_computed_tokens` | 已经跑过 Transformer、KV 已存好的 token 数，初始为 0 |
| `num_tokens` | property，等于 `len(self._all_token_ids)`，即 prompt + 已生成输出 |
| `num_tokens_with_spec` | property，`num_tokens + len(spec_token_ids)`，含投机解码草稿 token |
| `num_output_placeholders` | 异步调度时预留的 draft token 占位数 |
| `is_prefill_chunk` | `num_computed_tokens < (num_tokens + num_output_placeholders)`，True 表示还在 prefill 中 |
| `status` | `WAITING` → `RUNNING` → `PREEMPTED` / `FINISHED_*` |
| `num_preemptions` | 被踢出的次数 |

### SchedulerConfig 字段（`vllm/config/scheduler.py`）

| 字段 | 默认值 | 含义 |
|---|---|---|
| `max_num_batched_tokens` | 2048 | 每次 step 的 token_budget 上限，即 GPU 单次最多处理多少 token |
| `max_num_scheduled_tokens` | None（等于前者） | 可单独设置比前者更小的调度上限 |
| `max_num_seqs` | 128 | running 队列最大请求数 |
| `enable_chunked_prefill` | True | 是否允许 prompt 分块处理 |
| `long_prefill_token_threshold` | 0 | 超过此长度的 prompt 每次最多处理这么多 token，0 表示不限 |
| `max_num_partial_prefills` | 1 | 同时允许多少个请求处于分块 prefill 状态 |
| `max_long_partial_prefills` | 1 | 其中最多几个是长请求（超过 threshold 的），设小可让短请求插队 |
| `scheduler_reserve_full_isl` | True | 接受新请求时检查整个 prompt 的 KV cache 够不够，防止接了一半又 preempt |
| `policy` | `"fcfs"` | 调度策略，`fcfs`（先来先服务）或 `priority` |

---

## 调度流程详解

### token_budget 是什么

**`scheduler.py:329`**

```python
token_budget = self.max_num_scheduled_tokens  # 来自 max_num_batched_tokens
```

每次 step 开始时初始化，代表这次 GPU forward 总共能处理多少 token（所有请求加起来）。每调度一个请求就扣掉它的 token 数，扣到 0 停止调度。

### 调度顺序

1. **先处理 running 队列**（已有请求，含 prefill 中途和 decode）
2. **再处理 waiting 队列**（新请求），且只有没发生 preemption 时才处理

### RUNNING 队列：计算 num_new_tokens

**`scheduler.py:366`**

```python
num_new_tokens = (
    request.num_tokens_with_spec
    + request.num_output_placeholders
    - request.num_computed_tokens   # 还差多少没算
)
# cap 1：长 prompt 每次处理上限
if 0 < long_prefill_token_threshold < num_new_tokens:
    num_new_tokens = long_prefill_token_threshold
# cap 2：不超过剩余 budget
num_new_tokens = min(num_new_tokens, token_budget)
```

### WAITING 队列：新请求进来

**`scheduler.py:635`**

```python
num_new_tokens = request.num_tokens - num_computed_tokens

# 同样受 long_prefill_token_threshold 截断
if 0 < threshold < num_new_tokens:
    num_new_tokens = threshold

# enable_chunked_prefill=False 时，整个 prompt 放不下就不调度
if not enable_chunked_prefill and num_new_tokens > token_budget:
    break

num_new_tokens = min(num_new_tokens, token_budget)  # 分块的核心
```

### 每次 step 结束后更新进度

**`scheduler.py:945`**

```python
request.num_computed_tokens += num_scheduled_token
request.is_prefill_chunk = request.num_computed_tokens < (
    request.num_tokens + request.num_output_placeholders
)
```

`is_prefill_chunk=True`：prompt 还没算完，这次不采样输出 token，用户看不到任何响应。
`is_prefill_chunk=False`：prompt 算完，采样第一个输出 token，进入 decode。

---

## Preemption（抢占）

**触发时机**：给 running 队列里的请求分配 KV cache 失败（显存不够）。

**`scheduler.py:424`**

```python
while True:
    new_blocks = kv_cache_manager.allocate_slots(request, num_new_tokens, ...)
    if new_blocks is not None:
        break
    # 分配失败，踢掉优先级最低的请求（FCFS 策略踢最后进来的）
    preempted_req = self.running.pop()
    self._preempt_request(preempted_req, ...)
```

**被踢掉的请求**（`scheduler.py:918`）：

```python
kv_cache_manager.free(request)       # KV cache 全部释放
request.status = RequestStatus.PREEMPTED
request.num_computed_tokens = 0      # 进度清零，下次从头算
request.num_preemptions += 1
self.waiting.prepend_request(request) # 插回 waiting 队列头部
```

代价极高：之前算过的 KV 全丢，下次重新从 token[0] 开始。`scheduler_reserve_full_isl=True` 就是为了提前检查避免这种情况。

**注意**：waiting 队列里的新请求分配失败不触发 preemption，只是停止调度（`break`）。

---

## Chunked Prefill 完整例子

配置：`max_num_batched_tokens=2048`，`long_prefill_token_threshold=512`，`enable_chunked_prefill=True`

三个请求同时到达：
- 请求 A：prompt 1500 token
- 请求 B：prompt 300 token
- 请求 C：prompt 100 token

### Step 1

```
token_budget = 2048

A：num_new_tokens = min(1500, 512) = 512   → budget 剩 1536
B：num_new_tokens = min(300, 1536) = 300   → budget 剩 1236
C：num_new_tokens = min(100, 1236) = 100   → budget 剩 1136

GPU forward：处理 912 个 token
```

Step 1 结束后：
- A：`num_computed_tokens=512`，`is_prefill_chunk=True`，**不输出**
- B：`num_computed_tokens=300`，`is_prefill_chunk=False`，**输出第 1 个 token**
- C：`num_computed_tokens=100`，`is_prefill_chunk=False`，**输出第 1 个 token**

### Step 2

A 继续 prefill，B/C 进入 decode：

```
A：num_new_tokens = min(1500-512, 512) = 512   → budget 剩 1536
B：num_new_tokens = 1（decode，每次 1 token）
C：num_new_tokens = 1
```

A：`num_computed_tokens=1024`，`is_prefill_chunk=True`，仍不输出

### Step 3

```
A：num_new_tokens = 1500-1024 = 476（< 512，不截断）
```

A：`num_computed_tokens=1500`，`is_prefill_chunk=False`，**A 输出第 1 个 token**，进入 decode

---

## GPU 侧关键 tensor

**`vllm/v1/worker/gpu_model_runner.py`**

| tensor | shape | 含义 |
|---|---|---|
| `input_ids` | `(total_tokens,)` | 所有请求的 token ID 拼成一个大数组 |
| `positions` | `(total_tokens,)` | 每个 token 的绝对位置 = `num_computed_tokens + 局部偏移` |
| `query_start_loc` | `(batch+1,)` | 每个请求的 query 起始位置（cumsum） |
| `seq_lens` | `(batch,)` | 每个请求的上下文长度（含历史 KV） |
| `slot_mapping` | `(total_tokens,)` | 每个 token 的 KV 存到哪个物理槽 |
| `is_prefilling` | `(batch,)` bool | 哪些请求还在 prefill，决定用哪个 attention kernel |

位置编码（`gpu_model_runner.py:1848`）：

```python
positions_np = (
    input_batch.num_computed_tokens_cpu[req_indices]  # 上次算到哪
    + query_pos.np[...]                               # 本次 chunk 内的局部偏移
)
```

第二个 chunk 的位置从 1024 开始，保证 RoPE 连续，attention 能正确读到之前的 KV cache。

---

## 配置方式

```python
from vllm import LLM

llm = LLM(
    model="Qwen2.5-7B",
    max_num_batched_tokens=2048,       # token_budget 上限，影响吞吐和显存压力
    max_num_seqs=128,                  # 最多同时跑多少请求
    enable_chunked_prefill=True,       # 允许 prompt 分块，长请求不卡短请求
    long_prefill_token_threshold=512,  # 长 prompt 每次最多处理 512 token
    max_num_partial_prefills=2,        # 同时最多 2 个请求处于分块 prefill 状态
    max_long_partial_prefills=1,       # 其中最多 1 个是长请求，让短请求能插队
    scheduler_reserve_full_isl=True,   # 接新请求前检查整个 prompt KV cache 够不够
)
```

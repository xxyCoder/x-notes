# KV Cache

## K 和 V 是什么

来自 Transformer 的 Multi-Head Attention 公式：

```
Attention(Q, K, V) = softmax(QK^T / √d_k) · V
```

每个 token 经过线性变换得到三个向量：

- **Q（Query）**：当前 token 在"问什么"
- **K（Key）**：每个历史 token 在"我是什么"
- **V（Value）**：每个历史 token 的"实际内容"

自回归生成时，新 token 的 Q 要和所有历史 token 的 K 做点积（算注意力权重），再加权求和 V。Q 只在当前步用一次，不需要缓存；K 和 V 每步都要重复访问，所以缓存下来，这就是 KV cache。

---

## 为什么需要专门管理 KV Cache

多请求并发时，每个请求序列长度不同。如果给每个请求预分配最大长度的连续内存，碎片化极其严重。vLLM 的核心创新是 **PagedAttention**，借鉴操作系统虚拟内存分页的思想解决这个问题。

---

## PagedAttention：分页管理

物理内存被切成固定大小的 **block**（每个 block 存 `block_size` 个 token 的 K/V）。每个请求维护一张 **block table**，把逻辑 token 位置映射到物理 block：

```
请求 A: [block_id=5, block_id=12, block_id=3]   ← 逻辑连续，物理不连续
请求 B: [block_id=7, block_id=2]
```

Attention kernel 通过 **slot mapping** 把 `(请求, token位置)` 转换成物理内存地址：

```
slot = block_id * block_size + (position % block_size)
```

这个映射由 Triton kernel 完成（`v1/worker/block_table.py:141` `compute_slot_mapping()`）。

---

## 核心数据结构（vLLM v1）

### KVCacheBlock（`v1/core/kv_cache_utils.py:114`）

每个物理 block 的元数据：

```python
@dataclass(slots=True)
class KVCacheBlock:
    block_id: int                              # 物理 block 编号 [0, num_gpu_blocks)
    ref_cnt: int = 0                           # 引用计数（多请求共享时 > 1）
    _block_hash: BlockHashWithGroupId | None   # prefix cache 用的哈希
    prev_free_block: KVCacheBlock | None       # 双向链表指针
    next_free_block: KVCacheBlock | None
    is_null: bool = False                      # 占位 block（sliding window 用）
```

### FreeKVCacheBlockQueue（`v1/core/kv_cache_utils.py:162`）

空闲 block 的双向链表，支持 O(1) 中间删除（避免用 Python 内置 deque）：

```
[最久未用] ← → [block_7] ← → [block_3] ← → [最近释放]
```

释放时按 LRU 顺序追加到尾部，分配时从头部取。内存不足时优先驱逐最久未用的 block。

### BlockPool（`v1/core/block_pool.py:130`）

统一管理所有 block：

```python
class BlockPool:
    blocks: list[KVCacheBlock]                    # 全部 block
    free_block_queue: FreeKVCacheBlockQueue       # 空闲链表（含可驱逐的 cached block）
    cached_block_hash_to_block: BlockHashToBlockMap  # hash → block（prefix cache 索引）
    null_block: KVCacheBlock                      # block_id=0 的占位符
```

---

## Prefix Caching（前缀缓存）

多个请求有相同前缀（如 system prompt）时，这些 token 的 KV 只需计算一次。

**机制：**

1. 当一个 block 被填满（`block_size` 个 token），计算它的哈希：
   - 哈希输入 = 前一个 block 的哈希 + 本 block 的 token IDs（链式哈希，保证前缀唯一性）
   - 哈希函数：sha256 或 xxhash
2. 把 `hash → block` 存入 `cached_block_hash_to_block`
3. 新请求来时，`get_computed_blocks()` 从左到右扫描，找最长匹配前缀
4. 命中的 block 直接复用（`ref_cnt++`），不需要重新计算

**关键设计**：block 一旦被 cache（有了 hash），就不可变，不需要 copy-on-write。

### enable_prefix_caching 关闭时的行为

参数在 vLLM v1 内部叫 `enable_caching`，对应用户侧的 `--enable-prefix-caching`。

关闭后，`get_computed_blocks()` 直接短路返回（`kv_cache_manager.py:199`）：

```python
def get_computed_blocks(self, request):
    if not self.enable_caching or request.skip_reading_prefix_cache:
        return self.empty_kv_cache_blocks, 0  # 跳过，返回 0 命中
    ...
    computed_blocks = self.coordinator.find_longest_cache_hit(...)
```

`allocate_slots()` 里也跳过 block 哈希缓存步骤，block 照常分配和释放，只是不计算哈希、不存入索引，每个请求都从零开始分配新 block。

另外 `request.skip_reading_prefix_cache` 也会触发跳过，发生在：
- 请求需要 prompt logprobs（需要重新计算每个 token 的概率）
- pooling 模型对所有 token 做 pooling

---

## Block 的生命周期

```
分配 → 使用 → 释放 → [可能被 cache] → 驱逐/复用
```

**分配**（`kv_cache_manager.py:225` `allocate_slots()`）：
1. 检查 prefix cache 命中 → `get_computed_blocks()`
2. 计算还需要多少新 block
3. 从 `free_block_queue` 头部取 block
4. `ref_cnt = 1`，从空闲链表移除

**释放**（`kv_cache_manager.py:418` `free()`）：
1. `ref_cnt--`
2. 若 `ref_cnt == 0`，追加到 `free_block_queue` 尾部（LRU 顺序）
3. 若 block 有 hash，仍留在 `cached_block_hash_to_block` 中（可被未来请求命中）

**驱逐**（`block_pool.py:354` `_maybe_evict_cached_block()`）：
1. 空闲 block 不足时，从 `free_block_queue` 头部取 block
2. 若该 block 有 hash，从 `cached_block_hash_to_block` 中删除
3. 清空 hash，重置为普通空闲 block

---

## 整体架构层次

```
Scheduler
    ↓ allocate_slots() / free()
KVCacheManager              ← 对外接口，隐藏内部细节
    ↓
KVCacheCoordinator          ← 协调多个 KV cache group（混合模型用）
    ↓
SingleTypeKVCacheManager    ← 单种 attention 类型的管理
    ↓
BlockPool                   ← 物理 block 的分配/释放/缓存

Worker (GPU 侧)
    BlockTable              ← 维护 block_id 到 GPU tensor 的映射
    slot_mapping            ← Triton kernel 计算物理 slot
    Attention kernel        ← 用 slot_mapping 读写 KV cache
```

**Coordinator 的作用**：混合模型（如 full attention + sliding window attention）不同层有不同 KV cache 需求，`HybridKVCacheCoordinator` 协调多个 group，每个 group 有独立的 block 管理逻辑。

---

## KV Cache 内存占用计算

### 单个 token 的 KV cache 大小

```
单 token KV cache = 2 × 层数 × KV 头数 × 头维度 × 每元素字节数
```

各参数含义：

- `2`：K 和 V 各一份
- **层数**：每个 Transformer 层都有独立的 KV cache，全部累加
- **KV 头数**：GQA 模型的 KV 头数远少于 Q 头数，专门为了压缩 KV cache
- **头维度**：每个头的向量长度 = `hidden_size / Q头数`，与 KV 头数无关
- **每元素字节数**：fp16/bf16=2，fp8=1

#### 例子一：LLaMA-3 8B（bf16）

| 参数 | 值 |
|------|-----|
| 层数 | 32 |
| Q 头数 | 32 |
| KV 头数 | 8（GQA，4个Q头共享1个KV头） |
| hidden_size | 4096 |
| 头维度 | 4096 / 32 = 128 |
| 精度 | bf16，2 字节 |

```
单 token = 2 × 32 × 8 × 128 × 2 = 131,072 字节 = 128 KB
1000 token 对话的 KV cache ≈ 125 MB
```

#### 例子二：LLaMA-3 70B（bf16）

| 参数 | 值 |
|------|-----|
| 层数 | 80 |
| Q 头数 | 64 |
| KV 头数 | 8（GQA，8个Q头共享1个KV头） |
| hidden_size | 8192 |
| 头维度 | 8192 / 64 = 128 |
| 精度 | bf16，2 字节 |

```
单 token = 2 × 80 × 8 × 128 × 2 = 327,680 字节 = 320 KB
1000 token 对话的 KV cache ≈ 312 MB（是 8B 的 2.5 倍）
```

#### 例子三：70B 改用 fp8

```
单 token = 2 × 80 × 8 × 128 × 1 = 163,840 字节 = 160 KB
1000 token 对话的 KV cache ≈ 156 MB（比 bf16 直接减半）
```

#### GQA 的作用

假设 LLaMA-3 8B 没有 GQA，KV 头数和 Q 头数一样是 32：

```
单 token = 2 × 32 × 32 × 128 × 2 = 524,288 字节 = 512 KB
```

实际 GQA 是 128 KB，**GQA 让 KV cache 缩小到 1/4**。大模型普遍用 GQA 主要就是为了省 KV cache，不是为了计算速度。

换算成 block 粒度（`kv_cache_interface.py:164`）：

```python
page_size_bytes = 2 * block_size * num_kv_heads * head_size * dtype_size
# 整个模型一个 block 的开销：
bytes_per_block = page_size_bytes * num_layers
```

### 可用内存 → block 数量

启动流程（`gpu_worker.py:352` `determine_available_memory()`）：

```
1. 加载模型权重到 GPU
2. 跑一次 profile run（用虚拟输入跑前向），实测权重 + 峰值激活占用
3. available_kv_cache = total_vram × gpu_memory_utilization
                        - 模型权重 - 峰值激活 - CUDAGraph 内存
4. 一次性预分配 KV cache 张量
```

block 数量（`kv_cache_utils.py:945`）：

```python
num_blocks = available_kv_cache // page_size_bytes // num_layers
```

### 举例（LLaMA-3 8B，bf16，A100 80GB，utilization=0.9）

| 参数 | 值 |
|------|-----|
| num_layers | 32 |
| num_kv_heads | 8（GQA） |
| head_size | 128 |
| block_size | 16 |
| dtype_size | 2（bf16） |

```
page_size_bytes = 2 × 16 × 8 × 128 × 2 = 64 KB（单层单 block）
bytes_per_block = 64 KB × 32 = 2 MB

requested = 80 GB × 0.9 = 72 GB
模型权重 ≈ 16 GB，峰值激活 ≈ 1~2 GB
available_kv_cache ≈ 54 GB

num_blocks ≈ 54 GB / 2 MB ≈ 27,000 个 block
可缓存 token 数 ≈ 27,000 × 16 = 432,000 tokens
```

---

## 调度阶段与执行阶段：每步循环

vLLM 的推理是一个**逐步循环**，不是一次性规划整个请求生命周期（`engine/core.py:413`）：

```python
while True:
    scheduler_output = scheduler.schedule()          # 调度阶段（CPU）
    model_output = executor.execute_model(           # 执行阶段（GPU）
        scheduler_output
    )
    scheduler.update_from_output(                    # 用结果更新状态
        scheduler_output, model_output
    )
```

**调度阶段（CPU）**：
- 决定这一步哪些请求参与计算、各算多少 token
- 分配 block ID（只是整数，写入 CPU 上的 numpy 数组）
- 处理抢占、prefix cache 命中
- 输出 `SchedulerOutput`

**执行阶段（GPU）**：
- 把 block ID 复制到 GPU，用 Triton kernel 计算 slot mapping
- 跑 forward pass，attention kernel 按 slot mapping 读写 KV cache 张量
- 采样，输出新 token

两个阶段操作的对象不同：调度阶段操作**元数据**（block_id 整数），执行阶段操作**实际数据**（GPU 显存里的 K/V 向量）。

### Block 是按需逐步分配的

调度阶段不需要预测请求最终会生成多少 token，每步只分配**这一步**需要的 slot：

```
step 1（prefill）: prompt 500 token → 分配 ceil(500/16) = 32 个 block
step 2（decode）:  总长 501 token  → 还在第 32 个 block 里，新增 0 个 block
...
step 14（decode）: 总长 513 token  → 需要第 33 个 block，新增 1 个 block
...
step N:            模型输出 EOS    → 请求结束，释放全部 block
```

每步分配逻辑：`ceil(当前总token数 / block_size) - 已有block数`，结果通常是 0 或 1。`max_tokens` 只用于判断请求是否该结束，不用于预分配内存。

输出 token 的 KV 同样缓存：decode 阶段每生成一个 token，其 K/V 就写入当前 block，供后续步骤的 attention 使用。

---

## VRAM 不足时的处理策略

### 运行时：Preemption（抢占）

调度阶段给某请求分配 block 失败时（`scheduler.py:424`），触发抢占循环：

```python
while True:
    new_blocks = kv_cache_manager.allocate_slots(request, ...)
    if new_blocks is not None:
        break  # 分配成功

    # 失败 → 踢掉运行队列里最后加入的请求（FCFS策略）
    #         或优先级最低的请求（PRIORITY策略）
    preempted_req = self.running.pop()
    self._preempt_request(preempted_req, ...)

    if preempted_req == request:
        break  # 连自己都被踢了，这一轮放弃调度
```

`_preempt_request()` 做的事（`scheduler.py:910`）：

```python
self.kv_cache_manager.free(request)   # 释放该请求全部 KV cache block
request.num_computed_tokens = 0       # 清空已计算进度
request.num_preemptions += 1
self.waiting.prepend_request(request) # 退回等待队列最前面
```

被抢占的请求下次调度时**从头重新 prefill**（recompute），KV cache 全部丢弃。

**关于 prefix cache 共享的情况**：如果被抢占请求的某个 block 被多个请求共享（`ref_cnt > 1`），`free()` 只是 `ref_cnt--`，不会立刻回收，等所有引用都释放后才归零。这不影响抢占本身，被抢占请求的引用照样释放。

**不会 OOM**：KV cache 物理内存在启动时已一次性分配好，运行时只是逻辑上分配/释放 block ID，不触发新的 `cudaMalloc`。

### 启动时：才可能真正 OOM

`gpu_memory_utilization` 限制的是**总 VRAM 的百分比**，不是剩余可用内存，以下情况会 OOM：

- **模型太大**：权重加载时就超出 VRAM，`gpu_memory_utilization` 管不了
- **外部竞争**：其他进程已占用显存，vLLM 仍按总量 × utilization 申请，实际不够
- **utilization 设太高**：权重 + 激活 + KV cache 预分配加起来超出实际 VRAM

### 避免抢占的调参方向

- 降低 `gpu_memory_utilization`（如 0.9 → 0.85）留出余量
- 减小 `max_model_len` 限制每请求最多占多少 block
- 设置 `max_num_seqs` 控制并发请求数上限

---


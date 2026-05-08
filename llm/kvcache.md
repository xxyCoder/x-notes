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

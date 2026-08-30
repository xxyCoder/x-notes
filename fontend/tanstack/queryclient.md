# TanStack Query v5 完整链路

```
┌────────────────────────────────────────────────────────────────┐
│                  QueryClient【门面 + 调度器】                    │
│  ┌──────────────────┐             ┌──────────────────────────┐ │
│  │    queryCache    │             │       mutationCache      │ │
│  └────────┬─────────┘             └────────────┬─────────────┘ │
│           │                                    │               │
│     存储所有Query对象                    存储每次Mutation执行记录   │
│   Query保存服务端资源数据                保存data/error/variables  │
│     Query支持gcTime                      Mutation同样支持gcTime  │
└───────────┼────────────────────────────────────┼───────────────┘
            │                                    │
            ▼                                    ▼
┌──────────────────────────┐       ┌────────────────────────────┐
│ Query对象                 │       │ Mutation对象               │
│                          │       │                            │
│ 每个 queryHash 对应1个实例  │       │ 每次 mutate() 生成1个实例    │
│ ├ state                  │       │ ├ state                    │
│ │ data/error             │       │ │ data/error/variables     │
│ │ dataUpdatedAt          │       │ │ status/submittedAt       │
│ │ errorUpdatedAt         │       │ ├ observers[]              │
│ │ isInvalidated          │       │ └ gcTime：执行记录回收       │
│ ├ observers[]            │       │                            │
│ ├ fetch()：请求协调入口    │       │                            │
│ └ gcTime：Query对象回收    │       │                            │
└────────────┬─────────────┘       └─────────────┬──────────────┘
             │                                   │
             ▼                                   ▼
┌──────────────────────────┐       ┌────────────────────────────┐
│ QueryObserver            │       │ MutationObserver           │
│ useQuery 创建             │       │ useMutation 创建            │
│ InfiniteQueryObserver    │       │ mutate()时才创建Mutation     │
│ useInfiniteQuery 创建     │       │ mutation成功不会自动更新     │
│ 组件订阅/取消订阅Query      │       │ QueryCache                 │
└────────────┬─────────────┘       └────────────────────────────┘
             ▼
React组件：拿到data/isPending/isFetching等结果渲染
```

> 一条 `queryKey` 经过hash得到 `queryHash`；“一个key一个Query”准确说是：同一个 `QueryClient` 内，相同 `queryHash` 复用同一个Query。

## 配置层（和缓存实例分开）

```
QueryClient
├─ defaultOptions
│   ├─ queries：staleTime、gcTime、retry、refetchOnWindowFocus、networkMode...
│   └─ mutations：gcTime、retry、networkMode...
├─ setQueryDefaults(queryKey, options)
└─ setMutationDefaults(mutationKey, options)

优先级：
hook局部配置
    > 匹配queryKey/mutationKey的defaults
    > QueryClient.defaultOptions

同一 key 可能同时匹配多组 defaults；源码按注册顺序合并，
所以通用 key 先注册，具体 key 后注册，让具体配置最后覆盖。
```

- **重试**：浏览器端由 Observer 发起的 Query 默认重试 3 次，服务端默认不重试。命令式 Query 会先合并默认配置；最终仍未配置 `retry` 时不重试。Mutation 默认也不重试。
- **过期判断**：Query 只保存数据、更新时间和失效标记，不保存统一的“是否过期”。每个 Observer 根据自己的 `staleTime` 判断，所以同一份缓存对组件 A 可以是新鲜的，对组件 B 可以已经过期。命令式 Query 没有 Observer，直接使用本次调用的 `staleTime` 判断。
- **缓存回收**：Query 没有 Observer 后按 `gcTime` 回收；如果请求随后结束，会重新计时。Mutation 无人观察后也会计时，但执行中不会删除。多个 `gcTime` 取较大值；浏览器默认 5 分钟，服务端默认永久保留。

## QueryClient 门面方法调度链路

> QueryClient 不是把方法原样转发给 QueryCache；QueryCache 负责存储/查找，QueryClient 负责筛选和编排，再调用 Query 自身方法。

```
getQueryData(key)
→ 计算 queryHash
→ queryCache.get(queryHash)?.state.data

setQueryData(key, updater)
→ 读取现有 Query 的 data 并执行 updater
→ 结果为 undefined：直接返回，不创建 Query 也不更新已有 Query
→ 结果非 undefined：queryCache.build → query.setData()

invalidateQueries(filters)
→ queryCache.findAll(filters)
→ 每个 query.invalidate()（已经失效时不重复dispatch）
→ 默认 refetchQueries(type:'active')
→ query.fetch()

cancelQueries(filters)
→ queryCache.findAll(filters)
→ 每个 query.cancel()

removeQueries(filters)
→ queryCache.findAll(filters)
→ queryCache.remove(query)

resetQueries(filters)
→ queryCache.findAll(filters)
→ 每个 query.reset()
→ 从 active Query 中筛选，并排除当前 query.isDisabled() 或 query.isStatic() 为 true 的 Query 后重新请求
```

## 完整数据流两条链路

### 链路1：读请求 useQuery

1. `useQuery` 合并全局、queryKey 默认配置和局部配置。
2. 创建 `QueryObserver`；Observer 先通过 `QueryCache.build` 找到或创建 Query。
3. 组件正式订阅时，Observer执行 `query.addObserver(this)`。
4. Observer 判断挂载时是否请求：
   - 没有 data 且 `enabled `解析结果不为 `false`：通常执行 `query.fetch()`；如果 Query 已经报错且 `retryOnMount:false`，则不重试。
   - 有 data 且 fresh：默认直接复用缓存。
   - 有 data 但 stale：默认后台 refetch，isFethcing/isRefetching/isStale 都为 true
   - `enabled:false` 或使用 `skipToken`：不自动发起新请求，已有数据和状态都照常保留
   - `refetchOnMount:false` 可禁止 stale 挂载刷新；`refetchOnMount:'always'` 可让 fresh 数据也刷新（`staleTime:'static'`除外）。
5. Query 状态变化，广播给全部 Observer；每个 Observer 计算自己的 `select/placeholderData` 结果，再决定是否通知组件渲染。
6. 最后一个 Observer 离开后，Query 进入 GC 管理。`gcTime` 是有限值时才建立倒计时；到期后，只有 Observer 数量仍为0且`fetchStatus === 'idle'`，Query 才会从 QueryCache 删除。

   `paused` 虽然没有执行 queryFn，但不等于 `idle`，本次 GC 检查不会删除它。`gcTime:Infinity` 不会建立定时器。

> `active/inactive` 是 Query Filters 的筛选语义：至少一个 Observer 的 `enabled` 解析结果不为 `false` 时，Query 是 active；否则是 inactive。
>
> 这与 GC 条件不同。只剩 disabled Observer 的 Query 属于 inactive，但 Observer 数量不为0，不会启动 GC。`prefetchQuery` 创建的 Query 没有 Observer，因此从创建起就受 `gcTime` 管理；`setQueryData` 只有在新data非 `undefined`、实际创建 Query 时才属于这种情况。

### 链路2：写请求 useMutation

1. `useMutation` 只创建 `MutationObserver`；调用 `mutate(variables)` 时才创建 Mutation 实例。
2. Mutation 存入 MutationCache 并进入 pending；新调用会先等待 MutationCache 级 `onMutate`，再等待 hook 级 `onMutate`。只有 hook 级 `onMutate` 的返回值会记录为后续回调使用的 context。
3. 成功结果只写入 Mutation 自己的 `state.data`，不会自动修改 QueryCache。
4. 业务手动选择：
   - `invalidateQueries`：标记匹配 Query 失效，默认尝试重新请求符合执行条件的 active Query。
   - `setQueryData`：直接把服务端返回或乐观结果写入 Query 缓存。
5. Mutation 无人观察后进入 gcTime 管理；如果仍是 pending，不会因为 gcTime 到期而强行删除，完成后才可回收。

## Query 与 Mutation 状态怎么判断

### Query：status 和 fetchStatus 是两个维度

Query不能只看一组 `isXXX`。底层 Query 同时描述“当前有没有可用结果”和“ Query 当前处于哪一种 fetch 流程状态”：

```
status【数据结果状态】
├─ pending：当前没有可用 data，且尚未进入最终 error
├─ success：当前有成功结果
└─ error：最近一次执行最终失败；仍可能保留旧data

fetchStatus【fetch流程状态】
├─ fetching：fetch/retry 流程活跃，且当前未 paused/idle
├─ paused：想执行，但当前执行条件不允许
└─ idle：当前没有活跃的 fetch 流程
```

`useQuery` 返回的 Observer Result 通常基于这两个状态派生；`placeholderData/select` 还可能只调整当前 Observer 的输出，不修改底层 Query 状态：

```
isPending   = status === 'pending'
isSuccess   = status === 'success'
isError     = status === 'error'

isFetching  = fetchStatus === 'fetching'
isPaused    = fetchStatus === 'paused'

isLoading   = isPending && isFetching
isRefetching = isFetching && !isPending
```

最重要的区别：

- `isPending` 表示当前 Observer Result 仍处于 pending；通常没有可用 data，但可能在等待 enabled 或网络条件，不保证 queryFn 正在运行。
- `isFetching` 表示 Query 处于活跃 fetch/retry 流程；首次加载和有旧数据的后台刷新都会是 `true`。它不保证每一刻都有 HTTP 在途：在线状态下等待 `retryDelay` 时也可能保持`true`。
- `isLoading` 才是“当前没有可用 data，并且 fetch 流程已经启动”，适合控制首次全屏 Loading；它同样可能覆盖失败后的重试等待时间。
- `isRefetching` 表示已经不处于 pending，但当前又在 fetch，通常用于保留旧内容时显示小型刷新状态。
- 在5.102.5中，`isInitialLoading` 只是 `isLoading` 的废弃别名，新代码直接使用` isLoading`。


所以不能写成“`isPending` 就一定显示加载动画”。无缓存的 dependent query 在 `enabled:false` 时也是 `pending + idle`；默认`online` 模式离线时可能是 `pending + paused`，这两种情况都没有正在执行的请求。

#### Query 错误状态

错误时先看是否还有 data：

- `isLoadingError`：没有 data，首次加载失败，通常展示错误页。
- `isRefetchError`：仍有旧 data，后台刷新失败，继续展示旧内容并提示刷新失败。

### Mutation：只有一套 status，另外叠加 isPaused

Mutation 没有 Query 的缓存刷新语义，所以没有 `fetchStatus/isLoading/isFetching/isRefetching`：

```
status
├─ idle：还没有调用 mutate，或已经 reset
├─ pending：本次写动作尚未结束
├─ success：本次写动作成功
└─ error：本次写动作失败

isIdle    = status === 'idle'
isPending = status === 'pending'
isSuccess = status === 'success'
isError   = status === 'error'
```

Mutation 提交按钮通常直接使用 `isPending` 防止重复操作：

```tsx
const saveMutation = useMutation({ mutationFn: saveTodo })

<button
  disabled={saveMutation.isPending}
  onClick={() => saveMutation.mutate(todo)}
>
  保存
</button>
```

`isPaused` 是叠加在 `pending` 上的另一个维度：

```
pending + isPaused:false
└─ onMutate / mutationFn / retry / 等待异步回调正在进行

pending + isPaused:true
├─ networkMode:'online'首次启动时等待恢复在线
├─ online/offlineFirst 的 retry 阶段等待恢复在线
├─ 任意 networkMode 的 retry 阶段等待页面重新 focused
└─ 任意 networkMode 下等待相同 scope.id 的前一个 Mutation 结束
```

- 写在 `useMutation()` 里的回调属于 Mutation 执行流程。即使组件卸载，只要 Mutation 还在执行，回调仍会继续；框架也会等待这些回调返回的 Promise。
- 写在 `mutate(variables, callbacks)` 里的回调属于当前组件对“最近一次调用”的观察。组件卸载或再次调用 `mutate()` 后，前一次的单次回调可能不会执行。
- 需要可靠地等待某次 Mutation 及其后续处理时，使用 `await mutateAsync()`，不要依赖 `mutate()` 的单次回调。

- `isPaused` 仍属于 `pending`，表示提交正在等待网络或执行顺序恢复。
- Mutation 的 `data/error/variables` 只是本次执行记录，不会自动成为 Query 缓存。
- `reset()` 只重置当前 Observer 显示的状态，不能撤销已经发出的服务端操作。

### Mutation为什么有 gcTime、没有 staleTime

```
Mutation不是“某份服务端资源缓存”
而是“一次写动作的执行记录”
```

- 不需要`staleTime`：Mutation 不存在“数据旧了自动重新提交”的语义。
- 需要 `gcTime`：每次 `mutate()` 都会新增记录，必须防止 MutationCache 无限增长。
- 保留期间可供当前 Observer、`useMutationState({ filters: { mutationKey } })`、Devtools 和离线恢复读取。
- 完全不需要跨组件状态 / Devtools / 离线能力时，可以把 `gcTime` 配置得更短。
- `gcTime:0` 也不是同步删除开关：回收仍通过定时任务执行，pending Mutation 仍会保留到结束，不建议把0当成通用默认值。

## invalidateQueries：失效和请求是两个动作

```
queryClient.invalidateQueries({ queryKey: ['feed'] })
    ↓
1. query.invalidate()：仅在原来未失效时设置isInvalidated=true并广播；已经失效时不重复dispatch
    ↓
2. 默认 refetchType:'active'：QueryClient 主动调用 refetchQueries
    ↓
3. active 且未被判定为 disabled、`query.isStatic()` 不为 true 的 Query 执行`query.fetch()`
```

> invalidate 状态更新是幂等的，但 refetch 编排仍会继续：Query 原本已经失效时，本次 `invalidateQueries` 不会重复广播invalidate 事件，仍会按 `refetchType` 尝试刷新符合条件的Query。

只标记失效、不立即请求：

```
queryClient.invalidateQueries({
  queryKey: ['feed'],
  refetchType: 'none'
})
```

- `active`（默认）：从active Query中选择立即刷新的对象。
- `inactive`：从inactive Query中选择立即刷新的对象。
- `all`：筛选范围同时包含active和inactive Query。
- `none`：只执行幂等invalidate，不发网络请求；仅在失效状态实际变化时广播。

> `active/inactive/all`只决定筛选范围，不等于“所有匹配Query一定发请求”。真正执行refetch前还会排除disabled Query，以及当前`query.isStatic()`为true的Query。
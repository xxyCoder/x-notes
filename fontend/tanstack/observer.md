# Query 与 Observer

```
                  Query（同QueryClient + queryHash唯一）
        ┌──────────────────────────────────────────────────┐
        │ state：原始data / error / dataUpdatedAt           │
        │        isInvalidated / fetchStatus               │
        │ observers[]：保存全部订阅者                         │
        │ fetch()：同一Query的请求协调入口                     │
        │ gcTime：零Observer后的回收策略                      │
        └──────────────────────┬───────────────────────────┘
                               │ state变化广播
             ┌─────────────────┴─────────────────┐
             │                                   │
             ▼                                   ▼
┌────────────────────────┐          ┌────────────────────────┐
│ QueryObserver-A        │          │ QueryObserver-B        │
├────────────────────────┤          ├────────────────────────┤
│ 私有配置                │           │ 私有配置               │
│ staleTime / select     │          │ staleTime / select     │
│ placeholderData        │          │ placeholderData        │
│ refetchOnXXX / interval│          │ refetchOnXXX / interval│
│ select结果结构共享       │          │ select结果结构共享       │
├────────────────────────┤          ├────────────────────────┤
│ refetch()              │          │ refetch()              │
│ InfiniteObserver额外有  │          │ InfiniteObserver额外有  │
│ fetchNextPage()        │          │ fetchNextPage()        │
└───────────┬────────────┘          └────────────┬───────────┘
            │                                    │
            └──────────────┬─────────────────────┘
                           ▼
                     同一个Query.fetch()
```

> `useQuery` 创建 `QueryObserver`；`useInfiniteQuery` 创建继承自 QueryObserver 的 `InfiniteQueryObserver`。
>
> `structuralSharing` 有两层用途：Query 写入 queryFn 原始结果时，会对共享缓存做一次结构共享；Observer 执行 `select/placeholderData` 后，还会对自己的输出再做一次结构共享。后者是 Observer 本地行为，前者不是每个 Observer 各自保存一份原始缓存。

## 数据流

```
Query 原始 state 变化
     ↓ 广播给 Observer
Observer.createResult()
     ↓ 当前 Query 无 data 时，计算 placeholderData
     │   previousData 来自“上一个有数据 Query（同一个 Observer 因为 queryKey 变化，从旧 Query 切换到了新 Query） 的原始 state.data”
     ↓ select（Observer 本地转换，不改 Query 缓存）
     ↓ structuralSharing（对 select 结果做引用复用）
     ↓ 生成 Observer Result
     ↓ 属性追踪判断组件是否真的需要重渲染
React组件
```

- `placeholderData` 不写入 QueryCache，只是 Observer 当前输出的临时数据。
- `placeholderData(prev => prev)` 的 `prev` 是上一个有数据 Query 的 **原始缓存data**，不是已经经过 select 的上一轮组件输出。
- placeholder 产生的数据也会继续经过当前 Observer 的`select`。
- Query 写入原始 data 时也会做 structural sharing；Observer 对 select 后的结果还会再做一次引用复用。
- `select` 抛错时，当前 Observer 会保存 select error，并把自己的 Result 变成 `status:'error'`；底层 Query 原始 data 和状态不变，同 Query 的其他 Observer 仍按各自的 `select` 生成结果。
- `isFetched `表示 Query 的数据或错误曾被更新，不代表网络请求完成；`setQueryData` 也会使它变成 `true`。
    ```
    isFetched = dataUpdateCount > 0 || errorUpdateCount > 0
    ```
- `isFetchedAfterMount` 表示这类更新发生在当前 Observer 挂载之后。

## 生命周期

```
useQuery 执行
    ↓
创建 Observer
    ↓
QueryCache.build：先找到/创建 Query
    ↓
组件订阅：query.addObserver(observer)
    ↓
Observer判断 shouldFetchOnMount
    ↓
需要请求时调用 query.fetch()

组件卸载
    ↓
Observer 取消订阅/销毁
    ↓
最后一个 Observer 离开 → Observer 数量变成0 → 进入GC管理
```

## refetchInterval 自动轮询

`refetchInterval` 不是 QueryCache 的全局定时器，而是每个 `QueryObserver` 自己的配置和定时器。Observer 订阅后维护定时器，取消订阅或销毁时清理；到点后仍然调用当前 Query 的 `fetch()`。

```
Observer订阅
    ↓
计算refetchInterval
    ↓
建立定时器
    ↓ 到点且允许执行
observer.#executeFetch()
    ↓
query.fetch()
```

- `refetchInterval `取值是毫秒数、`false`，或者 `(query) => number | false | undefined`。动态函数会在 Query 更新后重新计算，因此适合“任务运行中轮询，完成后停止”。
- 轮询独立于 `staleTime`：即使数据仍是 fresh，只要定时器满足条件，也会调用 fetch。`staleTime` 主要控制挂载、聚焦、重连等触发点是否需要刷新，不是轮询周期。
- `enabled:false`、`refetchInterval:false`、间隔为`0`、Observer 未订阅以及服务端渲染环境都不会建立轮询定时器。需要停止时应明确返回 `false`，不要把`0`当作高频轮询。

### refetchIntervalInBackground

默认 `refetchIntervalInBackground:false`：页面不在前台时，定时器仍然存在，但每次 tick 会先检查 `focusManager.isFocused()`，未聚焦就跳过这次 fetch；页面回到前台后，后续 tick 可以继续执行。

```tsx
useQuery({
  queryKey: ['dashboard'],
  queryFn: getDashboard,
  refetchInterval: 10_000,
  refetchIntervalInBackground: true
})
```

设置为 `true` 后，即使页面在后台，轮询 tick 也可以发起 fetch。只适合确实要求后台持续更新的页面；普通列表、详情页维持默认值，避免额外流量、服务端压力和设备耗电。

> 页面重新聚焦时是否立刻刷新，由独立的 `refetchOnWindowFocus` 配置决定；`refetchIntervalInBackground:false` 本身不会在回到前台的瞬间补一次请求，只是允许后续轮询tick继续执行。

### 多Observer和请求协调

同一个 Query 可以被多个 Observer 订阅，每个 Observer 拥有自己的轮询频率，但它们最终都进入同一个 `Query.fetch()`：

```
Observer-A：每2秒 ─┐
                   ├─→ 同一个Query.fetch()
Observer-B：每10秒 ┘
```

- 多个定时器不等于多份缓存，Query仍然按 `queryHash` 共享。
- 轮询 tick 到来时如果该 Query 已有请求进行中，Observer 内部没有传 `cancelRefetch:true`；Query 会复用当前 Retryer 的Promise，不会为了这次 tick 取消并重启请求。
- 定时器只决定“什么时候尝试fetch”；当前是否允许真正执行还受 `networkMode` 控制。默认 `online` 模式离线时会进入 paused，而不是硬发HTTP，详见 `network-mode.md`。
- `fetchStatus:'fetching'` 描述的是整个 fetch/retry 流程处于活跃状态，不保证每一刻都有 queryFn 或 HTTP 在途；在线等待`retryDelay` 时也可能仍为 `fetching`。

## refetch / fetchNextPage 请求协调

二者都是 Observer 对外方法，最终都进入同一个Query的 `fetch()`：

```
observer.refetch() ─────────┐
                            ├─→ query.fetch()
fetchNextPage() ────────────┘
```

这不是“整个应用一把全局锁”，而是 **每个queryHash一套请求协调状态**。

```
Query 正在 fetch
├─ 还没有 data（首次加载）
│   └─ 复用当前 Promise，不重复启动
└─ 已经有 data（后台刷新/加载更多）
    ├─ cancelRefetch:true【默认】
    │   └─ 取消/忽略前一次结果，再启动本次请求
    └─ cancelRefetch:false
        └─ 不启动新请求，复用当前 Promise
```

> 默认机制保证旧结果不会和新结果一起乱写 Query，但不等于底层永远只有一个 HTTP 请求。若请求库没有真正使用 AbortSignal，被取消的旧HTTP 仍可能在网络中运行，只是结果不再写入 Query。

`fetchNextPage()` 还受 Infinite Query behavior 约束：

- 已有 data，且 `getNextPageParam` 返回有效参数：默认 `cancelRefetch:true` 下，重复调用会重新执行 queryFn，前一次结果被忽略。
- 已有 data，但下一页参数是 `null/undefined`：behavior 直接返回旧 data，不调用 queryFn；外层 `Query.fetch()` 仍完成success状态收尾。
- 首次加载尚无 data：复用当前首屏请求 Promise，不取消并重启。

业务侧仍建议使用 `hasNextPage && !isFetching` 限制触发，避免请求互相覆盖和浪费网络。

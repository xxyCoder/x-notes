# Query 与 Observer

> 校对基线：
>
> - 发布版本：[`release-2026-08-26-0900`](https://github.com/TanStack/query/releases/tag/release-2026-08-26-0900)，`@tanstack/react-query@5.102.5`、`@tanstack/query-core@5.102.5`。
> - 源码提交：[`1836e61`](https://github.com/TanStack/query/tree/1836e61b8ccc42a79399fc98047bb324d20de8e2)。
> - 官网概念入口：[useQuery](https://tanstack.com/query/latest/docs/framework/react/reference/useQuery)（滚动更新，不作为固定版本证据）。
> - 固定文档快照：[`useQuery.md`](https://github.com/TanStack/query/blob/1836e61b8ccc42a79399fc98047bb324d20de8e2/docs/framework/react/reference/useQuery.md)。
> - 适用边界：Observer、Retryer和Query内部协调只按上述提交及文档快照解释。

```
                  Query（同QueryClient + queryHash唯一）
        ┌──────────────────────────────────────────────────┐
        │ state：原始data / error / dataUpdatedAt           │
        │        isInvalidated / fetchStatus                │
        │ observers[]：保存全部订阅者                       │
        │ fetch()：同一Query的请求协调入口                   │
        │ gcTime：零Observer后的回收策略                     │
        └──────────────────────┬───────────────────────────┘
                               │ state变化广播
             ┌─────────────────┴─────────────────┐
             ▼                                   ▼
┌────────────────────────┐          ┌────────────────────────┐
│ QueryObserver-A        │          │ QueryObserver-B        │
├────────────────────────┤          ├────────────────────────┤
│ 私有配置               │          │ 私有配置               │
│ staleTime / select     │          │ staleTime / select     │
│ placeholderData        │          │ placeholderData        │
│ refetchOnXXX / interval│          │ refetchOnXXX / interval│
│ select结果结构共享     │          │ select结果结构共享     │
├────────────────────────┤          ├────────────────────────┤
│ refetch()              │          │ refetch()              │
│ InfiniteObserver额外有 │          │ InfiniteObserver额外有 │
│ fetchNextPage()        │          │ fetchNextPage()        │
└───────────┬────────────┘          └────────────┬───────────┘
            │                                    │
            └──────────────┬─────────────────────┘
                           ▼
                     同一个Query.fetch()
```

> `useQuery`创建`QueryObserver`；`useInfiniteQuery`创建继承自QueryObserver的`InfiniteQueryObserver`。
>
> `structuralSharing`有两层用途：Query写入queryFn原始结果时，会对共享缓存做一次结构共享；Observer执行`select/placeholderData`后，还会对自己的输出再做一次结构共享。后者是Observer本地行为，前者不是每个Observer各自保存一份原始缓存。

## 数据流

```
Query原始state变化
     ↓ 广播给Observer
Observer.createResult()
     ↓ 当前Query无data时，计算placeholderData
     │   previousData来自“上一个有数据Query的原始state.data”
     ↓ select（Observer本地转换，不改Query缓存）
     ↓ structuralSharing（对select结果做引用复用）
     ↓ 生成Observer Result
     ↓ 属性追踪判断组件是否真的需要重渲染
React组件
```

- `placeholderData`不写入QueryCache，只是Observer当前输出的临时数据。
- `placeholderData(prev => prev)`的`prev`是上一个有数据Query的**原始缓存data**，不是已经经过select的上一轮组件输出。
- placeholder产生的数据也会继续经过当前Observer的`select`。
- Query写入原始data时也会做structural sharing；Observer对select后的结果还会再做一次引用复用。
- `select`抛错时，当前Observer会保存select error，并把自己的Result变成`status:'error'`；底层Query原始data和状态不变，同Query的其他Observer仍按各自的`select`生成结果。

## 生命周期

```
useQuery执行
    ↓
创建Observer
    ↓
QueryCache.build：先找到/创建Query
    ↓
组件订阅：query.addObserver(observer)
    ↓
Observer判断shouldFetchOnMount
    ↓
需要请求时调用query.fetch()

组件卸载
    ↓
Observer取消订阅/销毁
    ↓
最后一个Observer离开 → Observer数量变成0 → 进入GC管理
```

- 一个组件离开，但同Query仍有其他Observer：不会启动gc回收，也不会因此取消请求；此时是否属于active，取决于剩余Observer中是否至少有一个`enabled`解析结果不为`false`。
- `previousData`保存在Observer实例上，不是全局记录。React组件卸载后再次挂载通常会创建新Observer，因此不会继承旧实例的记录；但`QueryObserver.destroy()`本身没有清空该字段，手动复用同一个Observer实例时不能声称引用已被destroy清除。
- Query不会随组件立即删除。最后一个Observer离开时会按有限`gcTime`安排回收；若无Observer的fetch随后结束，源码会重新安排计时。
- 新增Observer会清除当前定时器；定时器到点时仍须满足“零Observer且`fetchStatus:'idle'`”才会删除。`gcTime:Infinity`不建立定时器。

> `active/inactive`和“是否进入GC管理”是两套判断：前者用于Query Filters，active表示至少有一个enabled Observer；后者只看Observer数量是否已经变成0。因此只剩disabled Observer时，Query是inactive，但不会进入GC管理。

## refetchInterval 自动轮询

`refetchInterval`不是QueryCache的全局定时器，而是每个`QueryObserver`自己的配置和定时器。Observer订阅后维护定时器，取消订阅或销毁时清理；到点后仍然调用当前Query的`fetch()`。

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

固定每5秒刷新：

```tsx
useQuery({
  queryKey: ['job', jobId],
  queryFn: () => getJob(jobId),
  refetchInterval: 5_000
})
```

也可以根据当前Query动态决定频率。函数会收到当前`Query`，返回毫秒数继续轮询，返回`false`停止轮询：

```tsx
useQuery({
  queryKey: ['job', jobId],
  queryFn: () => getJob(jobId),
  refetchInterval(query) {
    return query.state.data?.status === 'running' ? 2_000 : false
  }
})
```

- `refetchInterval`取值是毫秒数、`false`，或者`(query) => number | false | undefined`。动态函数会在Query更新后重新计算，因此适合“任务运行中轮询，完成后停止”。
- 轮询独立于`staleTime`：即使数据仍是fresh，只要定时器满足条件，也会调用fetch。`staleTime`主要控制挂载、聚焦、重连等触发点是否需要刷新，不是轮询周期。
- `enabled:false`、`refetchInterval:false`、间隔为`0`、Observer未订阅以及服务端渲染环境都不会建立轮询定时器。需要停止时应明确返回`false`，不要把`0`当作高频轮询。

### refetchIntervalInBackground

默认`refetchIntervalInBackground:false`：页面不在前台时，定时器仍然存在，但每次tick会先检查`focusManager.isFocused()`，未聚焦就跳过这次fetch；页面回到前台后，后续tick可以继续执行。

```tsx
useQuery({
  queryKey: ['dashboard'],
  queryFn: getDashboard,
  refetchInterval: 10_000,
  refetchIntervalInBackground: true
})
```

设置为`true`后，即使页面在后台，轮询tick也可以发起fetch。只适合确实要求后台持续更新的页面；普通列表、详情页维持默认值，避免额外流量、服务端压力和设备耗电。

> 页面重新聚焦时是否立刻刷新，由独立的`refetchOnWindowFocus`配置决定；`refetchIntervalInBackground:false`本身不会在回到前台的瞬间补一次请求，只是允许后续轮询tick继续执行。

### 多Observer和请求协调

同一个Query可以被多个Observer订阅，每个Observer拥有自己的轮询频率，但它们最终都进入同一个`Query.fetch()`：

```
Observer-A：每2秒 ─┐
                   ├─→ 同一个Query.fetch()
Observer-B：每10秒 ┘
```

- 多个定时器不等于多份缓存，Query仍然按`queryHash`共享。
- 轮询tick到来时如果该Query已有请求进行中，Observer内部没有传`cancelRefetch:true`；Query会复用当前Retryer的Promise，不会为了这次tick取消并重启请求。
- 定时器只决定“什么时候尝试fetch”；当前是否允许真正执行还受`networkMode`控制。默认`online`模式离线时会进入paused，而不是硬发HTTP，详见`network-mode.md`。
- `fetchStatus:'fetching'`描述的是整个fetch/retry流程处于活跃状态，不保证每一刻都有queryFn或HTTP在途；在线等待`retryDelay`时也可能仍为`fetching`。

## refetch / fetchNextPage 请求协调

二者都是Observer对外方法，最终都进入同一个Query的`fetch()`：

```
observer.refetch() ─────────┐
                            ├─→ query.fetch()
fetchNextPage() ────────────┘
```

这不是“整个应用一把全局锁”，而是**每个queryHash一套请求协调状态**。

```
Query正在fetch
├─ 还没有data（首次加载）
│   └─ 复用当前Promise，不重复启动
└─ 已经有data（后台刷新/加载更多）
    ├─ cancelRefetch:true【默认】
    │   └─ 取消/忽略前一次结果，再启动本次请求
    └─ cancelRefetch:false
        └─ 不启动新请求，复用当前Promise
```

> 默认机制保证旧结果不会和新结果一起乱写Query，但不等于底层永远只有一个HTTP请求。若请求库没有真正使用AbortSignal，被取消的旧HTTP仍可能在网络中运行，只是结果不再写入Query。

`fetchNextPage()`还受Infinite Query behavior约束：

- 已有data，且`getNextPageParam`返回有效参数：默认`cancelRefetch:true`下，重复调用会重新执行queryFn，前一次结果被忽略。
- 已有data，但下一页参数是`null/undefined`：behavior直接返回旧data，不调用queryFn；外层`Query.fetch()`仍完成success状态收尾。
- 首次加载尚无data：复用当前首屏请求Promise，不取消并重启。

业务侧仍建议使用`hasNextPage && !isFetching`限制触发，避免请求互相覆盖和浪费网络。

## invalidateQueries 链路

```
queryClient.invalidateQueries({ queryKey: ['feed'] })
    ↓
QueryClient找到匹配Query
    ↓
query.invalidate()
    ↓
原来未失效：isInvalidated=true，并广播state变化给全部Observer
已经失效：不重复dispatch，也不重复广播
    ↓
QueryClient默认调用refetchQueries(type:'active')
    ↓
active且未被判定为disabled、`query.isStatic()`不为true的Query执行`query.fetch()`
```

- Query从未失效变为失效时会广播，Observer重新计算`isStale`和结果；如果原本已经失效，则没有重复状态广播。
- 网络请求由QueryClient的`refetchQueries`阶段主动发起，不是Observer根据`refetchOnMount/refetchOnWindowFocus`决定。
- `refetchType:'none'`：只执行幂等invalidate，不立即请求；仅在失效状态实际发生变化时广播。
- 默认`refetchType:'active'`：没有活跃Observer时只标失效，不发网络。

> invalidate状态更新和refetch编排是两步：Query即使原本已经失效，本次`invalidateQueries`仍会按`refetchType`处理后续刷新。

## 关键坑点

1. `refetch()`属于Observer，Query内部真正提供的是`fetch()`。
2. `fetchNextPage()`属于InfiniteQueryObserver，但仍然进入同一个`Query.fetch()`，不是脱离Query自行push缓存。
3. 请求协调是Query级，不是应用全局锁；默认cancel-and-restart也不等于底层HTTP绝对单请求。
4. `placeholderData(previousData)`读取当前Observer实例记录的上一个Query原始data；React重新挂载产生的新Observer不继承旧实例记录，但`destroy()`本身不负责清空该字段。
5. `invalidateQueries`包含“标记失效 + 按refetchType刷新”两步，Observer的`refetchOnXXX`不控制这次显式刷新。
6. 同Query的多个Observer可以拥有不同`staleTime/select/placeholderData`；全部都会收到Query事件，但不一定全部触发React重渲染。`structuralSharing`要区分共享Query原始数据和Observer本地select结果两层。
7. `refetchInterval`属于Observer且不受`staleTime`阻止；多个Observer可以有不同轮询频率，但请求仍由同一个Query协调。
8. `refetchIntervalInBackground:false`只是让后台tick跳过fetch，不是销毁定时器，也不负责聚焦瞬间补请求。

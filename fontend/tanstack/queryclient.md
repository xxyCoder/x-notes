# TanStack Query v5 完整链路

> 校对基线：
>
> - 发布版本：[`release-2026-08-26-0900`](https://github.com/TanStack/query/releases/tag/release-2026-08-26-0900)，`@tanstack/react-query@5.102.5`、`@tanstack/query-core@5.102.5`。
> - 源码提交：[`1836e61`](https://github.com/TanStack/query/tree/1836e61b8ccc42a79399fc98047bb324d20de8e2)。
> - 官网概念入口：[QueryClient](https://tanstack.com/query/latest/docs/reference/QueryClient)（滚动更新，不作为固定版本证据）。
> - 固定文档快照：[`QueryClient.md`](https://github.com/TanStack/query/blob/1836e61b8ccc42a79399fc98047bb324d20de8e2/docs/reference/QueryClient.md)。
> - 适用边界：公开API和内部行为只按上述版本、提交及文档快照解释；项目使用时仍以实际安装版本为准。

```
┌────────────────────────────────────────────────────────────────┐
│                  QueryClient【门面 + 调度器】                    │
│  ┌──────────────────┐             ┌──────────────────────────┐ │
│  │ queryCache       │             │ mutationCache            │ │
│  │ (QueryCache实例) │             │ (MutationCache实例)      │ │
│  └────────┬─────────┘             └────────────┬─────────────┘ │
│           │                                    │               │
│  存储所有Query对象                    存储每次Mutation执行记录   │
│  Query保存服务端资源数据              保存data/error/variables  │
│  Query支持gcTime                      Mutation同样支持gcTime    │
└───────────┼────────────────────────────────────┼───────────────┘
            │                                    │
            ▼                                    ▼
┌──────────────────────────┐       ┌────────────────────────────┐
│ Query对象                │       │ Mutation对象               │
│ 每个queryHash对应1个实例 │       │ 每次mutate()生成1个实例    │
│ ├ state                  │       │ ├ state                    │
│ │ data/error             │       │ │ data/error/variables     │
│ │ dataUpdatedAt          │       │ │ status/submittedAt       │
│ │ errorUpdatedAt         │       │ ├ observers[]              │
│ │ isInvalidated          │       │ └ gcTime：执行记录回收     │
│ ├ observers[]            │       │                            │
│ ├ fetch()：请求协调入口  │       │                            │
│ └ gcTime：Query对象回收  │       │                            │
└────────────┬─────────────┘       └─────────────┬──────────────┘
             │                                   │
             ▼                                   ▼
┌──────────────────────────┐       ┌────────────────────────────┐
│ QueryObserver            │       │ MutationObserver           │
│ useQuery创建             │       │ useMutation创建            │
│ InfiniteQueryObserver    │       │ mutate()时才创建Mutation   │
│ useInfiniteQuery创建     │       │ mutation成功不会自动更新   │
│ 组件订阅/取消订阅Query   │       │ QueryCache                 │
└────────────┬─────────────┘       └────────────────────────────┘
             ▼
React组件：拿到data/isPending/isFetching等结果渲染
```

> 一条`queryKey`经过hash得到`queryHash`；“一个key一个Query”准确说是：同一个`QueryClient`内，相同`queryHash`复用同一个Query。

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

同一key可能同时匹配多组defaults；源码按注册顺序合并，
所以通用key先注册，具体key后注册，让具体配置最后覆盖。
```

- 浏览器端由Observer驱动的Query默认重试3次；服务端默认不重试。命令式`queryClient.query/fetchQuery/prefetchQuery`先合并Query defaults；合并后`retry`仍为`undefined`时，才补成不重试。
- Mutation默认`retry:0`，即失败后不重试；配置`false`也表示不重试。
- fresh/stale不是Query state里一份全局统一的结论；Query保存`dataUpdatedAt/isInvalidated`等事实状态。Observer结合各自的`staleTime`计算；命令式`queryClient.query/fetchQuery`也会用本次配置的`staleTime`判断是否需要请求。
- `gcTime`从对象创建时就开始调度：Query/Mutation构造时就会`scheduleGc()`，不是等“执行结束”才开始计时。
- Query在无Observer时安排回收；若无Observer的fetch随后结束，会重新安排计时。
- Mutation在无人观察时就安排回收；到点仍pending则继续保留并重新安排，只有settled后才允许删除。
- 同一对象先后收到不同`gcTime`时保留较大值。浏览器端默认5分钟，服务端默认`Infinity`；`Infinity`不会建立GC定时器。

## QueryClient 门面方法调度链路

> QueryClient不是把方法原样转发给QueryCache；QueryCache负责存储/查找，QueryClient负责筛选和编排，再调用Query自身方法。

```
getQueryData(key)
→ 计算queryHash
→ queryCache.get(queryHash)?.state.data

setQueryData(key, updater)
→ 读取现有Query的data并执行updater
→ 结果为undefined：直接返回，不创建Query也不更新已有Query
→ 结果非undefined：queryCache.build → query.setData()

invalidateQueries(filters)
→ queryCache.findAll(filters)
→ 每个query.invalidate()（已经失效时不重复dispatch）
→ 默认refetchQueries(type:'active')
→ query.fetch()

cancelQueries(filters)
→ queryCache.findAll(filters)
→ 每个query.cancel()

removeQueries(filters)
→ queryCache.findAll(filters)
→ queryCache.remove(query)

resetQueries(filters)
→ queryCache.findAll(filters)
→ 每个query.reset()
→ 从active Query中筛选，并排除当前query.isDisabled()或query.isStatic()为true的Query后重新请求
```

## 完整数据流两条链路

### 链路1：读请求 useQuery

1. `useQuery`合并全局、queryKey默认配置和局部配置。
2. 创建`QueryObserver`；Observer先通过`QueryCache.build`找到或创建Query。
3. 组件正式订阅时，Observer执行`query.addObserver(this)`。
4. Observer判断挂载时是否请求：
   - 没有data且`enabled`解析结果不为`false`：通常执行`query.fetch()`；如果Query已经报错且`retryOnMount:false`，则不重试。
   - `enabled:false`或使用`skipToken`：不自动请求。新建且从未完成过请求、没有data的Query是`pending + idle`；已有Query会保留原状态，例如无data的error Query仍是`error + idle`。
   - 有data且fresh：默认直接复用缓存。
   - 有data但stale：默认后台refetch。
   - `refetchOnMount:false`可禁止stale挂载刷新；`refetchOnMount:'always'`可让fresh数据也刷新（`staleTime:'static'`除外）。
5. Query状态变化，广播给全部Observer；每个Observer计算自己的`select/placeholderData`结果，再决定是否通知组件渲染。
6. 最后一个Observer离开后，Query进入GC管理。`gcTime`是有限值时才建立倒计时；到期后，只有Observer数量仍为0且`fetchStatus === 'idle'`，Query才会从QueryCache删除。

   `paused`虽然没有执行queryFn，但不等于`idle`，本次GC检查不会删除它。`gcTime:Infinity`不会建立定时器。

> `active/inactive`是Query Filters的筛选语义：至少一个Observer的`enabled`解析结果不为`false`时，Query是active；否则是inactive。
>
> 这与GC条件不同。只剩disabled Observer的Query属于inactive，但Observer数量不为0，不会启动GC。`prefetchQuery`创建的Query没有Observer，因此从创建起就受`gcTime`管理；`setQueryData`只有在新data非`undefined`、实际创建Query时才属于这种情况。

### 链路2：写请求 useMutation

1. `useMutation`只创建`MutationObserver`；调用`mutate(variables)`时才创建Mutation实例。
2. Mutation存入MutationCache并进入pending；新调用会先等待MutationCache级`onMutate`，再等待hook级`onMutate`。只有hook级`onMutate`的返回值会记录为后续回调使用的context。
3. `onMutate`完成后启动Retryer；只有网络模式和scope顺序允许时才执行`mutationFn`。成功结果只写入Mutation自己的`state.data`，不会自动修改QueryCache。
4. 业务手动选择：
   - `invalidateQueries`：标记匹配Query失效，默认尝试重新请求符合执行条件的active Query。
   - `setQueryData`：直接把服务端返回或乐观结果写入Query缓存。
5. Mutation无人观察后进入gcTime管理；如果仍是pending，不会因为gcTime到期而强行删除，完成后才可回收。

## Query 与 Mutation 状态怎么判断

### Query：status 和 fetchStatus 是两个维度

Query不能只看一组`isXXX`。底层Query同时描述“当前有没有可用结果”和“Query当前处于哪一种fetch流程状态”：

```
status【数据结果状态】
├─ pending：当前没有可用data，且尚未进入最终error
├─ success：当前有成功结果
└─ error：最近一次执行最终失败；仍可能保留旧data

fetchStatus【fetch流程状态】
├─ fetching：fetch/retry流程活跃，且当前未paused/idle
├─ paused：想执行，但当前执行条件不允许
└─ idle：当前没有活跃的fetch流程
```

`useQuery`返回的Observer Result通常基于这两个状态派生；`placeholderData/select`还可能只调整当前Observer的输出，不修改底层Query状态：

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

- `isPending`表示当前Observer Result仍处于pending；通常没有可用data，但可能在等待enabled或网络条件，不保证queryFn正在运行。
- `isFetching`表示Query处于活跃fetch/retry流程；首次加载和有旧数据的后台刷新都会是`true`。它不保证每一刻都有HTTP在途：在线状态下等待`retryDelay`时也可能保持`true`。
- `isLoading`才是“当前没有可用data，并且fetch流程已经启动”，适合控制首次全屏Loading；它同样可能覆盖失败后的重试等待时间。
- `isRefetching`表示已经不处于pending，但当前又在fetch，通常用于保留旧内容时显示小型刷新状态。
- 在5.102.5中，`isInitialLoading`只是`isLoading`的废弃别名，新代码直接使用`isLoading`。

常见组合：

```
场景                              status      fetchStatus   关键布尔值
首次fetch/retry流程活跃            pending     fetching      isPending + isLoading
enabled:false且从未请求           pending     idle          isPending，isLoading=false
首次请求因离线暂停                pending     paused        isPending + isPaused
已有数据，当前没有刷新            success     idle          isSuccess
已有数据，正在后台刷新            success     fetching      isSuccess + isFetching + isRefetching
已有数据，后台刷新因离线暂停      success     paused        isSuccess + isPaused
```

所以不能写成“`isPending`就一定显示加载动画”。无缓存的dependent query在`enabled:false`时也是`pending + idle`；默认`online`模式离线时可能是`pending + paused`，这两种情况都没有正在执行的请求。

#### Query错误状态

Query刷新失败时可能仍保留上一次成功的data，因此`isError`不等于“一定没有内容可展示”：

```
isLoadingError = isError && data === undefined
isRefetchError = isError && data !== undefined
```

- `isLoadingError`：首次获取就失败，没有旧数据，通常展示完整错误页。
- `isRefetchError`：已有旧数据，后台刷新失败；通常继续展示旧数据，同时给出刷新失败提示。

这两个字段的精确定义只是“当前Observer错误时有没有data”，不负责判断错误来源。上面是queryFn错误时的常见解释；`select`抛错也可能产生`isLoadingError`或`isRefetchError`。

`select`抛错是另一条Observer本地错误链路：

```
Query原始请求成功，缓存中仍是status:'success' + 原始data
    ↓ 当前Observer执行select时抛错
当前Observer Result变成status:'error' + isError:true
    ↓
QueryCache原始data不变，同Query的其他Observer也不一定报错
```

因此组件拿到`isError:true`时，不一定都是queryFn或网络请求失败；配置了`select`时，还要结合当前Observer的`error`判断是否为转换逻辑异常。

一个实用的页面判断顺序：

```
isLoadingError                    → 首次错误UI
isPending + isPaused              → 离线等待提示
isPending + fetchStatus === idle  → 等待enabled条件，或尚未开始
isLoading                         → 首次加载UI
已有data                          → 正常内容
  ├─ isFetching                   → 附加刷新提示
  └─ isRefetchError               → 保留内容并提示刷新失败
```

不能把“无data + idle”放在`isLoadingError`前面：首次请求最终失败也是`data:undefined + fetchStatus:'idle'`，但此时`status:'error'`，应该先进入错误UI。

> `isFetched`的底层判断是`dataUpdateCount + errorUpdateCount > 0`，表示Query至少发生过一次数据更新或错误更新。`isFetchedAfterMount`比较当前计数和Observer挂载时的初始计数。
>
> 它们不等于“网络请求完成过”。Observer挂载后调用`setQueryData`也会增加`dataUpdateCount`，使`isFetchedAfterMount`变成`true`；二者也都不表示当前正在fetch。
>
> 这里讨论的是`useQuery`拿到的Observer Result。配置`placeholderData`且实际得到非`undefined`结果时，Observer会先把临时结果标记为`status:'success' + isPlaceholderData:true`，但底层Query可能仍是pending，placeholder也没有写进QueryCache。
>
> placeholder随后还要经过`select`；如果`select`抛错，Observer Result会变成error，`isPlaceholderData`也会重置为false。因此只有placeholder有效且`select`成功时，才能看到这组临时success状态，不能把它当成服务端请求已经成功。

### Mutation：只有一套status，另外叠加isPaused

Mutation没有Query的缓存刷新语义，所以没有`fetchStatus/isLoading/isFetching/isRefetching`：

```
status
├─ idle：还没有调用mutate，或已经reset
├─ pending：本次写动作尚未结束
├─ success：本次写动作成功
└─ error：本次写动作失败

isIdle    = status === 'idle'
isPending = status === 'pending'
isSuccess = status === 'success'
isError   = status === 'error'
```

Mutation提交按钮通常直接使用`isPending`防止重复操作：

```tsx
const saveMutation = useMutation({ mutationFn: saveTodo })

<button
  disabled={saveMutation.isPending}
  onClick={() => saveMutation.mutate(todo)}
>
  保存
</button>
```

`isPaused`是叠加在`pending`上的另一个维度：

```
pending + isPaused:false
└─ onMutate / mutationFn / retry / 等待异步回调正在进行

pending + isPaused:true
├─ networkMode:'online'首次启动时等待恢复在线
├─ online/offlineFirst的retry阶段等待恢复在线
├─ 任意networkMode的retry阶段等待页面重新focused
└─ 任意networkMode下等待相同scope.id的前一个Mutation结束
```

- `useMutation`配置中的`onMutate/onSuccess/onError/onSettled`保存在Mutation options中。组件卸载、Observer离开后，只要Mutation继续执行，这些回调仍会运行。
- Mutation会等待这些hook级回调返回的Promise；受等待的回调结束后，状态才进入success或error。
- 在5.102.5中，成功路径的hook级或MutationCache级`onSuccess/onSettled`如果throw或reject，会转入错误路径，继续执行`onError`和错误路径的`onSettled`，最终状态变成error。
- 错误路径的`onError/onSettled`自身抛错不会替换原始mutation错误，但会产生额外的rejected Promise。
- `mutate(variables, callbacks)`里的单次回调依赖当前MutationObserver：Observer必须仍有订阅者，并且该Mutation仍是Observer正在观察的最新一次执行。组件卸载或再次调用`mutate`后，前一次执行的单次回调可能不再触发。
- 单次回调在Mutation已经dispatch success/error后执行；框架不等待其返回值。它们throw不会改写Mutation最终状态，但会产生额外的rejected Promise。
- 需要可靠串联异步流程时，应把逻辑放进hook级异步回调，或对每次调用分别`await mutateAsync()`返回的Promise；不要依赖单次回调的返回值。
- `isPaused:true`仍属于pending，不应把它渲染成成功或失败；可以显示“等待联网后提交”等单独状态。
- `data/error/variables/submittedAt/failureCount`都是最近一次由当前MutationObserver观察的Mutation执行记录，不是Query资源缓存。
- `reset()`只是让当前MutationObserver回到idle并脱离当前Mutation，不会撤销已经发到服务端的写操作。

### 全局数量状态

单个hook状态之外：

- `useIsFetching(filters)`返回当前匹配且`fetchStatus:'fetching'`的Query数量，不包含paused Query。
- `useIsMutating(filters)`返回当前匹配且`status:'pending'`的Mutation数量；paused Mutation仍是pending，因此会被统计。
- 二者返回的是数量，不是boolean；全局进度条通常判断是否`> 0`。

### Mutation为什么有gcTime、没有staleTime

```
Mutation不是“某份服务端资源缓存”
而是“一次写动作的执行记录”
```

- 不需要`staleTime`：Mutation不存在“数据旧了自动重新提交”的语义。
- 需要`gcTime`：每次`mutate()`都会新增记录，必须防止MutationCache无限增长。
- 保留期间可供当前Observer、`useMutationState({ filters: { mutationKey } })`、Devtools和离线恢复读取。
- 完全不需要跨组件状态/Devtools/离线能力时，可以把`gcTime`配置得更短。
- `gcTime:0`也不是同步删除开关：回收仍通过定时任务执行，pending Mutation仍会保留到结束，不建议把0当成通用默认值。

## invalidateQueries：失效和请求是两个动作

```
queryClient.invalidateQueries({ queryKey: ['feed'] })
    ↓
1. query.invalidate()：仅在原来未失效时设置isInvalidated=true并广播；已经失效时不重复dispatch
    ↓
2. 默认refetchType:'active'：QueryClient主动调用refetchQueries
    ↓
3. active且未被判定为disabled、`query.isStatic()`不为true的Query执行`query.fetch()`
```

> invalidate状态更新是幂等的，但refetch编排仍会继续：Query原本已经失效时，本次`invalidateQueries`不会重复广播invalidate事件，仍会按`refetchType`尝试刷新符合条件的Query。

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
>
> 在5.102.5里，`isStatic()`只检查当前Observer。没有Observer的inactive Query，不会仅因上次配置过`staleTime:'static'`就被这里排除。

## 关键坑点汇总

1. QueryCache存Query；MutationCache存Mutation执行记录。Mutation的`state.data`会保存本次响应，但不会充当Query资源缓存。
2. Query和Mutation都有`gcTime`；只有Query有fresh/stale语义，Mutation没有`staleTime`。
3. Mutation成功不会自动更新QueryCache；如果相关UI依赖QueryCache反映这次写入，需要显式同步，常见方式是`invalidateQueries`或`setQueryData`。
4. `invalidateQueries`默认不是“只标stale”：它先invalidate，再由QueryClient主动刷新符合执行条件的active Query；不是Observer根据`refetchOnXXX`自行决定。
5. `refetchOnWindowFocus/refetchOnMount`通常只刷新stale Query；配置为`'always'`时，fresh Query也能请求，`staleTime:'static'`除外。
6. 5.102.5的`Query.isStatic()`使用`observers.some(...)`：同一Query只要有一个Observer使用`'static'`，批量refetch就会跳过整条Query。这是版本相关的内部实现，不是跨版本契约。
7. `setQueryData`默认把`dataUpdatedAt`更新为当前时间；可传`updatedAt`显式控制时间戳。
8. Query的Observer数量变成0时才进入GC管理；只有`gcTime`是有限值时才建立定时器。inactive只表示没有enabled Observer，不能直接推出它正在等待GC。
9. 同Query的多个Observer可以有不同`staleTime/select/placeholderData`；Query广播给所有Observer，但结构共享和属性追踪可能阻止无意义的组件重渲染。
10. Query的`isPending`表示当前Observer Result处于pending，`isLoading`才表示pending期间fetch/retry流程已经启动；disabled或paused Query都可能`isPending:true + isLoading:false`。
11. queryFn错误时，可用`isLoadingError/isRefetchError`按当前Observer是否还有data区分UI；`select`异常也会影响这两个字段，不能只凭字段名断定错误来源。
12. Mutation没有`isLoading/isFetching`；提交中使用`isPending`，并用`isPaused`继续区分离线等待或scope串行排队。

## 极简文字版

```
QueryClient
├─ QueryCache：保存/查找Query
├─ MutationCache：保存每次Mutation执行记录
└─ 负责筛选、批处理并调用Query/Mutation能力

Query
├─ state(data/error/dataUpdatedAt/isInvalidated)
├─ observers[]
├─ fetch()：同queryHash的请求协调入口
└─ Observer数量为0后按有限gcTime回收；Infinity不建立回收定时器

Mutation
├─ state(data/error/variables/status)
├─ 没有staleTime，不会因为“旧”而重放写请求
└─ 无人观察时按有限gcTime调度回收；pending到期不删，Infinity不建立回收定时器

读链路：useQuery → QueryObserver → QueryCache.build → Query.fetch → Observer结果 → 组件
写链路：useMutation → MutationObserver → mutate() → MutationCache；相关QueryCache需要反映写入时，再显式同步/失效Query
```

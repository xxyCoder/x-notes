# TanStack Query v5 select + placeholderData + useInfiniteQuery

```
TanStack Query 两层模型
├─ QueryCache（QueryClient级，和组件无关）
│   └─ 保存 Query 实例；相同 queryHash 复用同一个 Query
│       └─ state:{data,error,dataUpdatedAt,isInvalidated,status...}
└─ QueryObserver（每个hook订阅者独立）
    ├─ 订阅 Query state 变更
    ├─ staleTime：按 Observer 配置判断 fresh/stale
    ├─ select：Observer本地转换，❌不修改 Query 原始 data
    └─ placeholderData：Observer 临时输出，❌不写入QueryCache
```

## 一、select 模块

```
select（Observer能力）
├─ 作用：对 Query 原始 data 做投影/过滤，输出给组件
├─ 重新执行条件
│   1. Query 原始 data 引用发生变化
│   2. select 函数引用发生变化【高频坑】
│       └─ 组件内写内联箭头函数，每次渲染生成新函数 → 重新执行 select
├─ 稳定 select 函数
│   └─ 抽离组件外部，或使用 useCallback
│       └─ 只稳定函数；map 仍会生成新数组
└─ structuralSharing（默认开启）
    ├─ 对比 select 新旧结果；内容相同则尽量复用对象引用
    ├─ 默认只保证 JSON 兼容数据；Date/Map/Set 应自定义 structuralSharing
    └─ structuralSharing:false 只关闭引用复用，≠关闭网络缓存
```

## 二、placeholderData

```
placeholderData(previousData, previousQuery)
├─ previousData 来自 Observer 记录的“上一个有 data 的 Query.state.data”
│   ├─ 是原始缓存 data，不是上一轮经过 select 的组件输出
│   ├─ 不是按 queryKey 主动查全局缓存
│   └─ 记录属于 Observer 实例；新 Observer 不继承，destroy() 本身不清空
├─ 生效前提：当前 Query 没有真实 data，状态为 pending
├─ 返回 undefined：不应用 placeholder
├─ 返回非 undefined：临时标记 success 和 isPlaceholderData=true
├─ placeholder 不会写 QueryCache
└─ 随后经过当前 Observer 的 select；selec t抛错会转为 error 并清除 isPlaceholderData
```

经典场景：同组件切换分页 `queryKey:['list', page]`。

```
page变化
→ Observer 切换到新 Query
→ 新 Query 还没有 data，后台请求
→ placeholderData(prev => prev)临时展示上一个 Query 的原始 data
→ 当前 select 再把它转换成组件需要的形状
```

跨 key 主动拿缓存（例如列表生成详情预览），需要明确查询：

```
placeholderData: () => {
  const list = queryClient.getQueryData<Todo[]>(['todo-list'])
  return list?.find(item => item.id === id)
}
```

### placeholderData VS initialData

```
placeholderData
├─ ❌不写入 QueryCache
├─ ❌不修改 Query.dataUpdatedAt
├─ 产出非 undefined 且 select 成功时 isPlaceholderData=true
└─ 纯 Observer 临时结果，不参与 Query 的 gc 回收

initialData
├─ ✅写入 QueryCache，成为 Query 真实初始 data
├─ 默认 dataUpdatedAt=Date.now()，不是0
├─ 可用 initialDataUpdatedAt 传入数据真实更新时间
└─ ✅参与 fresh/stale 判断和 gc 回收
```

> 默认 `staleTime:0`，所以 initialData 虽然默认使用当前时间戳，挂载后仍会立刻被视为 stale 并后台刷新。

## 三、useInfiniteQuery

```
┌──────────────────────────────────────────────────────────────┐
│ Query实例（同QueryClient + queryHash仅1份）                    │
│ state.data: InfiniteData<TPage, TPageParam>                  │
│ {                                                            │
│   pages: TPage[]    // 每项是一次queryFn的单页原始响应           │
│   pageParams: TPageParam[] // 每页参数，与pages下标一一对应      │
│ }                                                            │
│ fetch()：统一请求协调入口                                       │
│ infiniteQueryBehavior：决定本次fetch是下一页/上一页/整组刷新       │
└────────────────────────┬─────────────────────────────────────┘
                         │ state变化广播
                         ▼
┌──────────────────────────────────────────────────────────────┐
│ InfiniteQueryObserver（继承QueryObserver）                    │
│ 配置：initialPageParam、getNextPageParam、maxPages             │
│ 输出：data（默认InfiniteData；select可转换为其他形状）             │
│ 方法：refetch() / fetchNextPage() / fetchPreviousPage()       │
│       全部最终进入同一个Query.fetch()                           │
└────────────────────────┬─────────────────────────────────────┘
                         │ 
                         ▼
                    React组件渲染
```

> 普通 `useQuery` 和 `useInfiniteQuery` 不要共用同一个 `queryKey`。相同 `queryHash` 会复用同一个 Query，但两类 Observer 期待的 data 形状不同：普通 Query 期待普通响应，Infinite Query 期待`{pages,pageParams}`。
>

### v5必填核心配置

```
useInfiniteQuery({
  queryKey: ['feed'],

  // 只返回一页原始接口数据；pages/pageParams由框架组装
  queryFn: async ({ pageParam }) => api.getFeed(pageParam),

  // v5要求提供initialPageParam属性；建议使用可序列化的真实第一页参数
  initialPageParam: 0,

  // undefined或null都表示没有下一页
  getNextPageParam(lastPage, allPages, lastPageParam, allPageParams) {
    return lastPage.nextCursor
  },

  // 最多保留12页；向后加载淘汰最前页，向前加载淘汰最后页
  maxPages: 12
})
```

> v5要求提供 `initialPageParam` 属性，但类型系统没有禁止显式传 `undefined`：`TPageParam` 可以被推导为 `undefined`。
>
> 工程上仍建议使用 `0`、`null` 或真实首游标，便于 dehydrate 和 persist。这是序列化建议，不是运行时禁令。

### Hook 返回核心字段

```
// 未配置select时，TData默认为InfiniteData<TPage, TPageParam>
data?: InfiniteData<TPage, TPageParam>
// data.pages[]：当前缓存保留的全部页
// data.pageParams[]：每页对应的请求参数

// 配置select时，组件拿到的data类型和形状改为select返回值；
// QueryCache里的原始data仍是InfiniteData<TPage, TPageParam>

fetchNextPage      // 加载下一页，最终调用Query.fetch()
fetchPreviousPage  // 加载上一页
hasNextPage        // getNextPageParam返回非null/undefined时为true
hasPreviousPage    // getPreviousPageParam返回非null/undefined时为true
isFetchingNextPage // 正在加载下一页
isFetchingPreviousPage
refetch            // 重新获取当前缓存窗口内的全部页
```

Infinite Query 还会把普通 Query 的错误/刷新状态按“整组刷新”和“加载前后页”拆开：

```
isRefetching
= 基础 QueryObserver 的 isRefetching
  && !isFetchingNextPage
  && !isFetchingPreviousPage

isRefetchError
= 基础 QueryObserver 的 isRefetchError
  && !isFetchNextPageError
  && !isFetchPreviousPageError
```

- Infinite Query 的 isFetching 表示当前有请求，包括刷新已有页面、加载下一页和加载上一页。具体操作再看：
  - isRefetching：正在刷新已有页面。
  - isFetchingNextPage：正在加载下一页。
  - isFetchingPreviousPage：正在加载上一页。

因此加载下一页时，isFetching 和 isFetchingNextPage 都是 true，但 isRefetching 是 false。错误状态也对应区分为 isRefetchError、isFetchNextPageError 和 isFetchPreviousPageError。

## 四、完整执行流程

### 1. 初始化

```
组件挂载
→ 创建 InfiniteQueryObserver
→ QueryCache 找到/创建 Query
→ query.fetch()
→ infiniteQueryBehavior 使用 initialPageParam
→ queryFn({ pageParam: initialPageParam })
→ 生成data:{ pages:[page], pageParams:[initialPageParam] }
→ Query 广播，Observer 更新组件
```

### 2. 下拉加载更多 fetchNextPage()

```
fetchNextPage()
→ InfiniteQueryObserver.fetch({ meta: { fetchMore: { direction: 'forward' } } })
→ Query.fetch() 把 meta 写入 state.fetchMeta
→ infiniteQueryBehavior 按 fetchOptions.meta.fetchMore.direction 识别方向，并读取当前 pages/pageParams
→ getNextPageParam(lastPage, allPages, lastPageParam, allPageParams)
→ nextParam 为 null/undefined 且已有页面？
  ├─ 是：behavior 返回旧 data，不调用 queryFn；Query.fetch 仍完成 success 状态收尾
  └─ 否：queryFn({ pageParam: nextParam })
         → 创建新的 pages/pageParams 数组写回 Query.state.data
         → Query 广播全部 Observer
```

`cancelRefetch` 是调用 `fetchNextPage()` 时的可选参数，用来控制请求尚未结束时的重复调用：

```ts
fetchNextPage()                         // 默认 cancelRefetch: true
fetchNextPage({ cancelRefetch: false })
```

- 默认情况下，重复调用会重新加载下一页，并以后一次调用的结果为准；前一次请求的结果会被忽略。
- 传入 `cancelRefetch:false` 后，如果当前已有请求，本次调用不会排队或启动新请求，而是等待并复用当前请求的结果

通常在调用前同时判断是否还有下一页、当前是否正在请求：

```ts
if (hasNextPage && !isFetching) {
  fetchNextPage()
}
```

这样可以避免重复请求，也不会让加载下一页与当前刷新互相干扰。

### 3. select处理列表（Observer本地转换）

```
select: (infData) => infData.pages.flatMap(page => page.data.rows)
```

select 结果只属于当前 Observer；QueryCache 仍保存完整的 `{pages,pageParams}`。

### 4. invalidateQueries 失效刷新

```text
queryClient.invalidateQueries({ queryKey: ['feed'] })
    ↓
1. QueryClient 将匹配的 Query 标记为失效
    ↓
2. 默认按 refetchType: 'active' 刷新正在使用的 Query
    ↓
3. Query.fetch() 进入 infiniteQueryBehavior
   从当前缓存中保留的第一页开始重建 pages
    ↓
4. 使用第一页原来的 pageParam 请求最新数据
    ↓
5. 根据最新响应重新计算下一页的 pageParam，并依次请求后续页面
   默认最多刷新当前缓存中保留的页数；没有下一页时提前结束
    ↓
6. 将新的 { pages, pageParams } 整体写回 Query，并通知 Observer
```

除第一页外，后续页面不会直接使用原来的旧游标，而是根据前一页的最新响应重新计算。这样可以避免服务端数据变化后，旧游标造成数据重复或遗漏。默认最多刷新当前缓存中保留的页数；如果中途已经没有下一页，则提前结束。

刷新范围由 `refetchType` 控制：

- 默认 `active`：正在被组件使用的 Query 会立即刷新；其他 Query 只标记为 stale。
- `all`：符合请求条件的未使用 Query 也会立即刷新。
- `none`：只标记为 stale，不立即请求。
- `enabled:false` 的 Query 不会被刷新。

只标记失效，不立即请求：

```
queryClient.invalidateQueries({
  queryKey: ['feed'],
  refetchType: 'none'
})
```

## 五、maxPages：缓存窗口

`maxPages` 限制的是“QueryCache 同时保存几页”，不是总共允许用户加载几页，也不会首次自动预取 N 页。

```
initialPageParam: 0
maxPages: 3

加载0 → pageParams [0]
加载1 → pageParams [0,1]
加载2 → pageParams [0,1,2]
加载3 → pageParams [1,2,3]  // 向后加载，淘汰最前面的0
```

此时invalidate/refetch：

```
从oldPageParams[0] = 1开始
→ 刷新页面1
→ 根据新页面1计算页面2参数
→ 根据新页面2计算页面3参数
→ 最多重新请求当前保留的3页
```

- 被淘汰的第0页不会参与这次刷新。
- 上例假设新页面仍能算出后续游标；如果中途返回 `null/undefined`，刷新结果可以少于3页。
- 如果再 `fetchPreviousPage()` 取回第0页，会从数组前面加入0，并淘汰最后面的3。
- 配置 `maxPages > 0` 时，如果业务允许双向翻页，需要同时正确实现 `getNextPageParam/getPreviousPageParam`。
- maxPages 同时降低内存占用和失效刷新时的串行请求数量。

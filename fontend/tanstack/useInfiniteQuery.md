# TanStack Query v5 select + placeholderData + useInfiniteQuery

> 校对基线：
>
> - 发布版本：[`release-2026-08-26-0900`](https://github.com/TanStack/query/releases/tag/release-2026-08-26-0900)，`@tanstack/react-query@5.102.5`、`@tanstack/query-core@5.102.5`。
> - 源码提交：[`1836e61`](https://github.com/TanStack/query/tree/1836e61b8ccc42a79399fc98047bb324d20de8e2)。
> - 官网概念入口：[Infinite Queries](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries)和[`useInfiniteQuery`参考](https://tanstack.com/query/latest/docs/framework/react/reference/useInfiniteQuery)（滚动更新，不作为固定版本证据）。
> - 固定文档快照：[`infinite-queries.md`](https://github.com/TanStack/query/blob/1836e61b8ccc42a79399fc98047bb324d20de8e2/docs/framework/react/guides/infinite-queries.md)和[`useInfiniteQuery.md`](https://github.com/TanStack/query/blob/1836e61b8ccc42a79399fc98047bb324d20de8e2/docs/framework/react/reference/useInfiniteQuery.md)。
> - 适用边界：公开API和内部行为只按上述版本、提交及文档快照解释；项目使用时仍以实际安装版本为准。

```
TanStack Query 两层模型
├─ QueryCache（QueryClient级，和组件无关）
│   └─ 保存Query实例；相同queryHash复用同一个Query
│       └─ state:{data,error,dataUpdatedAt,isInvalidated,status...}
└─ QueryObserver（每个hook订阅者独立）
    ├─ 订阅Query state变更
    ├─ staleTime：按Observer配置判断fresh/stale
    ├─ select：Observer本地转换，❌不修改Query原始data
    └─ placeholderData：Observer临时输出，❌不写入QueryCache
```

## 一、select 模块

```
select（Observer能力）
├─ 作用：对Query原始data做投影/过滤，输出给组件
├─ 重新执行条件
│   1. Query原始data引用发生变化
│   2. select函数引用发生变化【高频坑】
│       └─ 组件内写内联箭头函数，每次渲染生成新函数 → 重新执行select
├─ 稳定select函数
│   └─ 抽离组件外部，或使用useCallback
│       └─ 只稳定函数；map仍会生成新数组
└─ structuralSharing（默认开启）
    ├─ 对比select新旧结果；内容相同则尽量复用对象引用
    ├─ 默认只保证JSON兼容数据；Date/Map/Set应自定义structuralSharing
    └─ structuralSharing:false只关闭引用复用，≠关闭网络缓存
```

## 二、placeholderData

```
placeholderData(previousData, previousQuery)
├─ previousData来自Observer记录的“上一个有data的Query.state.data”
│   ├─ 是原始缓存data，不是上一轮经过select的组件输出
│   ├─ 不是按queryKey主动查全局缓存
│   └─ 记录属于Observer实例；新Observer不继承，destroy()本身不清空
├─ 生效前提：当前Query没有真实data，状态为pending
├─ 返回undefined：不应用placeholder
├─ 返回非undefined：临时标记success和isPlaceholderData=true
├─ placeholder不会写QueryCache
└─ 随后经过当前Observer的select；select抛错会转为error并清除isPlaceholderData
```

经典场景：同组件切换分页`queryKey:['list', page]`。

```
page变化
→ Observer切换到新Query
→ 新Query还没有data，后台请求
→ placeholderData(prev => prev)临时展示上一个Query的原始data
→ 当前select再把它转换成组件需要的形状
```

跨key主动拿缓存（例如列表生成详情预览），需要明确查询：

```
placeholderData: () => {
  const list = queryClient.getQueryData<Todo[]>(['todo-list'])
  return list?.find(item => item.id === id)
}
```

### placeholderData VS initialData

```
placeholderData
├─ ❌不写入QueryCache
├─ ❌不修改Query.dataUpdatedAt
├─ 产出非undefined且select成功时isPlaceholderData=true
└─ 纯Observer临时结果，不参与Query的gc回收

initialData
├─ ✅写入QueryCache，成为Query真实初始data
├─ 默认dataUpdatedAt=Date.now()，不是0
├─ 可用initialDataUpdatedAt传入数据真实更新时间
└─ ✅参与fresh/stale判断和gc回收
```

> 默认`staleTime:0`，所以initialData虽然默认使用当前时间戳，挂载后仍会立刻被视为stale并后台刷新。

## 三、useInfiniteQuery

```
┌──────────────────────────────────────────────────────────────┐
│ Query实例（同QueryClient + queryHash仅1份）                   │
│ state.data: InfiniteData<TPage, TPageParam>                   │
│ {                                                            │
│   pages: TPage[]    // 每项是一次queryFn的单页原始响应        │
│   pageParams: TPageParam[] // 每页参数，与pages下标一一对应   │
│ }                                                            │
│ fetch()：统一请求协调入口                                    │
│ infiniteQueryBehavior：决定本次fetch是下一页/上一页/整组刷新 │
└────────────────────────┬─────────────────────────────────────┘
                         │ state变化广播
                         ▼
┌──────────────────────────────────────────────────────────────┐
│ InfiniteQueryObserver（继承QueryObserver）                    │
│ 配置：initialPageParam、getNextPageParam、maxPages            │
│ 输出：data（默认InfiniteData；select可转换为其他形状）       │
│ 方法：refetch() / fetchNextPage() / fetchPreviousPage()       │
│       全部最终进入同一个Query.fetch()                         │
└────────────────────────┬─────────────────────────────────────┘
                         ▼
                    React组件渲染
```

> 普通`useQuery`和`useInfiniteQuery`不要共用同一个`queryKey`。相同`queryHash`会复用同一个Query，但两类Observer期待的data形状不同：普通Query期待普通响应，Infinite Query期待`{pages,pageParams}`。
>
> 在5.102.5中，同一Query一旦被标记为infinite，后续普通Observer更新配置也不会清除该类型。共用key会让普通Observer也可能收到InfiniteData，或让Infinite Observer先面对旧的普通data；不能把它理解为两个独立缓存会安全地互相切换。

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

> v5要求提供`initialPageParam`属性，但类型系统没有禁止显式传`undefined`：`TPageParam`可以被推导为`undefined`。
>
> 工程上仍建议使用`0`、`null`或真实首游标，便于dehydrate和persist。这是序列化建议，不是运行时禁令。

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

Infinite Query还会把普通Query的错误/刷新状态按“整组刷新”和“加载前后页”拆开：

```
isRefetching
= 基础QueryObserver的isRefetching
  && !isFetchingNextPage
  && !isFetchingPreviousPage

isRefetchError
= 基础QueryObserver的isRefetchError
  && !isFetchNextPageError
  && !isFetchPreviousPageError
```

所以加载下一页时可以同时`isFetching:true + isFetchingNextPage:true`，但`isRefetching:false`；不能直接把普通`useQuery`的`isRefetching = isFetching && !isPending`套到Infinite Query结果上。

这些错误布尔值按Observer错误状态和`state.fetchMeta?.fetchMore?.direction`派生，不保证错误一定来自queryFn。`select`抛错时，也可能出现`isFetchNextPageError/isFetchPreviousPageError/isRefetchError`。

## 四、完整执行流程

### 1. 初始化

```
组件挂载
→ 创建InfiniteQueryObserver
→ QueryCache找到/创建Query
→ query.fetch()
→ infiniteQueryBehavior使用initialPageParam
→ queryFn({ pageParam: initialPageParam })
→ 生成data:{ pages:[page], pageParams:[initialPageParam] }
→ Query广播，Observer更新组件
```

### 2. 下拉加载更多 fetchNextPage()

```
fetchNextPage()
→ InfiniteQueryObserver.fetch({ meta: { fetchMore: { direction: 'forward' } } })
→ Query.fetch()把meta写入state.fetchMeta
→ infiniteQueryBehavior按fetchOptions.meta.fetchMore.direction识别方向，并读取当前pages/pageParams
→ getNextPageParam(lastPage, allPages, lastPageParam, allPageParams)
→ nextParam为null/undefined且已有页面？
  ├─ 是：behavior返回旧data，不调用queryFn；Query.fetch仍完成success状态收尾
  └─ 否：queryFn({ pageParam: nextParam })
         → 创建新的pages/pageParams数组写回Query.state.data
         → Query广播全部Observer
```

`fetchNextPage()`仍受Query级请求协调；下面的重复调用行为以Query已经有至少一页data为前提：

- 默认`cancelRefetch:true`：当`getNextPageParam`返回有效参数时，重复调用会再次执行queryFn，前一次调用结果被忽略；已经没有下一页时behavior直接返回旧data，不调用queryFn，但外层`Query.fetch()`仍完成success状态收尾。
- `cancelRefetch:false`：第一次完成前，后续调用不启动新请求。
- 如果首次加载尚无data，即使调用方传入`cancelRefetch:true`，Query也会复用当前首屏请求Promise，不会取消并重启。
- 建议调用条件：`hasNextPage && !isFetching`，避免请求互相干扰和浪费网络。

### 3. select处理列表（Observer本地转换）

```
select: (infData) => infData.pages.flatMap(page => page.data.rows)
```

select结果只属于当前Observer；QueryCache仍保存完整的`{pages,pageParams}`。

### 4. invalidateQueries失效刷新

```
queryClient.invalidateQueries({ queryKey: ['feed'] })
    ↓
1.QueryClient调用query.invalidate()
  ├─ 原来未失效：设置isInvalidated=true，并广播全部Observer
  └─ 已经失效：不重复dispatch，也不重复广播
    ↓
2.默认refetchType:'active'
  QueryClient主动调用refetchQueries(type:'active')
    ↓
3.Query.fetch()进入infiniteQueryBehavior
  本次结果从空pages开始重建
    ↓
4.第一页参数 = oldPageParams[0] ?? initialPageParam
  请求当前缓存窗口的第一页
    ↓
5.使用“刚拿到的新页面”重新计算下一个pageParam
  串行请求，页数上限默认是旧pages数量
  如果getNextPageParam提前返回null/undefined，则提前结束
    ↓
6.整组新{pages,pageParams}写回Query，广播Observer
```

> `invalidate()`的状态更新是幂等的，但后续refetch编排独立执行：即使Query原本已经`isInvalidated:true`，本次`invalidateQueries`仍会按照`refetchType`尝试刷新符合条件的Query。

关键点：

- 不是读取旧`pageParams[1..n]`逐个重放；第一项使用`oldPageParams[0] ?? initialPageParam`，后面游标根据新响应重新计算。
- 这样才能避免后端数据变化后继续使用旧游标导致重复/漏数据。
- v5已经删除`refetchPage`，不能再用它只刷新某一页。
- 刷新页数上限来自`options.pages ?? 旧pages数量`。5.102.5中`pages`是版本相关的新选项：只暴露在命令式`queryClient.infiniteQuery`（及已废弃的`fetchInfiniteQuery/prefetchInfiniteQuery`）选项里，且必须搭配`getNextPageParam`；`useInfiniteQuery`的hook选项还没有这个字段，hook链路刷新的上限就是旧pages数量。
- 默认无active Observer时只invalidate，不发网络；传`refetchType:'all'`会把符合执行条件的inactive Query也纳入刷新范围。
- disabled Query仍会被跳过。5.102.5的`query.isStatic()`只检查当前Observer，因此没有Observer的inactive Query不会仅因上次配置过`staleTime:'static'`就被排除。

只标记失效，不立即请求：

```
queryClient.invalidateQueries({
  queryKey: ['feed'],
  refetchType: 'none'
})
```

## 五、maxPages：缓存窗口

`maxPages`限制的是“QueryCache同时保存几页”，不是总共允许用户加载几页，也不会首次自动预取N页。

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
- 上例假设新页面仍能算出后续游标；如果中途返回`null/undefined`，刷新结果可以少于3页。
- 如果再`fetchPreviousPage()`取回第0页，会从数组前面加入0，并淘汰最后面的3。
- 配置`maxPages > 0`时，如果业务允许双向翻页，需要同时正确实现`getNextPageParam/getPreviousPageParam`。
- maxPages同时降低内存占用和失效刷新时的串行请求数量。

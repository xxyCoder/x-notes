# TanStack Query v5 进阶：更新、预取与取消

## 一、保守更新 & 乐观更新（二者是业务写法模式，不是框架API）

> 校对基线：
>
> - 发布版本：[`release-2026-08-26-0900`](https://github.com/TanStack/query/releases/tag/release-2026-08-26-0900)，`@tanstack/react-query@5.102.5`、`@tanstack/query-core@5.102.5`。
> - 源码提交：[`1836e61`](https://github.com/TanStack/query/tree/1836e61b8ccc42a79399fc98047bb324d20de8e2)。
> - 官网概念入口：[Optimistic Updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates)、[Query Cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation)、[QueryClient](https://tanstack.com/query/latest/docs/reference/QueryClient)（滚动更新，不作为固定版本证据）。
> - 固定文档快照：[`optimistic-updates.md`](https://github.com/TanStack/query/blob/1836e61b8ccc42a79399fc98047bb324d20de8e2/docs/framework/react/guides/optimistic-updates.md)、[`query-cancellation.md`](https://github.com/TanStack/query/blob/1836e61b8ccc42a79399fc98047bb324d20de8e2/docs/framework/react/guides/query-cancellation.md)、[`QueryClient.md`](https://github.com/TanStack/query/blob/1836e61b8ccc42a79399fc98047bb324d20de8e2/docs/reference/QueryClient.md)。
> - 适用边界：`queryClient.query`和Mutation回调上下文只按上述版本、提交及文档快照解释；其他v5小版本需核对实际类型和API。

### 1）保守更新（简单、常见）

流程：`mutationFn`结束后，在Mutation最终进入success/error之前调用`invalidateQueries`，把对应Query标记为失效；默认同时尝试重新请求符合执行条件的active Query，以后端结果刷新UI。

```
useMutation({
  mutationFn: editApi,
  onSettled() {
    // return Promise，让Mutation等待invalidateQueries完成
    return queryClient.invalidateQueries({
      queryKey: ['todoList']
    })
  }
})
```

优点：逻辑简单；refetch成功后，UI会由查询接口本次返回的数据重新校准。
缺点：多一次网络往返；refetch失败或后端存在最终一致性延迟时，仍可能暂时显示旧数据。

只希望标记失效，本次不立即刷新：

```
queryClient.invalidateQueries({
  queryKey: ['todoList'],
  refetchType: 'none'
})
```

> `refetchType`写在invalidateQueries第一个参数（Query Filters）里。默认值是`'active'`。
>
> `invalidateQueries`返回Promise，但“等待结束”不等于“刷新成功”：
>
> - Mutation会等待这个Promise。
> - 默认只refetch active、未被判定为disabled且`query.isStatic()`不为true的Query；inactive Query不发请求。
> - 如果`query.fetch()`返回时Query已经paused，例如调用时已经离线，5.102.5会用已完成的Promise替代该Query的fetch Promise，不等待恢复联网。
> - 如果Query先以fetching启动，后来在retry阶段paused，原Promise仍然保留，要等Retryer最终结束。
> - 默认`throwOnError:false`会吞掉refetch错误；只有第二参数传`{ throwOnError:true }`时，refetch失败才会reject。

### 2）乐观更新（提升用户体验）

流程：不等后端接口返回，**已有旧缓存时先修改Query缓存让UI立即更新**；接口失败，使用旧缓存快照回滚。没有旧缓存时，可改用Mutation的`variables`渲染临时UI。
依赖API：`onMutate` + `cancelQueries` + `getQueryData` + `setQueryData`

#### 完整时序

1. 调用`mutate(newItem)`。
2. `onMutate`在`mutationFn`之前执行：
   - 取消同Query正在进行的refetch，防止它覆盖乐观数据。
   - 读取旧缓存快照。
   - 有旧缓存时，用`setQueryData`写入乐观结果，UI立刻变化。
   - return回滚信息，成为`onMutateResult`。
3. 执行`mutationFn`，真正发起写请求。
4. 请求失败：`onError`读取`onMutateResult`并回滚。
5. 无论成败：`onSettled`失效同一个Query，并默认尝试刷新符合条件的active Query，用查询结果校准乐观数据。

```
const updateMutation = useMutation({
  mutationFn: updateTodoApi,

  async onMutate(newItem, mutationContext) {
    const queryKey = ['todo', newItem.id]

    // 防止在途refetch回来后覆盖乐观更新
    await mutationContext.client.cancelQueries({ queryKey })

    const oldSnapshot = mutationContext.client.getQueryData<Todo>(queryKey)

    // 这份缓存型乐观更新只处理已有数据，让失败回滚有明确快照
    if (oldSnapshot !== undefined) {
      mutationContext.client.setQueryData(queryKey, {
        ...oldSnapshot,
        ...newItem
      })
    }

    return { queryKey, oldSnapshot }
  },

  onError(_err, _newItem, onMutateResult, mutationContext) {
    if (onMutateResult?.oldSnapshot !== undefined) {
      mutationContext.client.setQueryData(
        onMutateResult.queryKey,
        onMutateResult.oldSnapshot
      )
    }
  },

  onSettled(_data, _error, newItem, _onMutateResult, mutationContext) {
    // 返回Promise：按上面的边界等待失效/兜底refetch流程
    return mutationContext.client.invalidateQueries({
      queryKey: ['todo', newItem.id]
    })
  }
})
```

> `onMutate`不要求必须async；这里写async只是因为需要`await cancelQueries()`。
>
> 在5.102.5中，`onMutate`返回值在后续回调中叫`onMutateResult`；最后一个`mutationContext`由框架提供，里面包含`client/mutationKey/meta`。
>
> 这份示例只在旧缓存存在时写乐观结果。没有旧缓存时，可以用Mutation的`variables`渲染临时UI。
>
> 如果必须创建新的Query缓存，需要单独设计删除或重置的回滚策略。把`undefined`传给`setQueryData`只会放弃更新，不会删除缓存。

优点：命中旧缓存时UI无等待，交互体验流畅。
缺点：逻辑更复杂；必须处理在途请求覆盖、失败回滚和最终服务端校准。

---

## 二、预取：queryClient.query / prefetchQuery

```
const todo = await queryClient.query({
  queryKey: ['todo', id],
  queryFn: () => getTodoApi(id),
  staleTime: 60_000
})
```

5.102.5已经把`fetchQuery/prefetchQuery`标记为deprecated，新代码推荐使用`queryClient.query`。它是hook之外的命令式查询API；用于预取时，可以在组件挂载或路由跳转前把结果写入QueryCache。

> 这是5.102.5的结论，不应反推所有v5小版本都提供`queryClient.query`。旧项目升级笔记前先检查`@tanstack/react-query`的实际版本；较早v5仍可能以`fetchQuery/prefetchQuery`为公开API。

特性：

- 根据本次传入的`staleTime`判断已有缓存是否fresh；fresh时不重复请求。
- 自己不会创建Observer；如果此时没有组件订阅该Query，就不会触发组件渲染。如果同一Query已经有Observer，缓存更新仍会正常广播并可能触发渲染。
- 没有Observer的Query从创建起就受`gcTime`回收管理。
- 后续`useQuery`订阅同一Query，可直接拿缓存，不会进入无data的pending页面；如果Observer认为数据stale，仍可能后台refetch。
- `queryClient.query`没有显式配置`retry`时默认不重试；确实需要重试应在本次配置或Query defaults中明确设置。
- `queryClient.query`先取得原始data：缓存fresh时直接读取缓存，否则执行queryFn并把原始结果写入QueryCache。随后只对本次返回值执行`select`；select结果不会替换缓存中的原始data。
- `select`抛错会让`queryClient.query()`返回的Promise reject，但不会修改QueryCache状态。若本次queryFn刚成功，缓存仍是`status:'success'`和原始data；若命中已有缓存，则缓存保持调用前的状态。
- `queryClient.query`在queryFn失败或select抛错时都会reject；如果只是预热且明确不关心这些错误，可以自行吞掉：

```
void queryClient.query({
  queryKey: ['todo', id],
  queryFn: () => getTodoApi(id),
  staleTime: 60_000
}).catch(() => undefined)
```

- 旧的`prefetchQuery`仍然可用：它不返回data并吞掉请求错误，但已经不适合作为新代码的首选写法。

使用场景：hover列表项提前加载详情、路由跳转前预取页面数据。

> 区分：
>
> `useQuery`：创建Observer，找到/创建Query，绑定组件并驱动渲染。
>
> `queryClient.query`：找到或创建Query并按需请求，不创建Observer；queryFn失败或select抛错时reject。select只影响本次返回值，不改变原始Query缓存。
>
> `prefetchQuery`：旧的预热便捷方法，无Observer、无返回data并吞掉错误，在5.102.5源码中已标记deprecated。

---

## 三、请求取消 AbortSignal

### useQuery / useInfiniteQuery

- `queryFn`上下文会提供`signal`。
- TanStack Query通过`signal`属性是否被读取，判断queryFn是否消费了取消信号。
- 真正终止fetch/axios请求，必须把signal传给请求库。
- 只有最后一个Observer离开、Observer数量变成0时，才会触发这类“失去订阅后的取消判断”；除了组件卸载，Observer切换`queryKey`也会让它离开旧Query。同Query仍有其他Observer时不会因此取消。

```
useQuery({
  queryKey: ['list'],
  queryFn: async ({ signal }) => {
    const response = await fetch('/api/list', { signal })
    if (!response.ok) {
      throw new Error(`request failed: ${response.status}`)
    }
    return response.json()
  }
})
```

#### 最后一个Observer离开时的四种情况

```
1.queryFn没有读取signal，并且请求已经开始
  最后一个Observer离开
  → 当前网络请求默认继续
  → 成功结果仍可写入QueryCache
  → 但Query会cancelRetry；如果当前尝试失败，不会再自动开始后续retry

2.首次请求还处于pending + paused，queryFn尚未开始
  最后一个Observer离开
  → 即使没有读取signal，Query也会取消当前Retryer
  → 状态从pending + paused恢复为pending + idle

3.queryFn读取signal，并传给fetch/axios
  最后一个Observer离开
  → Query取消并恢复到本次fetch之前的state
  → AbortSignal通知请求库中断网络请求

4.queryFn读取了signal，但没有传给请求库
  → TanStack Query会按“已消费signal”取消Query状态
  → 底层HTTP无法收到abort，仍可能继续运行
```

“回滚Query状态”指恢复到本次fetch之前：例如已有旧data的后台刷新被取消，旧data继续保留，`fetchStatus`回到idle。

> 这里只归纳“最后一个Observer离开”触发的自动处理。显式调用`queryClient.cancelQueries()`也会取消匹配Query；已有data时再次`refetch({ cancelRefetch:true })`还可能静默取消旧fetch并启动新fetch。

> 官方文档明确把`useSuspenseQuery/useSuspenseQueries/useSuspenseInfiniteQuery`列为取消能力的限制场景；不要把本节自动取消结论直接套到Suspense hooks。

### useMutation

- Mutation没有自动注入用于取消本次写请求的signal，组件卸载也不会自动取消Mutation。
- 这是因为Mutation代表一次独立写动作；发起它的组件卸载后，请求、重试、hook级回调和MutationCache回调通常仍应继续；该次`mutate`调用附带的逐次回调则依赖MutationObserver仍在订阅且仍是最新一次调用。
- 如果业务明确允许用户取消，自己维护`AbortController`。
- 手动`abort()`通常会让请求Promise以AbortError拒绝，Mutation因此进入error；如果配置了`retry`，还要在retry函数中排除主动取消错误，否则框架可能再次执行mutationFn。

```
const ctrlRef = useRef<AbortController | null>(null)

const mutation = useMutation({
  mutationFn: async payload => {
    const controller = new AbortController()
    ctrlRef.current = controller

    const response = await fetch('/api/submit', {
      method: 'POST',
      signal: controller.signal,
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      throw new Error(`request failed: ${response.status}`)
    }

    return response
  }
})

// 外部手动取消
ctrlRef.current?.abort()
```

> 重要提醒：AbortSignal可以中断客户端等待和支持取消的传输层，但不能保证后端已经开始的业务事务一定停止；服务端是否响应连接取消，需要看具体协议和实现。

---

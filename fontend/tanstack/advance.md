# TanStack Query v5 进阶：更新、预取与取消

## 一、保守更新 & 乐观更新（二者是业务写法模式，不是框架API）

### 1）保守更新（简单、常见）

流程：`mutationFn` 结束后，在 Mutation 最终进入 success/error 之前调用 `invalidateQueries`，把对应 Query 标记为失效；默认同时尝试重新请求符合执行条件的 active Query，以后端结果刷新 UI。

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

优点：逻辑简单；refetch 成功后，UI 会由查询接口本次返回的数据重新校准。
缺点：多一次网络往返；refetch 失败或后端存在最终一致性延迟时，仍可能暂时显示旧数据。

只希望标记失效，本次不立即刷新：

```
queryClient.invalidateQueries({
  queryKey: ['todoList'],
  refetchType: 'none'
})
```

`invalidateQueries()` 返回的 Promise 表示等待本次实际启动的刷新流程结束，不代表数据一定刷新成功：

- 默认忽略刷新错误；第二个参数传入 `{ throwOnError:true }` 后，刷新失败才会抛错。
- 如果请求一开始就因离线进入 `paused`，Promise 不会一直等到恢复联网。
- 在 Mutation 回调中，必须返回或 `await` 这个 Promise，Mutation 才会等待刷新流程结束。

### 2）乐观更新（提升用户体验）

流程：不等后端接口返回，**已有旧缓存时先修改Query缓存让UI立即更新**；接口失败，使用旧缓存快照回滚。没有旧缓存时，可改用 Mutation 的`variables` 渲染临时UI。
依赖API：`onMutate` + `cancelQueries` + `getQueryData` + `setQueryData`

#### 完整时序

1. 调用 `mutate(newItem)`。
2. `onMutate` 在 `mutationFn` 之前执行：
   - 取消同 Query 正在进行的 refetch，防止它覆盖乐观数据。
   - 读取旧缓存快照。
   - 有旧缓存时，用 `setQueryData` 写入乐观结果，UI立刻变化。
   - return回滚信息，成为`onMutateResult`。
3. 执行 `mutationFn`，真正发起写请求。
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

5.102.5 已经把 `fetchQuery/prefetchQuery` 标记为 deprecated，新代码推荐使用 `queryClient.query()`。它用于在 hook 之外读取或预取 Query 数据：

1. 缓存仍是 fresh：直接返回缓存数据。
2. 缓存不存在或已经 stale：执行 `queryFn`，并把原始结果写入 QueryCache。
3. 配置了 `select`：只转换本次返回值，不修改缓存中的原始数据。

`queryClient.query()` 不创建 Observer。当前已有组件订阅同一 Query 时，缓存更新仍会通知组件；否则该 Query 按 `gcTime` 回收。后续 `useQuery` 使用相同 `queryKey` 时可以直接读取缓存，再根据自己的 `staleTime` 决定是否后台刷新。

未配置 `retry` 时，请求失败后不重试。`queryFn` 或 `select` 抛错都会使 Promise reject，但 `select` 抛错不会修改 QueryCache。只做预热且明确不关心错误时，可以自行处理：

```
void queryClient.query({
  queryKey: ['todo', id],
  queryFn: () => getTodoApi(id),
  staleTime: 60_000
}).catch(() => undefined)
```

旧的 `prefetchQuery` 仍然可用：它不返回 data，并会吞掉请求错误。常见预取场景包括列表项悬停和路由跳转前加载页面数据。

---

## 三、请求取消 AbortSignal

### useQuery / useInfiniteQuery

- `queryFn` 上下文会提供 `signal`。
- TanStack Query 通过 `signal` 属性是否被读取，判断 queryFn 是否消费了取消信号。
- 真正终止 fetch/axios 请求，必须把 signal 传给请求库。
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

#### 最后一个 Observer 离开时的四种情况

```
1.queryFn 没有读取 signal，并且请求已经开始
  最后一个 Observer 离开
  → 当前网络请求默认继续
  → 成功结果仍可写入 QueryCache
  → 但 Query 会 cancelRetry；如果当前尝试失败，不会再自动开始后续 retry

2.首次请求还处于 pending + paused，queryFn 尚未开始
  最后一个 Observer 离开
  → 即使没有读取 signal，Query 也会取消当前 Retryer
  → 状态从 pending + paused 恢复为 pending + idle

3.queryFn 读取 signal，并传给 fetch/axios
  最后一个 Observer 离开
  → Query 取消并恢复到本次 fetch 之前的 state
  → AbortSignal 通知请求库中断网络请求

4.queryFn 读取了 signal，但没有传给请求库
  → TanStack Query 会按“已消费 signal ”取消 Query 状态
  → 底层 HTTP 无法收到 abort，仍可能继续运行
```

“回滚 Query 状态”指恢复到本次 fetch 之前：例如已有旧 data 的后台刷新被取消，旧 data 继续保留，`fetchStatus` 回到 idle。

### useMutation

- Mutation 没有自动注入用于取消本次写请求的 signal，组件卸载也不会自动取消 Mutation。
- 这是因为 Mutation 代表一次独立写动作；发起它的组件卸载后，请求、重试、hook 级回调和 MutationCache 回调通常仍应继续；该次 `mutate` 调用附带的逐次回调则依赖 MutationObserver 仍在订阅且仍是最新一次调用。
- 如果业务明确允许用户取消，自己维护 `AbortController`。
- 手动 `abort()` 通常会让请求 Promise 以 AbortError 拒绝，Mutation 因此进入 error；如果配置了 `retry`，还要在 retry 函数中排除主动取消错误，否则框架可能再次执行 mutationFn。

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
---

# TanStack Query v5 Network Mode

> 校对基线：
>
> - 发布版本：[`release-2026-08-26-0900`](https://github.com/TanStack/query/releases/tag/release-2026-08-26-0900)，`@tanstack/react-query@5.102.5`、`@tanstack/query-core@5.102.5`。
> - 源码提交：[`1836e61`](https://github.com/TanStack/query/tree/1836e61b8ccc42a79399fc98047bb324d20de8e2)。
> - 官网概念入口：[Network Mode](https://tanstack.com/query/latest/docs/framework/react/guides/network-mode)（滚动更新，不作为固定版本证据）。
> - 固定文档快照：[`network-mode.md`](https://github.com/TanStack/query/blob/1836e61b8ccc42a79399fc98047bb324d20de8e2/docs/framework/react/guides/network-mode.md)。
> - 适用边界：实现行为只按上述版本、提交及文档快照解释；本文讨论的是在线状态门控，不代表真实后端健康状态。

`networkMode`回答的不是“接口有没有成功”，而是：**TanStack Query准备执行queryFn或mutationFn时，如果当前被认为离线，这个异步任务还有没有立即执行的意义？**

它同时用于Query和Mutation，可以写在单次配置里，也可以放进`QueryClient.defaultOptions.queries/mutations`。

```tsx
useQuery({
  queryKey: ['todos'],
  queryFn: getTodos,
  networkMode: 'online'
})
```

## 它控制的实际位置

Query和Mutation最终都会创建Retryer。`networkMode`参与Retryer的两个关口，但不是唯一条件：

```
准备开始
    ↓
canStart：networkMode/在线状态允许开始吗？同时还要满足canRun
    ↓
执行queryFn / mutationFn
    ↓ 失败且需要retry
canContinue：当前允许继续吗？同时检查focus、在线状态和canRun
```

- `canStart = canFetch(networkMode) && canRun()`。
- `canContinue = focusManager.isFocused() && (networkMode === 'always' || onlineManager.isOnline()) && canRun()`。
- Query当前的`canRun()`恒为`true`；Mutation的`canRun()`负责同一`scope.id`中`mutationFn`的串行排队。它只门控Retryer的函数执行，不会推迟`onMutate`。

因此它不是请求库、HTTP缓存或离线数据库本身，只决定TanStack Query在离线状态下是“先不执行”“照常执行”，还是“先试一次，失败后暂停重试”。

## 三种模式

```
online【默认】
├─ 离线开始：不执行第一次queryFn/mutationFn，直接paused
└─ 已经执行：不中断本次；失败后需要retry时暂停后续重试

always
├─ 离线开始：照常执行
└─ 重试：不因离线暂停

offlineFirst
├─ 离线开始：先执行第一次Retryer函数
└─ 第一次失败且还可重试：暂停，在线、focus和canRun条件满足后再重试
```

> 上图描述的是Retryer执行`queryFn/mutationFn`的门控。对新调用`mutate()`创建的Mutation，框架先等待MutationCache级`onMutate`，成功后再等待hook级`onMutate`，最后才调用`retryer.start()`。离线或同`scope.id`排队不会阻止这条回调链；但异步MutationCache回调会推迟hook级`onMutate`，前置回调抛错还会中止后续步骤，不能笼统写成hook级`onMutate`“立即运行”。
>
> hydrate恢复的pending Mutation属于另一条分支，恢复执行时不会重复调用`onMutate`。

### online：普通HTTP接口

```tsx
useQuery({
  queryKey: ['profile'],
  queryFn: getProfile,
  networkMode: 'online'
})
```

默认模式适合绝大多数直接访问远程API的Query和Mutation。设备离线时，立即发HTTP通常没有意义，所以任务先保持paused；重新在线并且页面focused、`canRun()`也满足后，原来的Retryer才会继续执行。

对新调用`mutate()`创建的Mutation来说，如果前置回调正常完成、Retryer首次启动时又因离线或scope顺序而paused，此时`mutationFn`尚未执行，但本次hook级`onMutate`已经执行。恢复后不会再执行第二次`onMutate`。

一次Mutation也可能在`mutationFn`失败后的retry阶段进入paused；这种情况下不能再说`mutationFn`从未执行。

如果queryFn或mutationFn已经开始执行，运行途中变成离线不会中断当前Promise或在途HTTP；只有本次执行失败且仍允许retry时，后续重试才会暂停，等在线、focus和`canRun()`条件满足后继续。

恢复paused Retryer和判断`refetchOnReconnect`是两套条件。`Query.onOnline()`先让一个符合重连刷新条件的Observer调用`refetch({ cancelRefetch:false })`，再调用当前Retryer的`continue()`。

如果已有paused Retryer，前一个调用会复用它，不会并行启动第二个请求。因此即使关闭`refetchOnReconnect`，paused Retryer仍可在重新在线且focus和`canRun()`条件满足后继续。

### always：不依赖网络的异步任务

```tsx
useQuery({
  queryKey: ['draft', draftId],
  queryFn: () => readDraftFromIndexedDB(draftId),
  networkMode: 'always'
})
```

适合IndexedDB、AsyncStorage、SQLite、本地文件、纯异步计算以及不应受浏览器联网状态影响的测试或Mock。它在离线时照常启动，重试也不会因为离线而暂停。

`always`不会让离线HTTP请求成功。queryFn如果仍调用远程API，请求会照常失败，并按`retry/retryDelay`处理。

`always`只忽略在线状态。页面失焦或Mutation scope不可运行时，`canContinue`仍可能暂停。该模式的`refetchOnReconnect`默认是`false`，也可以显式覆盖。

### offlineFirst：缓存优先，但仍有远程兜底

```tsx
useQuery({
  queryKey: ['article', articleId],
  queryFn: () => fetch(`/api/articles/${articleId}`).then(response => {
    if (!response.ok) {
      throw new Error(`request failed: ${response.status}`)
    }
    return response.json()
  }),
  networkMode: 'offlineFirst'
})
```

适合Service Worker、浏览器HTTP缓存或自定义persister可能直接返回结果的读取链路。离线时Retryer仍会执行第一次读取尝试：

- Service Worker或HTTP缓存路径会调用`queryFn`，请求可能被缓存层直接满足。
- 配置Query `persister`时，Query的fetch函数会先调用persister包装层，由它读取持久化数据或决定是否调用`queryFn`。

第一次尝试失败且`retry`允许继续时，后续retry才会暂停；恢复在线后还要满足focus和`canRun()`，Retryer才会继续。

> `offlineFirst`本身不创建缓存，也不会自动读取IndexedDB。必须先有Service Worker、HTTP缓存策略或persister等实际缓存层。
>
> 没有实际缓存层时，Query通常只是离线执行第一次读取尝试。失败后若`retry`允许则暂停，再在在线、focus和`canRun()`条件满足后继续；`retry:false`则直接进入error。
>
> 5.102.5源码还有一层默认处理：Query配置了`persister`但没有显式设置`networkMode`时，QueryClient会把它补成`offlineFirst`，让persister有机会在离线状态下先返回缓存。

## status、fetchStatus 和 isPaused

Query把“有没有数据/结果”和“请求执行到哪里”拆成两组状态：

```
status
├─ pending：还没有成功数据
├─ success：已有成功数据
└─ error：最终失败

fetchStatus
├─ fetching：fetch/retry流程活跃，且当前未paused/idle
├─ paused：想执行，但当前被暂停
└─ idle：当前没有活跃fetch流程
```

`fetching`不保证每一刻都有queryFn或HTTP在途。一次尝试失败后，如果Retryer正在在线等待`retryDelay`，Query仍可能保持`fetchStatus:'fetching'`。

首次进入页面时设备离线，默认`online`模式可能是：

```
status: 'pending'
fetchStatus: 'paused'
isPending: true
isPaused: true
```

这不是“正在加载”，因为queryFn尚未开始。加载UI不能只看`isPending`就一直显示旋转动画，应单独处理`isPaused`，例如显示“当前离线，联网后继续”。

如果已经有缓存数据，后台刷新时离线，则可能是`status:'success' + fetchStatus:'paused'`：旧数据仍可展示，只是刷新被暂停。

Mutation没有Query的`fetchStatus`，但会保留`status:'pending' + isPaused:true`，表达这次写动作尚未完成、正在等待可执行条件。

## OnlineManager 的边界

浏览器环境下，5.102.5的`OnlineManager`在出现第一个订阅者时注册`window`的`online/offline`事件，在最后一个订阅者离开后移除监听。正常使用`QueryClientProvider`时，QueryClient挂载会建立这项订阅。

它维护的是客户端报告的联网状态，不是对业务后端做健康检查。

所以这些情况通常不会自动被判定为offline：

- 后端服务500或宕机。
- DNS、代理、网关或某个特定域名不可达。
- 请求超时、鉴权失败、限流。

这些仍要依靠请求超时、错误处理和`retry`策略。React Native或有自定义网络状态来源时，可以通过`onlineManager.setEventListener()`接入平台事件，也可以用`onlineManager.setOnline()`显式更新状态。

> 5.102.5源码里的OnlineManager初始值是`true`，随后由事件或显式设置更新；不要把它理解成每次请求前都会主动探测真实网络或后端。

## Query、Mutation 与离线恢复

Query和Mutation共用Retryer的网络门控逻辑，但状态载体不同：Query用`fetchStatus:'paused'`，Mutation用`isPaused:true`。

普通页面生命周期内，默认`online`的Mutation在离线时可以保持paused；恢复在线并满足focus、scope顺序等`canContinue`条件后继续。但这不等于浏览器刷新、关闭页面后仍然有一个永久离线队列：

```
只在内存中paused
    └─ 刷新/关闭页面：状态会丢失

需要跨刷新恢复
    ├─ 持久化并hydrate Mutation状态
    ├─ 为mutationKey注册默认mutationFn
    └─ 恢复后确保resumePausedMutations()被调用
```

原因是函数无法序列化；持久化只能保存Mutation状态，页面恢复后还需要默认`mutationFn`才能真正继续执行。恢复成功后可以在`PersistQueryClientProvider.onSuccess`中显式调用`resumePausedMutations()`；QueryClient后续收到online或focus事件时也会调用它。

`networkMode`只负责是否暂停，不负责把任务持久化。

## 和其他配置的关系

### refetchOnReconnect

- 控制“重新联网时，要不要让符合条件的Observer调用一次refetch”。如果该Query已有paused Retryer，这次调用会复用现有Promise，不会另开请求。
- 不直接决定“已经paused的Retryer能不能继续”；继续仍由focus、在线状态和`canRun()`共同决定。
- `always`模式下默认值为`false`；`online/offlineFirst`默认值为`true`（`refetchOnReconnect`未显式设置时，按`networkMode !== 'always'`补默认值）。

### retry / retryDelay

- `networkMode`参与开始和继续两个关口：`canStart`检查在线模式和`canRun()`，不检查focus；失败后等待重试或恢复现有paused Retryer时，`canContinue`才额外检查focus。
- `retry`决定失败后是否还要再试。
- `retryDelay`决定下一次尝试前等待多久。
- `offlineFirst`允许Retryer第一次启动时忽略离线状态。之后每一次执行失败，只要`retry`仍允许且在线、focus或`canRun()`条件不满足，都可能在下一次retry前暂停；如果最初就离线，通常表现为第一次失败后暂停。若`retry:false`，本次失败后直接error。

### refetchInterval

轮询定时器决定“什么时候尝试fetch”，`networkMode`参与决定这次fetch能否真正开始。默认`online`模式下，轮询遇到离线会进入paused，不会绕过网络门控；定时器归属和前后台行为详见`observer.md`。

## 选择顺序

```
queryFn / mutationFn必须访问远程服务？
├─ 是：普通HTTP API
│   └─ online【默认】
│
├─ 不一定：Service Worker / HTTP缓存可能直接命中
│   └─ offlineFirst
│
└─ 否：IndexedDB / SQLite / 本地文件 / 本地异步计算
    └─ always
```

## 关键坑点

1. `online`是普通远程API的默认选择；它表达“离线时暂缓”，不是保证接口可用。
2. `always`只是忽略在线状态，不能让离线HTTP成功，也不会自动切到本地数据源。
3. `offlineFirst`依赖真实缓存层；没有Service Worker、HTTP缓存或persister时，通常没有使用价值。
4. `status:'pending'`不等于queryFn正在运行；结合`fetchStatus/isPaused`区分活跃fetch流程和暂停等待。
5. `refetchOnReconnect:false`不会关闭Retryer的continue机制；paused Retryer仍会在重新联网且focus/canRun条件满足后继续。
6. 后端宕机、HTTP 500和超时不等于OnlineManager判定的offline，仍需正常的错误和重试设计。
7. Mutation在内存中暂停不等于可跨页面重载恢复；需要持久化状态、提供默认mutationFn，并确保恢复后调用`resumePausedMutations()`。
8. 现有paused Retryer继续运行时还要满足页面focused；Mutation也可能等待同scope的前序任务结束。新Retryer的`canStart`不检查focus，不能把这条继续条件套到所有首次启动。
9. 对新调用`mutate()`创建的Mutation，paused门控Retryer的`mutationFn`或后续retry，不阻止本次`onMutate`；离线或scope排队时乐观更新仍可能已经发生。hydrate恢复的pending Mutation不会重复执行`onMutate`。

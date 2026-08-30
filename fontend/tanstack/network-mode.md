# TanStack Query v5 Network Mode

`networkMode` 决定两件事：离线时是否执行 `queryFn/mutationFn`，以及失败后的重试是否等待网络恢复。

它不会检测后端是否正常，也不会提供 HTTP 缓存或离线数据库。

```tsx
useQuery({
  queryKey: ['todos'],
  queryFn: getTodos,
  networkMode: 'online'
})
```

Query 和 Mutation 都支持该配置，也可以通过 `QueryClient.defaultOptions` 设置默认值。

## 三种模式

| 模式 | 离线时首次执行 | 失败后的重试 | 适用场景 |
| --- | --- | --- | --- |
| `online`（默认） | 暂停，等联网后执行 | 离线时暂停 | 普通远程 HTTP 接口 |
| `always` | 照常执行 | 不因离线暂停 | IndexedDB、本地文件、纯异步计算 |
| `offlineFirst` | 先执行一次 | 失败后离线则暂停 | Service Worker、HTTP 缓存或 persister 可能直接返回数据 |

### online

普通远程接口使用默认的 `online` 即可。设备离线时，请求进入暂停状态，恢复联网后继续。

如果请求已经开始，途中离线不会自动取消当前 Promise 或 HTTP 请求。只有本次执行失败并且还需要重试时，后续重试才会等待网络恢复。

### always

`always` 会忽略浏览器报告的联网状态，离线时仍然执行和重试。适合不依赖网络的异步任务：

```tsx
useQuery({
  queryKey: ['draft', draftId],
  queryFn: () => readDraftFromIndexedDB(draftId),
  networkMode: 'always'
})
```

它不会让离线的 HTTP 请求成功。如果 `queryFn` 仍然访问远程接口，请求只会照常失败。

### offlineFirst

`offlineFirst` 在离线时也会先执行一次，让 Service Worker、浏览器 HTTP 缓存或 persister 有机会返回数据。

如果第一次执行失败，并且配置允许重试，后续重试会暂停，等网络恢复后继续。

> `offlineFirst` 不会自动创建或读取缓存。没有实际缓存层时，它通常只是让离线请求先失败一次，再等待联网重试。

## paused 表示什么

暂停表示请求流程还没有结束，只是当前不能继续执行：

```text
Query     → fetchStatus: 'paused'
Mutation  → status: 'pending' + isPaused: true
```

- 没有缓存数据时，可以提示“当前离线，联网后继续”。
- 已有缓存数据时，继续展示旧数据，同时提示刷新已暂停。

暂停状态只保存在内存中。刷新或关闭页面后要继续 Mutation，需要另外配置持久化和恢复流程；`networkMode` 本身不提供离线任务队列。

## OnlineManager 的边界

浏览器环境下，TanStack Query 根据浏览器的 `online/offline` 事件维护联网状态。它不会在每次请求前探测业务后端是否可用。

以下情况通常不等于设备离线：

- 后端返回 500 或服务宕机。
- 请求超时、鉴权失败或限流。
- DNS、代理、网关或某个域名不可达。

这些问题仍需要正常的超时、错误处理和重试策略。React Native 或自定义网络环境可以通过 `onlineManager` 接入自己的联网状态来源。

## 重新联网时会发生什么

重新联网后可能发生两件不同的事：

- 恢复已经处于 `paused` 的请求流程。
- 重新联网时，正在被组件使用且已经 stale 的 Query 会自动刷新；设置 refetchOnReconnect:false 可以关闭这次刷新

`refetchOnReconnect:false` 只关闭第二种行为，不会取消已有暂停请求的恢复。它在 `online/offlineFirst` 下默认开启，在 `always` 下默认关闭。

`retry` 决定失败后是否继续尝试，`retryDelay` 决定两次尝试之间等待多久；它们与 `networkMode` 分别控制不同问题。

## 怎么选择

```text
任务必须访问远程服务？
├─ 是：普通 HTTP API
│   └─ online（默认）
│
├─ 不一定：Service Worker / HTTP 缓存可能直接命中
│   └─ offlineFirst
│
└─ 否：IndexedDB / SQLite / 本地文件 / 本地异步计算
    └─ always
```

通常不需要显式配置：远程接口保持默认 `online`，只有明确存在本地执行或缓存优先链路时才选择其他模式。

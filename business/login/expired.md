## 引子:一对矛盾

安全要求凭证短命（被偷窗口小），用户要求登录无感（别让我重输密码）。

单 JWT 是死局：**体验和安全在同一根轴上抢同一个参数(TTL)** ——有效期短则频繁重登，长则被偷窗口大。双 token 把它拆成两个参数，各管各的：

- `accessTTL` 定安全窗口(2h)
- `refreshTTL` 定免登录时长(30d)

| 方案 | 过期后发生什么 |
|---|---|
| Session 固定 30min | 访问 401 → 重登;挂机半小时回来要重输密码 |
| 单 JWT | 短(2h)则频繁重登,长(7d)则窗口大——两难 |
| 双 Token | access 过期 → **静默刷新**,用户全程无感 |

Session 的常用优化：**滑动过期**——每次访问把 TTL 重置（Redis `EXPIRE` 重刷），"活跃用户永不过期,挂机 30 分钟才掉线"。

## 刷新闭环:前端把 401 变成无感

时序:

```
① 前端发业务请求,带旧 access
② 服务端验签:exp 过了 → 401
③ 前端拦截器捕获 401 → 拿 refreshToken 调 /dual/refresh
④ 服务端:轮换(旧 refresh 作废)+ 发一对新的
⑤ 前端存新对 → 重放①的请求 → 200
用户视角:什么都没发生
```

**最大的工程坑：并发 401 风暴。** 页面加载并发 5 个请求，access 同时过期，5 个 401 同时进入拦截器。若各自独立刷新：第 1 个用旧 refresh 换新成功(轮换发生)，第 2~5 个再拿旧 refresh——已作废 → 401 → 用户被莫名登出。**轮换的安全设计,反过来放大了前端的并发问题。**

解法：single-flight 去重——多次 401 共享同一个进行中的刷新 Promise，只发一次：

```js
let refreshing = null
axios.interceptors.response.use(null, async (error) => {
  const { config, response } = error
  if (response?.status !== 401 || config._retried) throw error
  config._retried = true                      // 防重放后再 401 的二次死循环

  refreshing ??= axios.post('/dual/refresh', { refreshToken: getRT() })
  try {
    const { data } = await refreshing
    setTokens(data.accessToken, data.refreshToken)
  } finally {
    refreshing = null
  }
  config.headers.Authorization = `Bearer ${getAT()}`
  return axios(config)                         // 重放原请求
})
```

服务端配套防御：refresh 接口对同一旧 token 的并发请求，用 `setnx` 类原子操作保证只有第一个成功。两端都做,谁也不指望谁。

## 轮换再深一层:重放检测

完整时间线:

```
09:00  真用户登录,refresh_A 放进浏览器
10:00  小偷偷走 refresh_A,抢先调 /dual/refresh
       → 成功:refresh_A 作废,小偷拿 refresh_B + access_B
12:00  真用户 access 过期,拿 refresh_A 刷新 → 401,被踢回登录页
```

**12:00 那次 401 = 重放现场**:一个已作废的 refresh 被再次使用。只有两种解释:
1. 客户端不守规矩，多端共用同一份 refresh
2. **凭证泄露**，两个人在抢

生产加强版：重放发生时，不只回 401，而是 **清空该用户全部 refresh** （小偷手里的 refresh_B 一并处决）+ 安全告警 + 强制重新登录。宁可错杀

## refresh 的 TTL 滑不滑动:真实权衡

**滑动式**：每次换新，新 refresh 拿满 30 天——活跃用户永不重新登录。代价：**凭证链无限续命**，泄露不被发现就能永远续下去；而且重放检测的前提是真用户还回来用——真用户弃用了，抢刷新永不发生，泄露无声无息。

**固定式**：从登录起算 30 天，不滑动，到期强制重登。凭证链有硬上限，更安全，体验略降。

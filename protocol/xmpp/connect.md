# XMPP-C2S 客户端上线流程（协议 RFC6120）

## 阶段1：打开XML流

1. 客户端向socket写入流开启头（**不自闭合，不写闭合标签**）

```
<stream:stream
  xmlns="jabber:client"
  xmlns:stream="http://etherx.jabber.org/streams"
  to="demo.com"
  version="1.0">
```

- `xmlns="jabber:client"`：C2S客户端默认命名空间，`<message>` `<iq>` `<presence>`归属此命名空间
- `xmlns:stream="http://etherx.jabber.org/streams"`：stream系列标签命名空间
- `to`：目标服务域名
- `version`：**MUST携带**（RFC6120 §4.7.5 规则1），宣告支持流特性协商；不带则对端 MUST 视为 XMPP 0.9（规则4）——0.9 无 features/TLS/SASL 协商

2. 服务端回复流头部，同样不闭合，附带本次流唯一id

```
<stream:stream
  xmlns="jabber:client"
  xmlns:stream="http://etherx.jabber.org/streams"
  from="demo.com"
  id="abc-12345"
  version="1.0">
```

3. 服务端紧接着返回 `stream:features`，通告当前流支持的能力。若 TLS 为 mandatory-to-negotiate，接收方 **SHOULD NOT** 广播 STARTTLS 以外的 feature（RFC6120 §5.3.1，注意是 SHOULD NOT 非 MUST NOT）——通常只见 `<starttls/>`，TLS 后重开流才给出 SASL 机制；依赖 TLS 的机制在 TLS 前不得提供。下例假定已可直接进入 SASL

```
<stream:features>
  <mechanisms xmlns="urn:ietf:params:xml:ns:xmpp-sasl">
    <mechanism>SCRAM-SHA-256</mechanism>
    <mechanism>PLAIN</mechanism>
  </mechanisms>
</stream:features>
```

## 阶段2：SASL鉴权

> 
> SASL报文独立命名空间 `urn:ietf:params:xml:ns:xmpp-sasl`，不属于三大stanza。
> 作用：校验账号身份；认证成功仅确立**该连接协商上下文中的身份**，不等于登录完成。

1. 客户端选择服务端支持的认证机制，发送认证报文 `<auth>`
以 PLAIN 为例：账号密码按规则拼接后base64编码放到标签体内

```
<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="PLAIN">AGFsaWNlAG15cGFzc3dvcmQ=</auth>
```

### SASL 两种结果

✅ **认证成功**

```
<success xmlns="urn:ietf:params:xml:ns:xmpp-sasl"/>
```

协议规定行为：

1. TCP 连接**保持不断开，复用现有socket**；**禁止发送 `</stream:stream>`**。
2. 在同一个 socket 上，**重新发送一份全新的 `<stream:stream>` 开启头**（**bind 在 SASL 成功前不得暴露——RFC6120 §7.4 MUST NOT**；认证前的 features 也可能同时含 STARTTLS 等其他能力；所以必须重开流才能看到 bind）。
3. 旧 XML stream 被替换；同一底层连接中的 SASL 协商结果继续有效，新流无需再次执行 SASL。
4. 服务端回复新的 stream 头部，以及新版 `stream:features`，**MUST包含bind**（RFC6120 §7.4）；此外还可能附带其他能力（session、压缩、SM等），也可能没有——"可为空"指其他能力可为空，**bind 本身不能缺**

```
<stream:features>
  <bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"/>
</stream:features>
```

❌ **认证失败**
返回 `<failure>` 报文，同SASL命名空间，内部携带具体失败原因元素。
常见失败原因标签：

- `<not-authorized/>`：账号密码错误
- `<invalid-mechanism/>`：选用了服务端不支持的认证机制
- `<temporary-auth-failure/>`：服务端临时问题

示例（密码错误）：

```
<failure xmlns="urn:ietf:params:xml:ns:xmpp-sasl">
  <not-authorized/>
  <text>Username or password invalid</text>
</failure>
```

> 
> 协议行为（RFC6120 §6.4.5）：收到 `<failure>` 之后，**可以在当前流上直接重发 `<auth>` 重试**。
> 前提：原文 "Where appropriate for the chosen SASL mechanism"——仅当所选机制适合重试，并非所有机制无条件适用。此前提下服务端 SHOULD 允许 2~5 次重试；超过上限，服务端 MUST 以流错误关流（SHOULD 为 `policy-violation`）。
> 只有流被关后才需要：重建 TCP，从打开 stream 开始完整重跑流程。
> xmpp.js（0.14.0）不会自动重试 `<auth>`：收到 `<failure/>` 即抛出 SASLError、经 middleware 以 `error` 事件上抛（sasl/index.js L61-63、middleware/index.js L17）；它不因 SASL failure 主动断线——重连模块只在 `disconnect` 事件后调度（reconnect/index.js），是否重连取决于服务端关流或应用自行处理。实现策略，不是协议限制。

## 阶段3：Resource Bind 资源绑定

> 
> JID 格式：`user@domain/resource`。
> SASL只确认账号 `alice@demo.com`；bind申请 resourcepart（RFC7622 定义为 opaque identifier，通常用来标识一个客户端实例，不保证一一对应物理设备），拿到完整 JID 才算登录完成。

1. 客户端发送 iq-set 请求，iq 必须携带 id

```
<iq type="set" id="bind-001">
  <bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"/>
</iq>
```

- bind 内部为空：由服务端自动生成 resource；
- 也可内部携带 `<resource>pc</resource>` 手动指定 resourcepart（客户端实例标识）。

2. 服务端 iq-result 返回完整JID

```
<iq type="result" id="bind-001">
  <bind xmlns="urn:ietf:params:xml:ns:xmpp-bind">
    <jid>alice@demo.com/a7g2k9</jid>
  </bind>
</iq>
```

3. 登录完成后，客户端发送空 presence 报文广播上线状态，好友才能看见在线（注意：bind 完成即可**发送** stanza；**接收**取决于目标地址与路由——发往本 full-JID 的消息 connected 资源可收，发往裸 JID 的消息按 available 资源路由、未发 initial presence 不保证收到。presence 决定 available 状态与 presence 推送，RFC6121 §4.2.2/§8.5）

```
<presence/>
```

## 协议完整时序

1. TCP connect完成
2. C→S：`<stream:stream>` 打开XML流
3. S→C：stream header + `stream:features`
   - TLS mandatory-to-negotiate：features 通常只含 `<starttls/>`（§5.3.1 SHOULD NOT 同时广播其他 feature）→ C→S `<starttls/>` → S→C `<proceed/>` → **TLS 握手** → C→S 重开 `<stream:stream>` → S→C 新 header + features（SASL 机制）
   - 否则：features 直接给出 SASL 机制列表
4. C→S：SASL `<auth>` 认证报文
5. S→C：
   - 分支A（成功）：`<success/>`，SASL 认证结果在同一底层连接的协商上下文中生效 → C→S：同一socket重发全新 `<stream:stream>`（旧流被替换）→ S→C：新stream header + `stream:features`(bind) → 进入bind
   - 分支B（失败）：`<failure>`，携带错误原因；机制适合重试时可在同流重发 `<auth>`（2~5次，RFC6120 §6.4.5）；超限服务端以 `policy-violation` 流错误关流，才需重连从头重来
6. C→S：iq-set bind 请求
7. S→C：iq-result 返回完整JID ✔登录完成
8. C→S：`<presence/>` 广播上线

---

# XMPP S2S（RFC6120 / XEP-0220）

## 基础信息

- 默认端口：**5269**（SRV 无结果时的回退端口，RFC6120 §3.2.2；C2S 默认 5222）
- 命名空间：**`jabber:server`**（C2S 是 `jabber:client`），禁止混用
- 没有用户登录、没有 bind、没有 resource；两端是**域名实体**
- 双向通信需要**两条独立物理 TCP**，不是一条 TCP 内的两条逻辑流（经典模型；XEP-0288 可单连接双向）

## 两条物理 TCP 的职责定义

底层 socket 物理全双工，但协议把数据分成两类，职责严格划分：

|  | TCP-OUT（a 主动连 b） | TCP-IN（b 主动连 a） |
| --- | --- | --- |
| 流方向 | a → b | b → a |
| 发起方 | a.com | b.com |
| 允许写（发起方） | 流控制帧 + a→b 业务 stanza | 流控制帧 + b→a 业务 stanza |
| 允许写（接收方） | **仅流控制应答帧**（含回程流头），禁止写业务 stanza | **仅流控制应答帧**（含回程流头），禁止写业务 stanza |
| 允许读（发起方） | 读对方流控制应答帧 | 读对方流控制应答帧 |
| 允许读（接收方） | 读流控制帧 + 对方业务 stanza | 读流控制帧 + 对方业务 stanza |

### 两类数据边界

1. **流控制帧**：`<starttls/>`、`<proceed/>`、stream-error、Dialback 的 `db:verify`/`db:result` 等协商控制帧。在哪条流发起请求，应答就在**同一条 TCP 返回**，不受单向约束。
2. **业务 stanza**：message / iq / presence。严格服从流方向，**绝不反向写回原 TCP**。

> 
> 例：a 通过 TCP-OUT 发 iq（业务）；b 回 iq-result（业务）必须走 TCP-IN，不能写回 TCP-OUT。

## S2S 完整建立时序

### 1. 触发建立

a.com 收到本域用户 stanza，目标域名是 b.com，判定需跨域转发。
检查是否已有 **a→b 方向**完成域名校验的会话（S2S 会话按 domain pair + 方向维护，**不要求成对**）：

- 有：直接复用，流程结束。
- 无：开始完整建立。

### 2. DNS 解析（RFC6120 §3.2.1-3.2.2）

查询 SRV 记录 `_xmpp-server._tcp.b.com`，按优先级/权重取 target:port：
- 有 SRV 记录 → 连接 SRV 返回的 `target:port`；
- SRV 结果只有一条且 target 为 `.`（根域）→ **MUST 终止**：该域明确不提供服务（§3.2.1 规则3 原文 "the service is decidedly not available at this domain"）；
- 收到了 SRV 结果但全部连接失败 → **SHOULD NOT** 再回退到域名默认端口（§3.2.1 规则8，防止入/出站连接状态错配）；
- **没有**收到 SRV 应答 → 才按 A/AAAA 解析原始域名并用默认端口 5269（§3.2.2）。

### 3. 建立 TCP-OUT

1. a.com 发起 TCP 三次握手，连上一步解析出的地址（SRV target:port，或无 SRV 应答时的 `b.com:5269` 回退）。
2. a.com 在 TCP-OUT 发送 S2S 流头（命名空间 `jabber:server`，from/to 填**域名**）。
3. b.com 接收连接与流头，启动 XML 解析器。

> 
> 此时仅物理连通，**无加密、域名未校验，严禁转发业务 stanza**。

### 4.（按需）b.com 反向建立 TCP-IN —— 仅当 b 确实要向 a 发送 stanza 时才执行

a→b 单向业务**不需要**这一步；b→a 方向的业务 stanza 需要一条由 b 主动发起的连接承载（经典模型）：

1. b.com 同样先查 `_xmpp-server._tcp.a.com` 的 SRV，再三次握手连解析出的地址（无 SRV 应答时回退 `a.com:5269`）。
2. b.com 在 TCP-IN 发送 S2S 流头。
3. a.com 启动对应 XML 解析器。

> 
> 两条物理 TCP 全部就绪，各自独立做流协商。
> 注意：回连**时机**由实现决定（收到流入连接即回连，或等 b 有出站流量再建）；走 TLS 证书强认证（SASL EXTERNAL）时无需为校验额外回连。
> XEP-0288（双向S2S）进一步允许一条连接承载双向业务 stanza；“必须两条物理TCP”是 RFC6120/XEP-0220 经典模型，现代部署未必如此。

### 5. TCP-OUT 执行 STARTTLS

1. a.com 在 **TCP-OUT** 写 `<starttls/>`（流控制帧）。
2. b.com 在**同一个 TCP-OUT socket** 写回 `<proceed/>`（流控制应答帧，允许）。
3. 传输层执行 TLS 握手（注意**方向**，RFC6120 §13.7.2.1：发起方以 'to' 地址为参照核对接收方证书）：
   - b.com 证书可信、域名匹配 → a.com **已完成对接收方 b.com 的身份验证** + 该流加密；但 b.com 尚未认证**发起方 a.com**——发起方身份授权在第7步（SASL EXTERNAL 或 Dialback）。
   - 证书不可信 → TLS 仅加密（本地策略可直接拒绝），域名身份后续走 Dialback（弱验证，见第7步注）。

### 6.（按需）TCP-IN 对称执行 STARTTLS

1. b.com 在 **TCP-IN** 写 `<starttls/>`。
2. a.com 在**同一个 TCP-IN socket** 写回 `<proceed/>`。
3. 传输层执行 TLS 握手。

### 7. 域名身份校验（二选一）

**路径 A：TLS 完成后实际协商 SASL EXTERNAL 并通过** → 直接完成，跳过 Dialback。注意"证书校验通过"≠"EXTERNAL 自动完成"：服务端须在 mechanisms 提供、客户端须选择、服务端再核对授权身份（RFC6120 §6）。

**路径 B：未使用（或未能使用）SASL EXTERNAL 时，以 Dialback 回拨做弱验证**（典型场景：证书不可信、或部署不做证书身份授权）：

1. **a.com（发起方/Sender Domain）生成 key**——不是随机数，按 XEP-0185 §2 公式：`key = HMAC-SHA256( hex(SHA256(secret)), "接收方域名 发起方域名 流ID" )`。secret 为 **a.com 域级**密钥（先 SHA256、输出 **MUST 转十六进制**再作 HMAC key；三元组以 U+0020 空格拼接，顺序 = 接收方/发起方/流ID。权威验证节点与发起节点可以是不同机器，只需共享域级 secret，XEP-0220 §5.2；两域之间**没有预共享密钥**）。
2. a.com 在 TCP-OUT 上发送 `<db:result from="a.com" to="b.com">KEY</db:result>`。
3. b.com 向 a.com 的**权威服务器**（按 Sender Domain 查 DNS）发送 `<db:verify from="b.com" to="a.com" id="流ID">KEY</db:verify>` 请求验证；该连接**可复用已有 b→a 连接，也可单独新建**（XEP-0220：MAY open a separate connection）。
4. a.com 用同样的 secret 重新生成 key 比对：一致回 `<db:verify type="valid"/>`，不一致回 `type="invalid"`。
5. b.com 收到 `valid`，确认 TCP-OUT 对端确为合法 a.com，并在 TCP-OUT 上回 `<db:result type="valid"/>` 告知 a.com。
6. （仅当 b→a 方向要承载业务时）对称执行，校验 b.com 域名身份——dialback 授权按 domain pair + 方向独立完成。

> 
> **每个方向独立校验、独立可用**：a→b 方向校验通过即可在 TCP-OUT 发送业务 stanza，**不要求 b→a 反向连接/校验先完成**；两个方向都有业务时，经典模型才形成两条 TCP。
> Dialback **本身**不提供机密性与完整性，无 DNSSEC 时易受 DNS 欺骗；若承载于 TLS 之上传输可加密、DNSSEC 可增强身份验证（XEP-0220/XEP-0185）。b 通过向 a.com 权威服务器回查确认 key 出自 a.com（两域之间没有预共享密钥）。是否因证书不可信直接终止取决于本地策略——RFC7590 §3.4：服务端 SHOULD 认证对端但**不做强制**（原文 "does not mandate that servers need to authenticate peer servers"），加密但未认证的 S2S 连接配合 Dialback 在某些场景可作为兼容方案。

### 8. 会话可用，业务转发

条件（**按方向独立满足**；**"TLS 完成"是本文的安全基线**，协议层面 TLS 为 mandatory-to-implement、发起方 SHOULD 尝试，部署方可设为 mandatory-to-negotiate，传统 Dialback 可不经 TLS——RFC6120 §5）：该方向 TCP 存在 + 该方向身份校验通过（强认证用 SASL EXTERNAL，弱验证用 Dialback）。

- a→b 业务 stanza → TCP-OUT
- b→a 业务 stanza → TCP-IN

### 9. 会话生命周期

1. 长连接，多用户跨域流量可复用同一套会话。
2. 空闲超时属**实现策略**（RFC6120 §4.6.3 只规定 idle peer MAY 自行关流、对端 MAY 按"local timeout policy"关流）：某些服务端会在空闲时按方向发 `</stream:stream>` 关流、断开相应 TCP；各方向流/连接按各自生命周期关闭。
3. 后续再有跨域需求：按方向重建所需连接（仍存活的会话可继续复用）。

## 关键坑点

1. S2S 经典模型**每个业务方向一条 TCP**：单向通信只需一条，双向通信通常形成两条；不是一条 TCP 内的两条逻辑流——和 C2S 模型本质不同（XEP-0288 可单连接承载双向）。
2. b→a 方向需要 b 主动发起的连接承载，但**回连时机由实现决定**，并非“收到流入连接必须立即回连”。
3. TCP 连通 ≠ 会话可用；**该方向身份校验/授权（SASL EXTERNAL 或 Dialback）完成前不转发业务 stanza**。
4. Dialback 的 verify 连接**可复用已有 b→a 连接**，也可单独新建（XEP-0220 MAY），不是必须额外临时 TCP。
5. 命名空间固定 `jabber:server`，混用 `jabber:client` 属内容命名空间错误，服务端返回 `invalid-namespace` **流错误**（RFC6120 §4.9.3.10）——XML本身合法，不是“解析失败”。
6. "单向流"约束的是**业务 stanza**，不约束流控制应答帧。
7. 部署排查建议（运维经验，非协议事实）：5269 端口常被云防火墙默认封禁，导致联邦互通失败。
8. S2S 只做转发（**限目标为远端用户/资源**；目标是远端域 JID、组件或服务器级 iq 时，接收服务器本身就是处理方）；路由投递、离线存储由**接收方**执行。错误生成分两种（RFC6120 §10.4.3）：发送方服务器在 DNS 解析失败 / S2S 流无法建立时**自己生成** `remote-server-not-found` / `remote-server-timeout`；只有远端已收到但无法投递时，错误才由接收方生成并回传。

## C2S vs S2S 对比

| 项目 | C2S | S2S |
| --- | --- | --- |
| 物理 TCP 数量 | 1 条 | 每方向 1 条：单向 1 条、双向通常 2 条（XEP-0288 可单连接双向） |
| XML 流模型 | 1 条 TCP 承载两条逻辑单向流 | 每条 TCP 只承载单向的业务 stanza（流协商/控制帧双向） |
| 命名空间 | `jabber:client` | `jabber:server` |
| 端口（SRV 无结果时的回退默认） | 5222 | 5269 |
| 身份校验 | 用户 SASL + bind 拿 full-JID | 域名授权（SASL EXTERNAL 强认证 / Dialback 弱验证） |
| 实体 | 用户（带 resource） | 域名 |
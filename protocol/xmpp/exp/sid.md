# XEP-0359：唯一且稳定的消息 ID

> 官方规范：<https://xmpp.org/extensions/xep-0359.html>
>
> 当前状态：**Experimental 0.7.0** —— 仍是实验性协议，规则可能变化，不能当 Final 协议对待。

---

## 1. 要解决的问题

XMPP 消息自带的 `id` 属性由发送方分配：RFC 6120 §8.1.3 对 `<message/>`/`<presence/>` 携带 `id` 只是 **RECOMMENDED**（`<iq/>` 才是 REQUIRED，用于"请求↔响应"配对），且唯一范围由发送方自行决定——可以仅在当前 stream 内唯一，也可以全局唯一（如 UUID）。

不同路由场景要穿过的环节各不相同：

```
1:1 在线：  客户端A → A的服务器 → B的服务器 → 客户端B
1:1 离线：  客户端A → A的服务器 → B的服务器 → 离线存储 → 客户端B 上线后投递
MUC 群聊：  客户端A → A的服务器 → MUC 房间 → 反射给所有成员 + 归档
```

注意：问题**不是**"每个中继都会改写 `id`"——Carbon 复制（XEP-0280）是把原始 `<message/>` 封装在 `<forwarded/>` 里转发，MAM 归档（XEP-0313 §3.5）是**额外追加**一个 `by` 为归档 JID 的 `stanza-id`，原 `id` 都保留。真正的缺口是：**协议没有要求 `<message id>` 全局唯一且长期稳定**，唯一性范围完全由发送方说了算。

**结论**：不能仅凭普通 `<message id>` 获得跨实体、跨归档的统一稳定标识，因此它无法可靠地用于全局去重、归档定位或跨端关联。

XEP-0359 定义了 `urn:xmpp:sid:0` 命名空间，提供两个**用于分配 ID** 的元素。这里要区分两件事：ID 值在生成实体范围内**必须唯一且稳定**（MUST，规范原文 "unique and stable... within the scope of the 'by' value"；即使元素被某跳路由剥离，ID 本身也不变）；但元素能否端到端保留**不是绝对保证**——路由实体只是 **SHOULD NOT** 剥离它。

---

## 2. 两个用于分配 ID 的元素

| 维度 | `<origin-id/>` | `<stanza-id/>` |
| --- | --- | --- |
| 谁生成 | 发送方（客户端）自己生成 | 服务器 / MUC 房间等中继实体生成 |
| `by` 属性 | **没有**（隐藏发送方地址） | **必须有**（声明由谁分配） |
| 语义 | 发送方自述"这条是我发的"（**可伪造，无身份背书作用**） | "在 `by` 所标识的实体范围内唯一且稳定" |
| ID 稳定范围 | 以发送方为 scope | 以 `by` 指向的实体为 scope |
| 能否被追加/保留 | 服务器/组件添加 `stanza-id` 时 **MUST** 保留；一般路由实体只是 **SHOULD NOT** 剥离 | 遇到 `by` 与自己相同的元素 **MUST** 删除（即使不重新盖章也必须删，防伪造） |
| 目的 | 发送方多端识别自己发的那条 | 给全房间/归档提供统一主键（"可信"有前提，见第 5、6 节） |

### 例子 1：客户端发出时（只有 origin-id）

```
<message xmlns='jabber:client' to='room@muc.example.com' type='groupchat'>
  <body>hello</body>
  <origin-id xmlns='urn:xmpp:sid:0' id='de305d54-75b4-431b-adb2-eb6b9e546013' />
</message>
```

### 例子 2：房间反射给所有人时（追加 stanza-id，origin-id 原样保留）

```
<message xmlns='jabber:client' to='room@muc.example.com' type='groupchat'>
  <body>hello</body>
  <stanza-id xmlns='urn:xmpp:sid:0'
             id='5f3dbc5e-e1d3-4077-a492-693f3769c7ad'
             by='room@muc.example.com' />
  <origin-id xmlns='urn:xmpp:sid:0' id='de305d54-75b4-431b-adb2-eb6b9e546013' />
</message>
```

---

## 3. 为什么需要两个而不是一个

核心原因：**客户端和服务器是两个不同的信任域，谁也替代不了谁。**

### 为什么不能只留 origin-id？

- **服务器不信任客户端**：客户端可能伪造 ID、不保证唯一。服务器做 MAM 归档、群聊去重时需要自己可控、可验证的编号。注意强度分层：XEP-0359 自身只规定服务器/组件 **MAY** 添加 `stanza-id`；只有在具体协议进一步要求时才是 MUST——例如 MAM（XEP-0313 §3.5）规定归档服务**必须**为每条归档消息添加 `stanza-id`，`by` 为归档地址（用户 bare JID 或房间 bare JID）。
- **origin-id 没有 `by`**：接收方无从验证"这个 ID 是谁生成的"，不能用作归档主键。

### 为什么不能只留 stanza-id？

- **盖章前缺的是受保护的发送方 ID**：客户端在消息刚发出、服务器还没反射/盖章时（本地保存、离线、跨设备同步）并非没有 ID 可用——普通 `message id` 本就可自行生成，甚至可做成全局唯一的 UUID（RFC 6120 §8.1.3 允许）；缺的是一个**受 XEP-0359 唯一性、稳定性和保留规则约束**的发送方稳定 ID。
- **stanza-id 表达不了"这是我发的"**：它的 `by` 是服务器/房间，语义是"在 `by` 实体范围内唯一且稳定"，不是"发送者本人"。

### 典型场景：MUC 群聊反射

房间把消息反射给所有成员（包括发送者自己）：

- 房间盖的 `stanza-id`（by=room）→ 归档/全房间有统一主键；
- 客户端收到反射副本时认出"这条就是我发的"→ 靠**自己带的 `origin-id`**（房间添加 `stanza-id` 时 MUST 原样保留；一般路由实体只是 SHOULD NOT 剥离）。

**一句话**：一个解决"发送方视角的稳定"，一个解决"服务器视角的稳定"；一个是发送方的自述（可以不信任），一个由中立方盖章，不可互相替代。

---

## 4. 业务规则

1. `id` 值**应不可预测**（防猜测）。
2. 遇到 `by` 与自己将要设置相同的 `<stanza-id/>`，即使不新增 ID 也**必须删掉**它（防伪造/重复盖章）。
3. 路由中的实体**不应剥离** `urn:xmpp:sid:0` 命名空间的元素（除非触发上一条）。
4. 一条消息**至多一个** `by` 地址相同的 `<stanza-id/>`。
5. `<stanza-id/>` 必须同时有 `id` 和 `by` 两个属性。
6. 两个元素都**必须**有 `id` 属性，且**不得**有子元素或文本内容。
7. 一对一消息中 `by` 是账号；群聊中 `by` 是房间。

---

## 5. 判断可用

服务器/房间在 disco 特性中声明 `urn:xmpp:sid:0`（XEP-0359 的要求是 SHOULD 声明，官方说法是"让其他实体验证这些业务规则确实被遵守"）。这是重要的可信度检查——官方要求接收方在用 ID 去重或做 MAM catchup 前 **SHOULD** 这样验证，但它不是密码学验证：`id + by` 不可伪造的前提始终是"**所有相关实现都遵守本规范**"（iff all involved implementations follow the requirements）：

```
<iq from='room@muc.example.com' to='romeo@montague.tld/garden'
    id='somethingrandom' type='result'>
  <query xmlns='http://jabber.org/protocol/disco#info'>
    …
    <feature var='urn:xmpp:sid:0' />
    …
  </query>
</iq>
```

---

## 6. 安全要点

- `id` 是**非机密值**，但**不应泄露**额外信息（如不能从 ID 推断归档大小）。
- `origin-id` **可伪造**：没有 `by` 属性、无法验证生成者，官方明确不应作为可信的跨消息引用。
- 接收方在用 ID 去重或做 MAM 补拉前，应通过 disco 确认 `by` 指向的实体声明了 `urn:xmpp:sid:0`（官方为 SHOULD；这是前提检查，不是密码学层面的防伪证明）。

---

## 7. 典型应用场景

1. **MAM 消息归档**（XEP-0313 §3.5/§4.2）：实时收到消息时，归档服务 **MUST** 附加 `by` 为归档地址的 `stanza-id`——作用是**提前传达**这条消息在归档中的 UID；但查询结果里的权威 UID 是外层 `<result id='...'/>`（内层转发消息 **MAY** 再带 `stanza-id`，客户端 **MUST NOT** 依赖它），RSM 分页也以 archive UID 为准。
2. **MUC 群聊反射**：消息被房间反射给所有成员时，靠 `stanza-id` 识别"这就是那条消息"。
3. **消息撤回（XEP-0424 0.5.0，§5.2 分三种情况）**：1:1 聊天用原消息 `<message id>`；MUC 且房间支持 XEP-0359 时，**SHOULD** 用房间分配的 `stanza-id`（`by` 为房间 bare JID；§3 的正式强度是大写 SHOULD，§5.2 行文是小写 must——按 BCP 14 及该 XEP 附录约定，只有全大写才是强制词，不能标成 MUST）；MUC 且房间不支持 XEP-0359 时，客户端可以预先给消息附上 `origin-id`，撤回时用它定位——所以"现行规范不引用 `origin-id`"是错误结论（另有已 Deferred、官方不建议生产使用的 XEP-0422 `apply-to` 也基于它）。**消息编辑（XEP-0308）**则用 `<replace id='...'/>` 引用原消息的 `<message id>`。
4. **多端去重**：客户端多设备收到同一条消息时，靠稳定 ID 合并，避免重复展示。

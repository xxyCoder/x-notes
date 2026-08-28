# XEP-0184 送达回执

> 官方规范：<https://xmpp.org/extensions/xep-0184.html>（当前状态：Stable 1.4.0）

**一句话**：客户端之间传消息时，利用 `urn:xmpp:receipts` 命名空间的两个扩展元素实现"送达"确认（非已读确认）。

## 核心机制（就两个字段）

```
发送方 → 内容消息里加  <request/>           // "给我回执"
接收方 → 回执消息里加 <received id="原消息id"/>  // "我收到了"
```

**关键约束**：

- 内容消息必须有 `id`，回执的 `id` 原样回显它（追踪用）
- 回执消息**禁止（MUST NOT）**再带 `<request/>`（防无限循环）；**原则上（SHOULD）**只含 `<received/>`——中间实体仍可能添加 `<delay/>` 等扩展，别据此判错
- 只证明"送达客户端"，不证明"已读/已处理"

## 完整例子

```
<!-- 1. 发送方：请求回执 -->
<message from='A@host/res' id='msg-1' to='B@host/res'>
  <body>hello</body>
  <request xmlns='urn:xmpp:receipts'/>
</message>

<!-- 2. 接收方：返回回执 -->
<message from='B@host/res' id='ack-1' to='A@host/res'>
  <received xmlns='urn:xmpp:receipts' id='msg-1'/>
</message>
```

能力探测：支持本协议的实体 **MUST** 在 disco#info 中声明 `<feature var='urn:xmpp:receipts'/>`（要不要主动发起探测由实现决定，但"声明"本身对支持方不是可选项）。

## 使用规则速记

| 场景 | 规则 |
| --- | --- |
| bare JID | **MAY** 请求（无法确知最终投递到哪个 resource、能力未知），但 **MUST NOT** 依赖收到回执 |
| full JID | **SHOULD** 先探测（disco/caps）能力；确认不支持则 **SHOULD NOT** 请求；确认支持也只是 **MAY** 请求、**SHOULD NOT** 依赖回执 |
| groupchat 群聊 | **不推荐**请求（每人回一条，刷屏） |
| 历史/归档消息 | 永不发回执（只在首次收到时回） |
| 不支持/未配置 | **MUST NOT** 回回执；**SHOULD NOT** 报错（两者强度不同） |

## 注意

- **无可靠性保证**：对方不支持/故障/回执丢失/不愿回都可能收不到，收到才说明送达，收不到不说明任何问题。
- 多端在线可能收到多条回执，每条都是合法的协议事件；"去重"是业务展示策略，不是协议规则。
- 有 presence 泄露风险：不应向无权看你在线状态的人回执。

**本质**：就是一个带 `request` 的请求 + 带 `received` 的确认，`received` 的 `id` 指回原消息——但不是严格的一一对应：一条原消息可能对应多个 resource 的多条回执。
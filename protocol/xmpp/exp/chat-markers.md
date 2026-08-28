# XEP-0333 展示标记（产品中常称"已读标记"）

> 官方规范：<https://xmpp.org/extensions/xep-0333.html>（当前状态：Stable 1.0.0）

**命名空间**：`urn:xmpp:chat-markers:0`

## 核心思想

一条标记表达"**展示到哪条为止**"（到此为止都已在客户端展示过），不逐条确认，是**启发式**方案。协议只能证明客户端把消息展示出来了，不能证明用户真的看见、理解了消息——产品里俗称"已读"，但协议给不了这个保证。

## 仅两个元素

- `<markable/>`：发消息时附带，表示"请回送展示标记"
- `<displayed id='X'/>`：客户端展示到该消息后回发，`id` 复制被展示消息的 id

## 例子：1:1 聊天

**发送方（必须带 id）**

```
<message to='juliet@capulet.lit' from='romeo@montegue.lit/orchard' id='the-msg-1'>
  <body>Hi. How are you?</body>
  <markable xmlns='urn:xmpp:chat-markers:0' />
</message>
```

**接收方回执**

```
<message to='romeo@montegue.lit' from='juliet@capulet.lit/balcony'>
  <displayed xmlns='urn:xmpp:chat-markers:0' id='the-msg-1' />
</message>
```

**一次展示多条**：SHOULD 只为**最近收到**的那条发标记（官方原文：only send a marker for the most recent, received message）。

## 群聊（MUC）特殊点

- 房间在 disco 中声明支持 XEP-0359 时，客户端 **MUST** 用**房间分配**的 `stanza-id`（`by` 为房间 JID），别用发送方自定义 id（可能被复用/伪造）
- 房间**未声明**支持 XEP-0359 时，`by` 匹配房间 JID 的 `stanza-id` 必须视为可伪造并**忽略**
- 可**主动上报**标记，无需对方请求
- 可靠关联"是谁展示了"：**MUST** 用真实 JID（可得时，例如非匿名房间）或 XEP-0421 匿名 occupant ID

## 隐私与安全

- 展示标记会**泄露 presence**：**SHOULD NOT** 发给无权查看你 presence 的实体
- 不是人人都想暴露"已读"：客户端 **SHOULD** 提供关闭该功能的选项

## 关键规则

| 规则 | 说明 |
| --- | --- |
| 只能前进 | 收到更旧的标记 → 忽略 |
| 未知 id | 聊天里找不到的消息 → 忽略 |
| 防回环 | 禁止对标记回标记 |
| 不给自己发 | 不标记自己发出的消息（含离线同步收到的） |
| 1:1 原则上不主动发 | 无请求时不建议发（**NOT RECOMMENDED** 而非禁止，有充分理由仍可；群聊允许主动） |

## 历史沿革（易踩坑）

- 早期共 4 个元素：3 种 marker（received / displayed / acknowledged）+ 请求元素 `<markable/>`
- **received 已删**：与 XEP-0184 重复
- **acknowledged 已删**：10 年没人实现
- **现在只有 markable + displayed**

## vs XEP-0184

- **0184 送达回执**：逐条确认"收到"，精确
- **0333 展示标记**：一段一标"展示到哪"，累计且启发式

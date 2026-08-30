# XMPP stream-error（RFC6120）

## 核心本质

stream-error = **XML会话流级别错误**

- 一旦发送 `<stream:error>`，协议强制紧跟 `</stream:stream>` 关闭XML流，**流直接作废，不可继续收发stanza**
- 命名空间：`urn:ietf:params:xml:ns:xmpp-streams`
- 对比：stanza-error 是单条报文错误，**流保持存活**
- TCP连接：RFC6120 §4.9.1.1 要求 MUST 立即关流；TCP 终止遵循 §4.4 关闭握手——先等对方回 `</stream:stream>` 或超时，再断TCP。所以抓包可能在窗口期内看到TCP仍存活，但应用层必须把流视作已死亡，禁止写入任何XMPP报文

## XML报文基础模板

```
<stream:error>
  <!-- 标准条件空元素，必选 -->
  <not-well-formed xmlns='urn:ietf:params:xml:ns:xmpp-streams'/>
  <!-- text：人类可读描述，可选 -->
  <text xmlns='urn:ietf:params:xml:ns:xmpp-streams' xml:lang='en'>reason</text>
  <!-- 自定义扩展元素，可选 -->
</stream:error>
</stream:stream>
```

> 
> 特殊：`see-other-host` 不是空元素，内部放目标地址——FQDN 或 IP，可带 `:port`（RFC6120 §4.9.3.19）。

## 重点条件

1. **not-well-formed**
XML字节不满足Well-Formed语法；标签未闭合、标签不匹配、非法字符。XML解析器彻底无法继续解析流。

> 
> ⚠️ bad-format：RFC6120 §4.9.3.1 **仍定义**该条件（"sent XML that cannot be processed"），**未废弃**；它是 not-well-formed 等具体条件的通用兜底，RFC 只是 RECOMMENDED 优先使用更具体的条件。

2. **not-authorized**
典型场景：流未完成 SASL 认证就发送 stanza；完整定义还覆盖其他与流协商相关的未授权行为（§4.9.3.12 原文 "or otherwise is not authorized to perform an action related to stream negotiation"）。

> 
> 为什么不用stanza-error（就“认证前发 stanza”的典型场景而言）：流尚无有效身份，接收方不得处理该 stanza（§4.9.3.12 原文：MUST NOT process the offending data），因此只能以 stream-error 终止流。

3. **conflict**
同一实体的新旧流冲突，两个方向都合法（RFC6120 §4.9.3.3）：关旧流让新流顶替，**或**拒绝新流保留旧流；也用于 S2S 域对连接数限制等本地策略冲突。RFC 不保证一定踢旧连接。

4. **connection-timeout**
一方有理由认为对端**已永久失去在该流上的通信能力**而关流（RFC6120 §4.9.3.4：可通过 whitespace keepalive、XEP-0199 ping、XEP-0198 探测发现）；不是"纯空闲超时"，也不等同于TCP断连。

5. **see-other-host**
服务器重定向，让客户端连接另一台主机。

- 依旧是stream-error：当前流依旧要关闭
- 错误体内携带目标主机；客户端需要解析，重新建立新流，不能只简单断开。

## 开发要点

1. 输出 stream-error 之后，**必须输出`</stream:stream>`**，不能只发 error 标签。
2. TCP 连接不一定立刻被操作系统关闭；客户端收到 stream-error 后，不要再发送任何 XMPP 报文。
3. `<text>` 只是给人看的日志，**程序逻辑不要解析text字段**，只判断条件元素。
4. 未认证的流，收到业务 stanza → not-authorized，关流。
5. 流错误不能在当前 XML stream 内恢复：
   - 发送 `<stream:error>` 后必须立即关闭 XML stream；收到对方的关闭标签或等待超时后，终止底层 TCP 连接（RFC6120 §4.9.1.1、RFC6120 §4.4）。
   - `<reset/>` 也属于流错误，不是复用原 TCP 的 stream restart。它表示当前安全上下文不能继续使用，例如密钥或证书失效、TLS sequence number 用尽，或服务端需要提供新的安全关键特性。
   - 客户端需要重新建立 TCP 和 XML stream，并重新协商 TLS、SASL；C2S 还需重新绑定 resource。旧安全上下文作废，TLS session resumption 也不能使用（RFC6120 §4.9.3.16）。
   - 不要与 TLS / SASL 成功后的正常 stream restart 混淆：正常 restart 明确复用原 TCP，不发送 `</stream:stream>`（RFC6120 §4.3.3）。

# XMPP stanza-error（RFC6120 §8.3）

## 核心本质

stanza-error = **单条报文（stanza）级别错误**，作用对象：`iq` / `message` / `presence`

- 仅针对当前这一条报文报错；**XML流、TCP连接全部保持存活，可继续收发其他报文**
- 命名空间：`urn:ietf:params:xml:ns:xmpp-stanzas`
- 和 stream-error对比：stream-error销毁整条会话；stanza-error只应答单条失败，会话继续。

> 
> 定位：是对原始stanza的响应报文。

## 通用报文规则

1. `id`：
   - iq：`id` **MUST**，error应答必须原样复制id，用于请求应答配对
   - message / presence：`id` **MAY(可选)**；原报文有id则应答复制id；原报文无id则应答**省略 id 或携带空值 id，两者均可**（RFC6120 §8.3.1 规则3）
2. `type` 属性强制改为 `type="error"`
3. `to` / `from` 按XMPP路由规则填充
4. **原始请求载荷 MAY 带回**：RFC6120 §8.3.1 规则6 明确是 MAY（"this is a courtesy only"，发送方 MUST NOT 依赖回传）；xmpp.js iqCallee 等实现会带回，工程上可参考但协议不保证
5. 内嵌 `<error>` 子元素

### 模板示例

```
<!-- 原始请求 iq -->
<iq id="req-001" type="get" to="bob@example.com">
  <some-query xmlns="urn:xxx"/>
</iq>

<!-- stanza-error应答 -->
<iq id="req-001" type="error" to="alice@example.com">
  <some-query xmlns="urn:xxx"/> <!-- 原请求载荷：MAY带回（courtesy），不保证 -->
  <error type="modify">
    <bad-request xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/>
    <text xmlns="urn:ietf:params:xml:ns:xmpp-stanzas" xml:lang="en">bad params</text>
  </error>
</iq>
```

message无id示例：

```
<!-- 原始message，无id -->
<message to="bob@example.com">
  <body>hello</body>
</message>

<!-- 应答error，同样无id -->
<message type="error" to="alice@example.com">
  <body>hello</body>
  <error type="cancel">
    <item-not-found xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/>
  </error>
</message>
```

## `<error>` 内部结构

1. `type`：必选，5种取值（`continue` 罕见），指导客户端如何处理错误
2. 标准条件元素：必选，stanzas命名空间下空元素
3. `<text>`：可选，人类可读描述；**业务代码禁止解析text，仅用于日志**
4. 自定义扩展元素：可选，业务自定义错误

### error type 语义

| type | 含义 | 客户端行为建议 |
| --- | --- | --- |
| modify | 请求本身有误 | 修改参数后重试 |
| cancel | 本次请求不可原样重试（do not retry） | 不要重试 |
| auth | 鉴权/权限问题 | 先完成身份认证、补齐权限 |
| wait | 临时故障 | 等待一段时间后重试 |
| continue | 仅警告 | 继续流程（罕见） |

常用搭配举例：

- 参数非法 → `type="modify"` + `<bad-request/>`
- 目标不存在 → `type="cancel"` + `<item-not-found/>`
- 权限拒绝 → `type="auth"` + `<forbidden/>`
- 服务器过载 → `type="wait"` + `<resource-constraint/>`

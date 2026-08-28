# XMPP 基础理解

XMPP 的全称是 **Extensible Messaging and Presence Protocol**，可以理解为：

> 一套使用 XML 流，在客户端、服务端以及不同服务端之间传递消息、实体状态和结构化请求的可扩展通信协议。

## Protocol

`Protocol` 表示 XMPP 不只是定义 XML 的格式，还规定了 XML：

- 怎么发送；
- 发给谁以及服务端怎么路由；
- 接收方怎么解释；
- 接收方怎么返回成功或错误。

因此，XML 是数据的表示形式，XMPP Protocol 则规定这些 XML 在什么情况下发送、如何传输以及如何处理。

## Messaging

`Messaging` 表示 XMPP 提供了通用的消息传递能力，主要通过 `<message/>` stanza 实现。

```xml
<message from="alice@example.com/phone"
         to="bob@example.com"
         type="chat">
  <body>Hello</body>
</message>
```

它不只可以传递聊天文本，还可以借助扩展传递图片信息、已读回执、消息撤回、正在输入等信息。

## Presence

`Presence` 表示 XMPP 提供了实体状态的发布、订阅和传递能力，主要通过 `<presence/>` stanza 实现。

```xml
<presence>
  <show>away</show>
  <status>吃饭去了</status>
</presence>
```

它主要描述实体的可用状态，例如在线、离线、忙碌、离开，以及哪些联系人有权订阅这些状态。

## Extensible

`Extensible` 表示通信双方可以通过 XML namespace，也就是 `xmlns`，约定扩展协议，让双方能够收发并理解 XMPP 核心协议没有定义的数据。

XMPP 顶层的三种核心 stanza 是：

- `<message/>`：推送式消息；
- `<presence/>`：状态发布和订阅；
- `<iq/>`：结构化的请求和响应。

扩展协议通常不是创建一种新的顶层 stanza，而是把带有独立 `xmlns` 的扩展元素放进这三种合法 stanza 中：

```xml
<message to="bob@example.com">
  <body>轮到你了</body>
  <game xmlns="urn:example:chess:1">
    <move>e2-e4</move>
  </game>
</message>
```

在这个例子中：

- 服务端认识 `<message/>` 和 `to`，所以能够完成路由；
- 服务端即使不认识 `<game/>`，也应该把这个未知扩展继续传递给接收方；
- 接收方通过 `xmlns="urn:example:chess:1"` 找到对应的协议解析逻辑，从而理解 `<move>` 的含义。

### 未知扩展透传的边界

“服务端不认识 `xmlns` 也会原封不动透传”这个理解成立，但需要满足以下条件：

1. 扩展内容必须放在合法的 `<message/>`、`<presence/>` 或 `<iq/>` stanza 内。顶层一级元素只有三类 stanza（§4.1 定义：depth=1、限定 jabber:client/server 命名空间）和各协商协议定义的元素；自造的未知顶层元素无应用语义；协议为其定义了专门的流错误条件 `unsupported-stanza-type`（RFC6120 §4.9.3.24：不支持的一级流子元素），服务器也可能选择忽略——行为不统一。
2. 服务端在这里只负责把 stanza 路由给其他实体；如果服务端本身就是目标接收方，则可能需要理解和处理这个扩展。
3. “原封不动”表示扩展内容的语义和 XML 结构应被保留，不保证传输前后的 XML 字节完全相同，例如 namespace 前缀可能发生变化。
4. 最终接收方不认识扩展时（RFC6120 §8.4 处理规则）：
   - `message` 且未知扩展是**唯一子元素**：MUST 二选一——忽略整条消息，或返回错误（SHOULD 为 `service-unavailable`）；
   - `message`/`presence` 含未知部分：MUST 忽略该部分；
   - `presence` 且未知扩展是唯一子元素：MUST 忽略该子元素；
   - `iq get/set`：**MUST 返回 `service-unavailable`**（§10.3.3）。

## 总结

- `Protocol`：规定 XML 怎么发送、寻址、路由、解释和响应。
- `Messaging`：提供通用的消息传递能力。
- `Presence`：提供实体状态的发布、订阅和传递能力。
- `Extensible`：允许通信双方通过 `xmlns` 定义扩展协议；路由服务端不需要理解扩展的业务含义，也能把它交给能够理解的接收方。


# XMPP-C2S JID 寻址（RFC6120 / RFC7622）

> 
> JID 是XMPP实体的地址，所有 `<message>`、`<iq>`、`<presence>` 报文依靠JID完成寻址与路由。

## JID 完整语法结构

```
localpart@domainpart/resourcepart
```

示例：`alice@demo.com/mobile`

- `localpart`：本地部分，账号场景下通常为用户名，也可标识聊天室、网关等本地域实体（RFC7622），`alice`
- `domainpart`：域名部分，XMPP服务域名，`demo.com`
- `resourcepart`：资源部分，RFC7622 §3.4 定义为**不透明标识符**（opaque identifier，可标识连接、设备、位置、MUC 昵称等；C2S 聊天场景通常就是设备后缀），`mobile`，**可选字段，可以省略**

> 
> 分隔符说明：
> 
> 
> - `@`：分割 localpart 与 domainpart
> - `/`：分割 domainpart 与 resourcepart

## JID 的形态（RFC7622 §3.1 语法：`[ localpart "@" ] domainpart [ "/" resourcepart ]`）

RFC6120 §1.4 按语义分**两类**，每类各含两种语法形态：

1. **bare-JID 裸JID（无 resourcepart）**
- `localpart@domainpart`：代表**账号本体**（RFC7622：account 本身，与在线与否无关）；发给裸JID的 stanza 由服务端按投递规则决定投给哪些在线资源（见下文，非正式的"全部在线设备集合"说法只是常见理解）。
- `domainpart`（如 `demo.com`）：**也是裸JID**（RFC6120 §1.4 原文：of the form \<domainpart\> for a server）——表示服务器/服务组件；客户端常用：服务发现、ping、注册等服务器级 iq 都以它寻址。
2. **full-JID 完整JID（带 resourcepart）**
- `localpart@domainpart/resourcepart`：精确定位账号下**某一个具体资源**（resourcepart 是 opaque identifier，RFC7622 §3.4；C2S 场景通常对应一台设备/一条连接）。
- `domainpart/resourcepart`（如 `demo.com/shakespeare`）：**也是完整JID**（RFC6120 §1.4 原文：for a particular resource or script associated with a server）——服务端资源/脚本标识，C2S 聊天场景罕见。

## 报文路由投递规则

1. `to` 设置为 **bare-JID（裸JID）**
例：`to="bob@demo.com"`
服务端收到后投递给账号的在线资源，协议允许两种策略（RFC6121 §8.5.2.1.1）：投给"最活跃"资源（most available：由服务端**实现自定义算法**选定，最高优先级只是常见因素之一），或投给全部非负优先级资源；且各消息类型规则不同：`normal` 投非负资源、`chat` 在多资源时二选一：(a) 投给"最活跃"资源（**无需 opt-in**）或 (b) 投给**明确 opt-in 接收全部 chat** 的非负资源集合（原文 "opted in to receive chat messages"）；单一非负资源则 MUST 投给它、`headline` 必须投全部非负资源、`groupchat` 不投给任何资源、MUST 返回错误（SHOULD 为 `service-unavailable`）；负优先级一律排除。
注意：`iq` 发裸JID不广播、也不投给任何资源，由服务端代表账号直接应答（RFC6121 §8.5.2.1.3：server itself MUST reply、MUST NOT deliver to any resource；无法应答则 `service-unavailable`，§8.5.2.2.3）。
普通一对一聊天消息，通常使用裸JID作为接收地址。
2. `to` 设置为 **full-JID（完整JID）**
例：`to="bob@demo.com/pc"`
投递给该 resource 对应的具体资源/会话；多资源在线时 `chat` 按 RFC6121 §8.5.4 为 **D/A***：必须投给目标资源，服务器也可（经客户端 opt-in）额外投给其他非负资源（Message Carbons 等扩展同样产生副本）——"其他资源绝不收到"不成立。若该 resource 不在线，按「XMPP 路由寻址」的规则处理。

## stanza 的 from、to 属性

所有三类stanza（message、iq、presence）都拥有 `to`、`from` 属性：

- `to`：接收方实体JID
- `from`：发送方实体JID

> 
> 实践规则：**客户端向外发送报文时通常不填 from 属性**（客户端省略是正确实践，不是强制义务；该条款的强制对象是服务端，见下）。
> XMPP服务端会强制重写、覆盖from字段（RFC6120 §8.1.2.1：MUST add or override），替换成客户端当前真实的 full-JID；订阅类 presence 例外，服务端盖的是 bare JID。客户端填入的from内容会被直接覆盖，用于防止身份伪造。

示例标准聊天message报文

```
<message to="bob@demo.com" from="alice@demo.com/a92j" type="chat">
  <body>hello</body>
</message>
```

- `to="bob@demo.com"`：裸JID，发给bob账号（投递策略按消息类型二选一，见上文）
- `from="alice@demo.com/a92j"`：服务端填充的我方完整JID

## JID 使用场景对照表

| JID类型 | 示例 | 典型使用场景 |
| --- | --- | --- |
| bare-JID | `bob@demo.com` | roster好友列表存储、发起加好友请求、普通聊天消息 |
| full-JID | `bob@demo.com/pc` | 精确发送给对方某一具体资源（如某台设备）、识别多端登录、解析对方上下线presence报文来源 |

## JID 协议坑点

1. resourcepart **区分大小写**；`pc` 与 `PC` 是两个完全不同的资源。
2. 如果同一个账号，使用**完全相同的resourcepart**建立新连接，RFC6120 §7.7.2.2 允许三种处理：①服务端给新连接改写一个不同的resource（**RFC推荐**）；②拒绝新连接、保留旧会话；③踢掉旧会话让新连接顶替（早期服务器传统行为，RFC标注为**不建议**——两台设备可能互踢死循环）。RFC 记载③曾是"早期服务器的传统行为"（§7.7.2.2 原文：traditional behavior of early XMPP server implementations）；当前各服务端策略不一（未逐一核实），"踢旧"是常见经验说法而非协议推荐。
3. roster（好友花名册）按 bare-JID 维护条目：RFC6121 的 roster 语义、示例与订阅状态全部以 bare JID 记账，resource 不入册（协议未以 MUST 条文显式限定，属语义约定而非硬性条款）。注意：resourcepart 是 opaque identifier，字符串本身可稳定、可复用；"动态"的是它绑定的会话，不是标识符本身。
4. 收到好友上下线presence推送报文时，报文的`from`是对方的full-JID，可以用来区分对方哪一个资源/客户端实例上线/下线。
5. localpart、domainpart、resourcepart都有字符集、长度限制，RFC规定不可以随意填充特殊字符。


# XMPP 路由寻址

## 一、路由寻址逻辑

服务端收到 stanza，解析目标地址，依据 `domain` 做路由分流：
1. 目标属于本机域名 → 进入C2S本地路由处理
2. 目标属于外部域名 → 进入S2S远端路由转发

### C2S本地路由内部处理规则

1. 如果报文目标指向**具体资源会话**
    - **账号不存在**（RFC6121 §8.5.1，优先判断）：message（`type="error"` 的 MUST 静默忽略——回错会形成错误循环，RFC6120 §8.3.1 规则8）→ 其余类型：静默忽略或返回 `service-unavailable`，**不能离线存储**（§8.5.4 表1 "ACCOUNT DOES NOT EXIST / full" 各类型均为 S/E）；iq → MUST `service-unavailable`；presence 无 type/`unavailable` 及订阅四类 → MUST 静默忽略；**presence `probe` → 二选一：静默忽略，或返回 `type="unsubscribed"`**（§8.5.1 原文）。
    - 账号存在、资源会话在线（§8.5.3.1 按类型）：
        - `message`：MUST 投递到该精确资源（§8.5.4 full match 基本为 D）；`chat` 为 **D/A***——服务器可经客户端 opt-in 额外投给其他非负资源。
        - iq `result`/`error`：MUST 投递；iq `get`/`set`：请求者与目标**未共享 presence**（无 both/from 订阅、无 directed presence）时，服务器 SHOULD NOT 投递、SHOULD 返回 `service-unavailable`（§8.5.3.1，防止在线状态泄露）。
        - presence 无 type/`unavailable`：MUST 投递；订阅四类按 §3；`probe` 按 §4.3。
    - 账号存在、资源会话不存在（§8.5.3.2 具体规则优先；RFC6120 §10.5.4 的"按裸JID处理"只是一般性 SHOULD）：
        - `type="chat"`：唯一非负资源在线 → MUST 投给它；多个非负资源 → 按"最可用资源或 opted-in 资源集合"投递（同裸JID chat 规则）；**没有 available 或 connected 资源** → MUST 离线存储或返回 `service-unavailable`（§8.5.4 "ACCOUNT EXISTS, BUT NO ACTIVE RESOURCES / full" 的 chat 为 O/E）；**有 available 资源但全部为负优先级** → SHOULD 离线存储或返回错误（SHOULD 为 `service-unavailable`，§8.5.3.2.1）。
        - `normal` / `groupchat` / `headline`：MUST 静默忽略或返回 `service-unavailable`（**不转投其他设备**）。
        - `type="error"` 的 message：MUST 静默忽略（§8.5.3.2.1 末条，防错误循环）。
        - presence：无 type/`unavailable` → MUST 静默忽略；`subscribe` → 按 §3.1.3 处理；`subscribed`/`unsubscribe`/`unsubscribed` → MUST 忽略；`probe` → 按 §4.3（§8.5.3.2.2）。
        - `iq`：MUST 返回 `service-unavailable`。

2. 如果报文目标指向**用户账号本身，不指定设备**
    - **至少存在一个 available 或 connected resource**（负优先级资源也是 available resource，§8.5.2.1）：
        - message：按投递策略二选一（§8.5.2.1.1，规则随消息类型不同）；**负优先级资源一律不收 message**（原文 "the server MUST NOT deliver the stanza to any available resource with a negative priority"，仅限 message）——若全部资源均为负优先级，`normal`/`chat` SHOULD 离线存储或返回 `service-unavailable`。
        - presence 无 type/`unavailable`：MUST 投给**全部 available 资源（含负优先级资源）**（§8.5.2.1.2）；订阅四类按 §3、`probe` 按 §4.3。
        - iq：服务端代表账号处理（§8.5.2.1.3）。
    - **没有任何 available 或 connected resource**（§8.5.2.2）：`normal`/`chat` → SHOULD 离线存储或返回 `service-unavailable`；`groupchat` → MUST 返回错误；`headline`/`error` → MUST 静默忽略；`iq` → 服务端代表账号应答，无法应答则 `service-unavailable`（§8.5.2.2.3）；presence 无 type/`unavailable` → SHOULD 静默忽略（§8.5.2.2.2），订阅四类按 §3、`probe` 按 §4.3。
    - 离线投递对象：按 XEP-0160 §2 的**推荐流程（RECOMMENDED，Informational 文档）**：触发条件是资源向服务器发送**非负优先级的 available presence**（原文：When the recipient next sends non-negative available presence to the server, the server delivers the message to the resource that has sent that presence）——即最先发送非负优先级 available presence 的资源接收离线消息、后续资源收不到；**具体服务器可以采用其他策略**（RFC6121 本身不规定投给哪个资源；多设备同步历史消息需 MAM）。注意不限于 initial presence：资源先发负优先级 presence 不会立即触发，之后更新为非负优先级的 subsequent presence 也可以触发。
    - （因果推测，非规范内容：服务端没有固定设备清单、离线投递只求至少送达一次——可解释"只给第一台"，但属推理。）

## 二、S2S远端路由处理

本机只完成报文跨域转发（**仅当目标是远端用户/资源时**——目标是远端域 JID、组件或服务器级 iq 时，接收服务器本身就是处理方，不是转发者）；投递、存储由对方服务器执行。错误生成分两种（RFC6120 §10.4.3）：DNS 解析失败 / S2S 流无法建立 → **本机自己**生成 `remote-server-not-found` / `remote-server-timeout` 返还给发送者；远端已收到但无法投递 → 才由对方服务器生成错误并沿原路返回：
1. 目标为具体资源会话：远端**先判断账号是否存在**，再完全按上文 C2S 本地 full-JID 规则处理——不能仅凭 resource 不匹配就推导为离线存储（账号不存在时只能静默忽略或报错）。
2. 目标为用户账号：远端同样**先判断账号是否存在**，再按上文 C2S 本地裸JID 规则处理（账号存在且无可用资源时 `chat`/`normal` 才可能离线存储）。

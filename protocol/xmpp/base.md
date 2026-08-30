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

1. 扩展内容必须放在合法的 `<message/>`、`<presence/>` 或 `<iq/>` stanza 内。顶层一级元素只有三类 stanza（RFC6120 §4.1 定义：depth=1、限定 jabber:client/server 命名空间）和各协商协议定义的元素；自造的未知顶层元素无应用语义；协议为其定义了专门的流错误条件 `unsupported-stanza-type`（RFC6120 §4.9.3.24：不支持的一级流子元素），服务器也可能选择忽略——行为不统一。
2. 服务端在这里只负责把 stanza 路由给其他实体；如果服务端本身就是目标接收方，则可能需要理解和处理这个扩展。
3. “原封不动”表示扩展内容的语义和 XML 结构应被保留，不保证传输前后的 XML 字节完全相同，例如 namespace 前缀可能发生变化。
4. 最终接收方不认识扩展时（RFC6120 §8.4 处理规则）：
   - `message` 且未知扩展是**唯一子元素**：MUST 二选一——忽略整条消息，或返回错误（SHOULD 为 `service-unavailable`）；
   - `message`/`presence` 含未知部分：MUST 忽略该部分；
   - `presence` 且未知扩展是唯一子元素：MUST 忽略该子元素；
   - `iq get/set`：**MUST 返回 `service-unavailable`**（RFC6120 §10.3.3）。

## 总结

- `Protocol`：规定 XML 怎么发送、寻址、路由、解释和响应。
- `Messaging`：提供通用的消息传递能力。
- `Presence`：提供实体状态的发布、订阅和传递能力。
- `Extensible`：允许通信双方通过 `xmlns` 定义扩展协议；路由服务端不需要理解扩展的业务含义，也能把它交给能够理解的接收方。


# XMPP-C2S JID 寻址（RFC6120 / RFC7622）

> 
> JID 是 XMPP 实体的地址，所有 `<message>`、`<iq>`、`<presence>` 报文依靠 JID 完成寻址与路由。

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
> - `@`：分割 localpart 与 domainpart
> - `/`：分割 domainpart 与 resourcepart

## JID 的形态（RFC7622 §3.1 语法：`[ localpart "@" ] domainpart [ "/" resourcepart ]`）

RFC6120 §1.4 按语义分**两类**，每类各含两种语法形态：

1. **bare-JID 裸JID（无 resourcepart）**
- `localpart@domainpart`：代表**账号本体**；发给裸 JID 的 stanza 由服务端按投递规则决定投给哪些在线资源（见下文，非正式的"全部在线设备集合"说法只是常见理解）。
- `domainpart`（如 `demo.com`）：**也是裸 JID**）——表示服务器/服务组件；客户端常用：服务发现、ping、注册等服务器级 iq 都以它寻址。
2. **full-JID 完整 JID（带 resourcepart）**
- `localpart@domainpart/resourcepart`：精确定位账号下**某一个具体资源**（resourcepart 是 opaque identifier，RFC7622 §3.4；C2S 场景通常对应一台设备/一条连接）。
- `domainpart/resourcepart`（如 `demo.com/shakespeare`）：**也是完整 JID**——服务端资源/脚本标识，C2S 聊天场景罕见。

## 报文路由投递规则

1. `to` 设置为 **bare-JID（裸JID）**

例：`to="bob@demo.com"`

服务端按 stanza 类型路由；负优先级资源始终不参与投递：

`most available resource(s)` 是 RFC6121 的投递术语，指服务端从非负优先级资源中，按自身实现的算法选出的一个或多个首选资源：

- RFC6121 不规定统一的选择算法。
- 服务端可以把最高 `<priority/>` 的一个或多个资源视为 most available，但这只是 RFC 给出的实现示例。
- 它不等于“最近活跃的设备”，也不保证只选一个资源。

各 stanza 类型的处理规则：

- `normal`：在非负优先级资源中投递。
- `chat`：仅有一个非负优先级资源时 MUST 投给该资源；存在多个时，服务端必须二选一：投给它判定的一个或多个 most available resource（这些资源无需 opt-in），或投给已明确 opt-in 接收全部 `chat` 的非负优先级资源集合。
- `headline`：MUST 投给全部非负优先级资源。
- `groupchat`：这里限制的是 `to="bob@demo.com"` 这种**普通用户 bare JID**，不是禁止群聊消息投递。
  - 合法的 MUC 群聊消息应发给房间 bare JID，例如 `room@conference.demo.com`；MUC 服务再把消息广播给房间成员对应的 full JID。
  - 普通用户 bare JID 不是群聊房间，账号服务器不能把 `groupchat` 当成 `normal` / `chat`，再自行选择某个用户资源投递。因此 MUST NOT 投给该账号的任何资源，并 MUST 返回错误（SHOULD 为 `service-unavailable`）。
- `iq`：不广播，也不投给账号的任何资源；服务端 MUST 直接应答，无法处理时返回 `service-unavailable`。

参见 RFC6121 §8.5.2.1.1、RFC6121 §8.5.2.1.3、RFC6121 §8.5.2.2.3。

普通一对一聊天消息，通常使用裸 JID 作为接收地址。

2. `to` 设置为 **full-JID（完整JID）**

例：`to="bob@demo.com/pc"`

消息定向投递给该 resource。对于 `chat`，服务端 MUST 投给目标资源；经客户端 opt-in，也可向其他非负优先级资源发送副本，Message Carbons 等扩展同样可能产生副本。因此，full JID 不保证“其他资源绝不会收到”。目标 resource 不在线时，按「XMPP 路由寻址」规则处理（RFC6121 §8.5.4）。

## stanza 的 from、to 属性

所有三类stanza（message、iq、presence）都拥有 `to`、`from` 属性：

- `to`：接收方实体JID
- `from`：发送方实体JID

> 
> 实践规则：**客户端向外发送报文时通常不填 from 属性**。
> XMPP 服务端会强制重写、覆盖 from 字段（RFC6120 §8.1.2.1：MUST add or override），替换成客户端当前真实的 full-JID；订阅类 presence 例外，服务端盖的是 bare JID。客户端填入的 from 内容会被直接覆盖，用于防止身份伪造。

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

1. resourcepart **区分大小写**：`pc` 与 `PC` 是两个不同资源。
2. 相同 resourcepart 发生连接冲突时，服务端可以：
   - 为新连接分配其他 resource（RFC 推荐）；
   - 拒绝新连接；
   - 断开旧连接，由新连接接管（早期惯例，RFC 不推荐）。

   具体策略取决于服务端实现，不能默认一定“踢旧”（RFC6120 §7.7.2.2）。
3. roster 按 bare JID 维护，resource 不入册。resourcepart 可以稳定复用，变化的是它绑定的会话，而非标识符本身。
4. presence 的 `from` 是 full JID，可用于区分具体资源的上线和下线。
5. localpart、domainpart、resourcepart 均受字符集和长度规则约束，不能任意填入特殊字符。


# XMPP 路由寻址

## 一、路由寻址逻辑

服务端收到 stanza，解析目标地址，依据 `domain` 做路由分流：
1. 目标属于本机域名 → 进入C2S本地路由处理
2. 目标属于外部域名 → 进入S2S远端路由转发

### C2S本地路由内部处理规则

订阅类 `presence` 不是普通的在线状态广播，而是账号级 roster 状态变更：

- `subscribe`（请求订阅）：full JID 目标 SHOULD 先改成 bare JID。除预授权、账号自动批准或服务协议允许外，服务端 MUST NOT 代替用户自动批准。若请求者已经拥有订阅，服务端 MUST 直接回复 `subscribed`；若命中预授权，则 SHOULD 直接回复。否则，有 available resource 时 MUST 把请求投给全部 available resource；没有时 MUST 保存完整请求，并在资源每次变为 available 时继续投递，直到用户批准或拒绝。同一请求者的重复申请下次最多投递一条，且批准前不得把请求者加入 roster（RFC6121 §3.1.3）。
- `subscribed`（批准订阅）：仅当 roster 中存在待批准的出站订阅时才生效。服务端 MUST 先把通知投给全部 interested resource，再把 roster 状态更新为 `to` 或 `both` 并推送，随后把联系人各在线资源的当前 presence 投给用户的 available resource；状态不匹配时 MUST 静默忽略（RFC6121 §3.1.6）。
- `unsubscribed`（拒绝或取消已授予的订阅）：仅当当前状态为 `to` 或 `both` 时生效。服务端 MUST 把通知投给全部 interested resource，将 roster 更新为 `none` 或 `from`，并投递相应的 `unavailable`；状态不匹配时 MUST 静默忽略（RFC6121 §3.2.3）。
- `unsubscribe`（主动取消对联系人的订阅）：仅当对端 roster 状态为 `from` 或 `both` 时生效。服务端 MUST 把通知投给全部 interested resource，将 roster 更新为 `none` 或 `to`，并从所有 available resource 向请求者发送 `unavailable`；状态不匹配时通常 MUST 静默忽略。若只存在未入 roster 的待处理订阅请求，则删除该请求记录（RFC6121 §3.3.3）。

`probe` 用于查询当前 presence，服务端按目标和订阅权限应答：

- 目标为 bare JID：账号不存在或请求者无权查看时，服务端 SHOULD 返回 bare JID 发出的 `unsubscribed`；账号已迁移时 SHOULD 返回 `redirect` 或 `gone`；无 available resource 时 SHOULD 返回 bare JID 发出的 `unavailable`；存在 available resource 时 MUST 返回每个资源最近一次无 `to` 的完整 presence，`from` 为各自 full JID（RFC6121 §4.3.2）。
- 目标为 full JID：不得返回其他 resource 的 presence。账号存在、目标 resource 匹配且请求者有权限时，MUST 返回该资源的 available presence，并 SHOULD 只暴露“在线”这一事实；目标 resource 不匹配时不得转查或返回其他资源（RFC6121 §4.3.2）。

1. 如果报文目标指向 **具体资源会话**

   **账号不存在**（RFC6121 §8.5.1，优先判断）

   - `message`：
     - `type="error"`：MUST 静默忽略。回错会形成错误循环（RFC6120 §8.3.1 规则8）。
     - 其他类型：静默忽略或返回 `service-unavailable`，**不能离线存储**（RFC6121 §8.5.4 表1中 `ACCOUNT DOES NOT EXIST / full` 均为 S/E）。
   - `iq`：MUST 返回 `service-unavailable`。
   - `presence`：
     - 无 type、`unavailable` 及订阅四类：MUST 静默忽略。
     - `probe`：静默忽略，或返回 `type="unsubscribed"`。

   **账号存在，目标资源在线**（RFC6121 §8.5.3.1）

   - `message`：MUST 投递到该精确资源。`chat` 在 RFC6121 §8.5.4 表中为 D/A*：必须投给目标资源；经客户端 opt-in，也可额外投给其他非负优先级资源。
   - `iq result/error`：MUST 投递。
   - `iq get/set`：请求者与目标未共享 presence（无 both/from 订阅、无 directed presence）时，服务端 SHOULD NOT 投递，并 SHOULD 返回 `service-unavailable`，以免泄露在线状态。
   - `presence`：
     - 无 type、`unavailable`：MUST 投递。
     - `subscribe`、`subscribed`、`unsubscribe`、`unsubscribed`：不按目标 resource 单独投递；服务端校验当前订阅状态，更新账号级 roster，并把有效通知和 roster push 发给全部 interested resource。
     - `probe`：只允许返回目标 resource 的状态，不得泄露其他 resource。

   **账号存在，目标资源离线**（RFC6121 §8.5.3.2）

   - `chat`：
     - 唯一非负优先级资源在线：MUST 投给该资源。
     - 多个非负优先级资源在线：服务端必须二选一：投给按自身算法选出的一个或多个 most available resource，或投给已 opt-in 接收全部 `chat` 的非负优先级资源集合；与裸 JID 的 `chat` 规则相同。
     - 没有 available 或 connected resource：MUST 离线存储或返回 `service-unavailable`（RFC6121 §8.5.4 表1中 `ACCOUNT EXISTS, BUT NO ACTIVE RESOURCES / full` 的 `chat` 为 O/E）。
     - 存在 available resource，但优先级全部为负：SHOULD 离线存储或返回错误；错误 SHOULD 为 `service-unavailable`（RFC6121 §8.5.3.2.1）。
   - `normal`、`groupchat`、`headline`：MUST 静默忽略或返回 `service-unavailable`，**不转投其他设备**。
   - `message type="error"`：MUST 静默忽略，避免形成错误循环（RFC6121 §8.5.3.2.1）。
   - `presence`：
     - 无 type、`unavailable`：MUST 静默忽略。
     - `subscribe`：忽略离线的 resourcepart，按 bare JID 的账号级订阅请求处理；没有 available resource 时保存完整请求，等资源变为 available 后投递，直到用户批准或拒绝。
     - `subscribed`、`unsubscribe`、`unsubscribed`：MUST 忽略。
     - `probe`：不得转查或返回其他 resource；仍需先执行账号不存在、无查看权限和账号迁移的响应规则（RFC6121 §4.3.2、RFC6121 §8.5.3.2.2）。
   - `iq`：MUST 返回 `service-unavailable`。

   RFC6121 §8.5.3.2 的具体规则优先；RFC6120 §10.5.4“按裸 JID 处理”只是一般性 SHOULD。

2. 如果报文目标指向**用户账号本身，不指定设备**

   **至少存在一个 available 或 connected resource**（负优先级资源也是 available resource，RFC6121 §8.5.2.1）

   - `message`：
     - 按投递策略二选一，规则随消息类型不同（RFC6121 §8.5.2.1.1）。
     - **负优先级资源一律不收 message**。原文："the server MUST NOT deliver the stanza to any available resource with a negative priority"。该规则仅限 `message`。
     - 若全部资源均为负优先级，`normal` / `chat` SHOULD 离线存储或返回 `service-unavailable`。
   - `presence`：
     - 无 type、`unavailable`：MUST 投给**全部 available 资源，包括负优先级资源**（RFC6121 §8.5.2.1.2）。
     - `subscribe`、`subscribed`、`unsubscribe`、`unsubscribed`：服务端校验当前订阅状态，更新账号级 roster，并把有效通知和 roster push 发给全部 interested resource；它们不按 message 的资源优先级策略投递。
     - `probe`：有查看权限时 MUST 返回每个 available resource 最近一次无 `to` 的完整 presence；无权限时 SHOULD 返回 `unsubscribed`（RFC6121 §4.3.2）。
   - `iq`：服务端代表账号处理（RFC6121 §8.5.2.1.3）。

   **没有任何 available 或 connected resource**（RFC6121 §8.5.2.2）

   - `normal` / `chat`：SHOULD 离线存储或返回 `service-unavailable`。
   - `groupchat`：MUST 返回错误。
   - `headline` / `error`：MUST 静默忽略。
   - `iq`：服务端代表账号应答；无法应答时返回 `service-unavailable`（RFC6121 §8.5.2.2.3）。
   - `presence`：
     - 无 type、`unavailable`：SHOULD 静默忽略（RFC6121 §8.5.2.2.2）。
     - `subscribe`：保存完整请求；资源变为 available 后继续投递，直到用户批准或拒绝。
     - `subscribed`、`unsubscribe`、`unsubscribed`：服务端先校验 roster 的当前订阅状态；状态有效时更新 roster 并推送给 interested resource，没有 available resource 时 MAY 保存通知供下次上线时投递；状态不满足各自前置条件时 MUST 静默忽略。
     - `probe`：请求者有查看权限时 SHOULD 返回 bare JID 发出的 `unavailable`；无权限时 SHOULD 返回 bare JID 发出的 `unsubscribed`（RFC6121 §4.3.2）。

   **离线消息投给哪个资源**

   XEP-0160 §2 给出的流程是 RECOMMENDED，且该文档为 Informational：

   - 资源向服务端发送**非负优先级的 available presence**时，触发离线消息投递。
   - 原文："When the recipient next sends non-negative available presence to the server, the server delivers the message to the resource that has sent that presence"。
   - 最先发送该 presence 的资源收到离线消息，后续资源收不到。
   - 具体服务端可以采用其他策略。RFC6121 不规定必须投给哪个资源；多设备同步历史消息需要 MAM。
   - 触发条件不限于 initial presence：先发送负优先级 presence 不会触发；之后更新为非负优先级的 subsequent presence 仍可触发。

## 二、S2S远端路由处理

### S2S 的职责边界

- 目标是远端用户或资源：本机只负责跨域转发，实际投递和存储由对方服务器完成。
- 目标是远端域 JID、组件或服务器级 `iq`：接收服务器本身就是处理方，不再向用户或资源转发。

### 错误由谁生成

RFC6120 §10.4.3 区分两种情况：

- DNS 解析失败或 S2S 流无法建立：**本机生成** `remote-server-not-found` 或 `remote-server-timeout`，返回给发送者。
- 远端服务器已经收到 stanza，但无法完成投递：**远端服务器生成**错误，并沿原路返回。

### 远端收到后的投递

1. 目标为具体资源会话：远端必须**先判断账号是否存在**，再按 C2S 本地 full-JID 规则处理。不能只因 resource 不匹配就判定为离线存储；账号不存在时只能静默忽略或返回错误。
2. 目标为用户账号：远端同样必须**先判断账号是否存在**，再按 C2S 本地 bare-JID 规则处理。只有账号存在且没有可用资源时，`chat` / `normal` 才可能进入离线存储。

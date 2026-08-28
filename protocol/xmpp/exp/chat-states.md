# XEP-0085 聊天状态通知

> 官方规范：<https://xmpp.org/extensions/xep-0085.html>（当前状态：Final 2.1）
>
> `XEP-0085` 用于通知聊天对象：当前用户正在关注会话、正在输入、暂停输入、暂时不活跃，还是已经不再参与这次会话。

本文保留规范中的强度词：

- `MUST` / `MUST NOT`：必须 / 禁止；
- `SHOULD` / `SHOULD NOT`：原则上应该 / 不应该，只有充分理由时才偏离；
- `MAY`：允许，实现可以选择是否支持。

## 一、它描述的不是账号在线状态

XEP-0085 描述的是用户相对于**某个具体聊天会话**的参与状态，可以理解为 chat-specific presence。

它和普通 `<presence/>` 的语义不同：

- `<presence/>`：描述账号或设备是否在线、离开、忙碌；
- XEP-0085：描述用户是否正在关注、输入或继续参与某个聊天会话。

因此：

- `<inactive/>` 不表示账号离线；
- `<gone/>` 也不等于 XMPP 连接已经断开；
- 用户可以保持在线，但对某个聊天会话已经是 `inactive` 或 `gone`；
- 聊天状态由客户端生成，服务端不得代替客户端生成。

聊天状态扩展只能放在 `<message/>` stanza 中，命名空间固定为：

```text
http://jabber.org/protocol/chatstates
```

## 二、五种聊天状态

| 状态 | 准确语义 | 规范给出的建议触发条件 |
| --- | --- | --- |
| `<active/>` | 用户正在积极参与该聊天会话 | 接受初始正文消息、发送正文消息、重新聚焦聊天界面，或正在关注会话 |
| `<composing/>` | 用户正在编写消息 | 正在操作该会话的消息输入界面，例如输入文字 |
| `<paused/>` | 用户此前正在编写消息，但暂时停止 | 停止操作消息输入界面一小段时间，例如 30 秒 |
| `<inactive/>` | 用户暂时没有积极参与该聊天会话 | 一段中等时间没有操作聊天会话界面，例如 2 分钟 |
| `<gone/>` | 用户实际上已经结束对该聊天会话的参与 | 较长时间没有操作聊天界面、系统或设备，例如 10 分钟；或者明确终止会话 |

这里有两个不同层次：

```text
会话界面状态：ACTIVE / INACTIVE / GONE
输入界面状态：COMPOSING / PAUSED
```

`COMPOSING` 和 `PAUSED` 描述输入框行为，可以看作 `ACTIVE` 范围内更具体的状态；`ACTIVE`、`INACTIVE`、`GONE` 描述用户对整个聊天会话的参与程度。

## 三、规范中的常见状态迁移

XEP-0085 官方状态图表达的常见迁移可以整理为：

```text
START -> ACTIVE

INACTIVE <-> ACTIVE <-> COMPOSING <-> PAUSED
    ^                                      |
    +--------------------------------------+

ACTIVE / INACTIVE / COMPOSING / PAUSED -> GONE
```

其中底部单向箭头是：

```text
PAUSED -> INACTIVE
```

常见事件对应关系：

| 当前状态 | 事件 | 下一个状态 |
| --- | --- | --- |
| `START` | 打开、聚焦或开始参与聊天 | `ACTIVE` |
| `INACTIVE` | 重新聚焦、关注、回复会话 | `ACTIVE` |
| `ACTIVE` | 一段时间没有操作聊天界面 | `INACTIVE` |
| `ACTIVE` | 开始操作消息输入框 | `COMPOSING` |
| `COMPOSING` | 发送正文消息 | `ACTIVE` |
| `COMPOSING` | 短时间停止操作输入框 | `PAUSED` |
| `PAUSED` | 恢复操作输入框 | `COMPOSING` |
| `PAUSED` | 继续没有操作整个聊天界面 | `INACTIVE` |
| 任一未结束状态 | 明确终止会话或达到长时间无活动条件 | `GONE` |

规范只是在状态图中列出最常见的迁移，并不禁止实现需要的其他迁移。例如：

- `PAUSED -> ACTIVE`：暂停输入后直接发送正文消息；
- `INACTIVE -> PAUSED`：用户返回一个仍保留未完成内容的输入界面，但尚未继续输入。

## 四、30 秒、2 分钟、10 分钟怎么理解

这些时间都是规范给出的**示例值**，不是 MUST，也不是固定协议参数。客户端可以自行决定触发条件和时间。

三种计时关注的活动范围不同：

| 状态 | 观察的活动范围 |
| --- | --- |
| `PAUSED` | 是否继续操作当前会话的消息输入界面 |
| `INACTIVE` | 是否继续操作当前聊天会话界面 |
| `GONE` | 是否继续操作聊天界面、系统或设备，以及是否已明确终止会话 |

如果实现采用规范中的示例时间，典型时间线是：

```text
t = 0        最后一次输入，同时也是最后一次聊天界面交互
t = 30 秒    没有继续操作输入框：COMPOSING -> PAUSED
t = 2 分钟   没有操作聊天界面：PAUSED -> INACTIVE
t = 10 分钟  长时间没有相关活动：INACTIVE -> GONE
```

"从最后一次相关活动开始累计约 10 分钟"是合理的实现解释，不是规范明文规定的计时算法——官方只给出建议触发值，并明确由实现决定。按这种理解，它**不是进入 `INACTIVE` 后再额外等待 10 分钟**。

若要区分这些活动来源，就不能只依赖一个不区分来源的计时器——不过计时与触发本身完全由实现决定，这并非官方规则。例如用户虽然没有操作当前聊天窗口，却一直在操作设备上的其他界面：

- 当前聊天可以进入 `INACTIVE`；
- 是否进一步自动进入 `GONE`，要根据客户端对“已结束参与”的判断和自己的实现策略决定。

### `GONE` 到底表示什么

`GONE` 表示：

> 从这次聊天会话的角度，发送方客户端判断用户实际上已经不再参与。

它不是对下列事实的确认：

- 用户已经离线；
- XMPP 连接已经断开；
- 用户已经退出账号；
- 用户物理上已经离开设备。

接收方还必须考虑异常情况：对方客户端可能崩溃或断网，导致最后一个状态永远停留在 `active`、`composing` 等状态。因此不能把收到的最后一个聊天状态当成永久真实状态。

协议层面也没有持久化保证：服务器或 MUC 服务可以拒绝转发 standalone 状态通知，并且 **SHOULD NOT** 为离线用户存储它们。因此聊天状态必须按**短时、会过期**的提示处理，不能当成持久事实。

## 五、发送前应发现、协商或进行隐式协商

客户端不能仅因为自己支持 XEP-0085，就无条件向所有联系人发送聊天状态。

声明支持 XEP-0085 的实体，必须在 Service Discovery（XEP-0030）的 `disco#info` 响应中发布以下 feature。客户端在可能的情况下应该优先通过 XEP-0115 Entity Capabilities 动态获得该能力；没有 capabilities 信息时，再显式查询 `disco#info`。

```xml
<feature var="http://jabber.org/protocol/chatstates"/>
```

也可以显式协商是否使用聊天状态通知。

如果没有显式发现或协商，一对一聊天可以使用隐式协商：

1. 在收到对方回复以前，己方想使用聊天状态时，发出的消息必须携带聊天状态扩展，建议携带 `<active/>`。
2. 如果对方作出回复，但回复中没有携带任何聊天状态扩展，己方之后不得继续向对方发送聊天状态通知。
3. 如果对方回复中携带 `<active/>`，或者对方发来 standalone 聊天状态，双方之后应发送各自支持的聊天状态。

该隐式协商被设计为双向使用：一对一聊天双方应当要么都发送，要么都不发送，而不是长期单向发送。

## 六、支持级别

一个客户端声明支持 XEP-0085 后，各状态的支持要求如下：

| 状态 | 要求 |
| --- | --- |
| `<active/>` | MUST |
| `<composing/>` | MUST |
| `<paused/>` | SHOULD |
| `<inactive/>` | SHOULD |
| `<gone/>` | SHOULD |

客户端还必须允许用户配置是否发送聊天状态通知，因为这些状态可能泄露用户是否正在使用设备、是否正在查看会话等隐私信息。

## 七、两种报文形式

### 1. 正文消息携带状态

发送正文消息时，通常携带 `<active/>`：

```xml
<message to="bob@example.com" type="chat">
  <body>你好</body>
  <active xmlns="http://jabber.org/protocol/chatstates"/>
</message>
```

包含 `<body/>` 等标准消息内容的 stanza，SHOULD NOT 携带 `<active/>` 以外的聊天状态。

### 2. Standalone 状态通知

只通知状态、不发送正文：

```xml
<message to="bob@example.com" type="chat">
  <composing xmlns="http://jabber.org/protocol/chatstates"/>
</message>
```

Standalone 状态通知：

- 不包含 `<body/>` 等标准消息内容；
- 除可选的 `<thread/>` 外，只包含一个聊天状态元素；
- 通常使用 `active` 以外的状态；
- 同一个 stanza 最多只能包含一个 XEP-0085 状态元素。

### 禁止连续重复同一 standalone 状态

客户端不得连续发送相同的 standalone 状态：

```text
composing -> composing -> composing    错误
composing -> paused -> composing       正确
```

即使用户持续输入很长时间，也不能重复发送多个连续的 standalone `<composing/>`。但是每一条正文消息仍然 SHOULD 携带 `<active/>`。

## 八、群聊支持范围

XEP-0085 可以用于 `type="groupchat"` 的群聊，并不是群聊完全不支持。

群聊中的规则是：

1. 即使并非所有房间成员都发送聊天状态，某个客户端仍然 MAY 发送。
2. 群聊客户端 SHOULD NOT 发送 `<gone/>`。
3. 客户端收到其他群聊成员的 `<gone/>` 时 SHOULD 忽略。

因此群聊通常可以使用：

- `<active/>`；
- `<composing/>`；
- `<paused/>`；
- `<inactive/>`。

但不应使用 `<gone/>` 表示成员退出房间。成员是否离开 MUC 房间，应由群聊协议中的 presence/离房机制表达。

群聊还需要考虑 standalone 状态的广播放大：一个成员发送的输入状态可能被房间服务转发给多个成员。

## 九、`<thread/>` 是什么

这里的 thread 不是程序执行线程，而是 XMPP 消息中的**逻辑会话或话题标识**。

```xml
<message to="bob@example.com" type="chat">
  <thread>chat-20260827-001</thread>
  <body>你好</body>
  <active xmlns="http://jabber.org/protocol/chatstates"/>
</message>
```

之后属于同一逻辑会话的状态通知携带同一个 Thread ID：

```xml
<message to="bob@example.com" type="chat">
  <thread>chat-20260827-001</thread>
  <composing xmlns="http://jabber.org/protocol/chatstates"/>
</message>
```

它用来帮助客户端：

- 区分同一联系人之间不同的逻辑会话；
- 把状态通知关联到正确的会话；
- 按话题组织聊天或群聊历史；
- 将逻辑会话和窗口等物理 UI 对象分开。

Thread ID 不是：

- 单条消息的 `id`；
- XMPP 连接 ID；
- JID 或 resource；
- MUC 房间 ID；
- 程序中的线程。

### XEP-0085 中的 thread 规则

在 XEP-0085 中，thread 支持是 OPTIONAL。只有参与聊天的客户端都支持并实际使用 thread 时，才应用以下附加规则：

1. 回复必须带回相同的 Thread ID。
2. Standalone 状态通知也必须携带对应的 `<thread/>`。
3. 客户端终止一对一聊天会话时，必须发送 `<gone/>`。
4. 收到 `<gone/>` 后，不得在后续聊天消息中复用旧 Thread ID，必须生成新的 Thread ID。

```text
thread-001：ACTIVE -> COMPOSING -> ACTIVE -> GONE
                                               会话结束

thread-002：下一次新会话从新的 Thread ID 开始
```

### thread 不应简单等同于窗口

XEP-0085 把关闭聊天界面列为“终止一对一会话”的例子；XEP-0201 同时强调逻辑 thread 应与窗口等物理界面对象分开，并建议不要只因为用户关闭窗口就销毁 thread。

因此实现时应先区分：

- 最小化、隐藏或暂时关闭 UI，但逻辑会话仍需延续：不要仅因此结束 thread；
- 产品明确把该动作定义为终止当前一对一会话：使用 thread 时发送 `<gone/>`，后续新会话使用新 Thread ID。

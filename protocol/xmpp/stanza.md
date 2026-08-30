## 标准叶子元素（body / subject / show / status / priority / thread）

硬性协议约束：
1. 只能存放纯文本，**禁止嵌套任何子XML标签**（RFC6121 对 body/subject/show/status 均规定 MUST NOT contain mixed content——这是对**发送方**的约束）。
2. 接收方如何处理违规子元素取决于解析器/实现（如 ltx 的 getText 只拼接直接文本节点），协议**未规定**“丢弃子元素、仅保留文本”——不要依赖该行为。
3. 基数规则：body / subject / status 仅可按**不同 xml:lang** 重复；show、priority 至多一个（RFC6121 §4.7.2）；thread（message 专用会话标识，RFC6121 §5.2.5）至多一个。

✅正确
```xml
<body>你好世界</body>
```

❌协议违规（语法解析正常；接收端行为不可依赖）

```
<body>
  <img url="a.png"/>
</body>
```

> 
> 结构化数据、图片、坐标、卡片，**一律不要放进叶子元素内部**。

---

## 1. `<message>`

交互模型：单向尽力投递，协议**不强制应答**。

### 使用场景

1. 一对一聊天 `type="chat"`
2. 群聊消息 `type="groupchat"`
3. 系统通知、提醒消息
4. 携带扩展数据：图片元信息、位置、已读回执、业务卡片

> 支持0个 body，只传递纯结构化扩展数据。

### 完整层级模板

> 模板中的 `<!-- -->` 为**笔记注释**：RFC6120 §11.1 禁止在 XML 流中发送注释（接收方应回 `restricted-xml` 流错误），实际报文必须移除。下同。

```
<message to="接收方JID" type="chat" id="msg-001">
  <!-- message 直接子节点，互相平级 -->
  <!-- 标准叶子节点：仅纯文本，禁止嵌套子标签 -->
  <body>人类可读降级文本，可以为空</body>
  <subject>消息主题，聊天很少用，可以省略</subject>

  <!-- 扩展元素：与 body / subject 平级，不是嵌套进body！ -->
  <!-- message 允许多个平级扩展；每个扩展必须属于独立命名空间（通常在根标签显式声明 xmlns，也可用前缀/继承） -->
  <ExtA xmlns="urn:my-ns:a">
    <!-- 扩展内部：结构层级由扩展协议自定义，可多层嵌套；仍受 XML well-formed 与 XMPP 的 XML 限制（RFC6120 §11.1：禁 DTD/注释/PI/内部与外部实体引用——预定义实体 &amp; &lt; &gt; 等除外） -->
    <url>https://xxx.png</url>
    <size>102400</size>
    <meta width="800" height="600"/>
  </ExtA>

  <ExtB xmlns="urn:my-ns:b">
    <lat>30.59</lat>
    <lng>114.31</lng>
  </ExtB>
</message>
```

### 属性说明

| 属性 | 说明 |
| --- | --- |
| `to` | 协议可选（普通外发业务通常填写），接收方JID；不填写时服务端按“发送者自己的裸JID”路由处理（RFC6120 §10.3.1——按裸JID投递规则执行，可能包含当前资源，不是丢弃） |
| `from` | 客户端通常省略（惯例，非 RFC 义务）；即使填写也会被服务端 MUST 覆盖为真实full-JID（RFC6120 §8.1.2.1） |
| `type` | `chat`一对一；`groupchat`群聊；`normal`邮件式消息；`headline`通知/广播（不落离线）；`error`错误消息 |
| `id` | 协议不强制；用于消息回执、业务追踪时自行生成 |

### 嵌套硬性规则

1. `<body>` / `<subject>` 叶子节点仅允许纯文本（发送方约束；接收方对违规子元素的行为不能依赖，见上）。
2. 结构化数据封装为扩展元素——**直接子节点、与 body 平级是工程约定**；协议允许扩展出现在直接子级或任意更深层级（§8.4 原文 "at the direct child level of the stanza or in any mix of levels"）。但 `<body>`/`<subject>` 叶子内不能嵌套元素是硬规则。
3. 扩展必须命名空间限定（通常在根标签显式声明 `xmlns`，也可前缀/继承）；扩展内部结构由扩展协议自定义，仍受 XML well-formed 与 RFC6120 §11.1 限制。
4. message 允许多个平级扩展元素共存。

### 业务示例：OOB带外图片 XEP-0066

```
<message to="bob@demo.com" type="chat">
  <body>[图片]</body>
  <x xmlns="jabber:x:oob">
    <url>https://demo/photo.png</url>
    <desc>海边照片</desc>
  </x>
</message>
```

- （UI 假设，非 XEP 规定——XEP-0066 只定义传递 url 与可选 desc，不规定显示/下载/渲染行为）旧客户端可能只显示 body 文本 `[图片]`；支持 OOB 的客户端可识别 xmlns、提取 url 自行处理。

---

## 2. `<presence>`

交互模型：单向通知，普通 available/unavailable 与订阅类**无请求-应答语义**；例外 `type="probe"`：接收方服务器 **MUST 按 §4.3.2 分支处理**，响应强度随分支不同——账号不存在/未授权 → SHOULD 回 `unsubscribed`；地址迁移 → SHOULD 回 `redirect`/`gone`；无可用资源 → SHOULD 回 `unavailable`；**有可用资源 → MUST 回每个资源最后一条 presence 的完整 XML**。

### 使用场景

1. 上线、离线状态通告
2. 状态变更：离开、忙碌、长时间离开
3. 好友订阅流程：加好友、同意/拒绝好友
4. 状态报文附带元数据：客户端版本、正在播放音乐等

> 不写 `to` 时，服务端自动广播给**订阅了该用户 presence** 的联系人，并广播到用户**全部 available 资源（含发送该 presence 的资源本身）**——实体隐式订阅自己的 presence（RFC6121 §4.2.2），客户端无需循环发送——不是“roster 里的所有好友”。

### 完整层级模板

```
<presence>
  <!-- presence 直接子节点，互相平级 -->
  <!-- 标准叶子节点：show / status，仅纯文本，禁止嵌套子标签 -->
  <show>dnd</show>
  <status>工作中勿扰</status>

  <!-- 扩展元素：与 show、status 平级；允许多个平级扩展，每个带xmlns -->
  <PlayInfo xmlns="urn:music:demo">
    <song>晚风</song>
    <artist>张三</artist>
    <progress sec="45"/>
  </PlayInfo>
</presence>
```

### 属性说明

| 属性 | 说明 |
| --- | --- |
| `to` | 无 type/`unavailable`：可不写=广播给订阅者+本人全部 available 资源（含当前资源）；`subscribe`/`subscribed`/`unsubscribe`/`unsubscribed` 有明确目标（填对方JID），不能按广播理解 |
| `type` | 不写type=在线可用；`unavailable`=离线；`subscribe/subscribed`好友订阅；`unsubscribe/unsubscribed`取消订阅；`probe`=状态探测（**由服务端代表用户发送**，客户端不应主动发，RFC6121 §4.3）；`error`错误 |

### 嵌套硬性规则

1. `<show>`、`<status>` 叶子节点只能存放文本，禁止嵌套子标签。
2. 自定义数据作为 presence 扩展节点（直接子节点、与 show/status 平级是工程约定；协议允许任意层级，§8.4），必须命名空间限定（通常显式声明 xmlns）。
3. 扩展内部结构由扩展协议自定义，支持多层嵌套（仍受 XML 限制）。
4. resource bind 完成后连接已可用（可收发 stanza）；发送一条不带 type 的 presence（initial presence）是**开启 presence 会话、进入 available** 的动作——不发则不出现在联系人在线列表、收不到联系人 presence 推送（RFC6121 §4.2），但它不是登录的必经步骤。

### 示例1：离线

```
<presence type="unavailable"/>
```

### 示例2：广播离开状态，附带正在播放音乐

```
<presence>
  <show>away</show>
  <status>出去吃饭</status>
  <PlayInfo xmlns="urn:music:demo">
    <song>晴天</song>
    <artist>周杰伦</artist>
  </PlayInfo>
</presence>
```

---

## 3. `<iq>` Info-Query

交互模型：**请求-应答模型**：`iq type="get"/"set"` 协议强制必须应答；`result`/`error` 本身就是应答，不得再回复。

### 使用场景

1. 查询：好友花名册、服务端能力、个人资料
2. 设置/修改：修改个人头像、配置、提交指令
3. 自定义一问一答业务指令

> 类比HTTP request/response；依靠 `id` 匹配请求与响应。

### 完整层级模板

```
<iq type="get" id="req-0001" to="demo.com">
  <!-- ========== iq 的【直接子节点】 🔴协议强限制 ========== -->
  <!--
    iq get/set：必须【恰好 1 个】业务载荷元素；result：0 或 1 个；error：可复制原请求载荷再附加<error>。
    载荷必须命名空间限定（namespace-qualified）——xmlns 可从祖先继承，不必字面写在载荷标签上。
    ❗get/set 不允许 0 个或并列 2 个业务载荷。
    👉 如果需要传递多组业务数据：全部嵌套进这唯一的载荷内部。
    ✨载荷内部：结构层级由扩展协议自定义；仍受 XML well-formed 与 RFC6120 §11.1 的 XML 限制。
  -->
  <FetchHistory xmlns="urn:history:demo">
    <limit>20</limit>
    <beforeTime>1756332111</beforeTime>
    <filter>
      <type>chat</type>
    </filter>
  </FetchHistory>
</iq>
```

### 属性说明

| 属性 | 说明 |
| --- | --- |
| `id` | **强制必填**，字符串，自己生成（至少在当前流内唯一；是否全局唯一由发起方决定，RFC6120 §8.1.3）；响应必须带回完全相同id |
| `type` | 请求：`get`读、`set`写；响应：`result`成功、`error`失败 |
| `to` | 查询目标，可以是用户JID，也可以是服务端域名 |
| `from` | 客户端通常省略（惯例）；服务端 MUST 覆盖（RFC6120 §8.1.2.1） |

### 嵌套硬性规则

1. iq 载荷基数按 type 区分（RFC6120 §8.2.3）：get/set **恰好 1 个**业务载荷（禁止 0 个或并列多个）；result 0~1 个；error 可带回原载荷并附加 `<error>`。载荷必须命名空间限定（xmlns 可继承）。
2. 所有业务字段全部写在载荷内部，载荷内部结构由扩展协议自定义（仍受 XML 限制）。
3. 收到 `iq type="get"/"set"` 请求，接收方必须返回同id的 `type="result"` 或 `type="error"`；收到 result/error 不得再应答。

### 示例：get 请求查询历史消息

```
<iq type="get" id="hist-0001" to="demo.com">
  <FetchHistory xmlns="urn:history:demo">
    <limit>20</limit>
  </FetchHistory>
</iq>
```

### 示例：服务端返回 result

```
<iq type="result" id="hist-0001" from="demo.com" to="alice@demo.com/pc">
  <FetchHistory xmlns="urn:history:demo">
    <msg from="bob@demo.com">
      <body>hi</body>
    </msg>
  </FetchHistory>
</iq>
```

---

## 网络层次和数据包

xmpp使用TCP连接，并支持安全传输（TSL/SASL）

xmpp层传输中采用XML格式，称为 XML stanzas，xmpp节点间的XML stanzas传输构成的数据流称为XML Stream

### XML Stream

包括Presence、Message和Iq stanzas

* Presence用于传输节点状态
* Message用于传输信息内容
* Iq stanzas用于传输更复杂的应答

### 节点与路由

大致有两种，一种是客户端，一种是服务器。客户端与客户端之间通信需要经过服务器中转，由服务器分析后发往其他服务器或客户端

客户端需要连接服务器，而服务器为客户端提供数据包的路由和转发

```JavaScript
服务器 <--> 服务器 <--> 客户端
```

## 地址标识

每个客户端都需要拥有一个地址标识用于定位，xmpp称之为JID(Jabber ID)，与email地址格式类似，当多了一个resource用于支持同一账号多客户端登陆

```JavaScript
[node'@']domin["/"resource]
// eg: xxyCoder@gmail.com/test
```

## 公有属性

to 数据包需要发送的目的地址

from 数据包需要发送的源地址

id 数据包标识符

## 整体流程

### 初始化

客户端发送Stream头部XML

```XML
<?xml version='1.0'?>
<stream:stream
    to='example-server.com'
    xmlns='jabber:client'
    xmlns:stream='http://etherx.jabber.org/streams'
    version='1.0'  
```

服务器在收到客户端的Stream头后，回应一个Stream头

```XML
<?xml version='1.0'?>
<stream:stream
    to='example-client.com'
    id="some-id"
    xmlns='jabber:client'
    xmlns:stream='http://etherx.jabber.org/streams'
    version='1.0'  
```

### 对话结束

客户端和服务器先后发送Stream尾部XML，使得整个Stream闭合（如果TCP异常中断，则服务器之间中断对话）

```XML
</stream:stream>
```

### 获取联系人列表

需要客户端发送GET类型的Iq数据包（为其他操作提供get、result、set和error动作的数据包，本身并没有限定用途的范围）

```XML
<iq
    from="test1@example.com/web"
    to="example.com"
    type="get"
    id="kazuya_1">
    <query xmlns='jabber:iq:kazuya'/>
</iq>
<!-- 表示用户test1向example.com服务器请求 kazuya 表 -->
```

服务器收到请求后，响应kazuya表

```XML
<iq
   from="example.com"
    to="test1@example.com/web"
    type="result"
    id="kazuya_1">
    <query xmlns="jabber:iq:kazuya">
    ...
    </query>
</iq>
```

### 获取状态

```XML
<presence>
    <show>away</show>
</presence>
```

服务器收到后会自行填充from和to属性，发送到订阅了该用户状态信息的联系人服务器上

客户端也可以在发送时填上to属性，用于指定presence接收方

### 即时聊天

客户端发出消息被服务器转发至example.com服务器中，随后交给test2的已登陆的客户端（如果未登陆则message会存储在服务器直到用户上线）

```XML
<message
    to="test2@example.com/web"
    from="test1@example.com/web"
    type="chat"
    xml:lang="en">
    <body>xxxxx</body>
</message>
```

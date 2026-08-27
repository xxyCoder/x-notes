## Node

Node从EventTarget继承而来，所有DOM节点对象都继承了Node接口

### 属性

1. nodeType 表示节点类型，可以从Node.XXX获取映射值

```JavaScript
if (node.nodeType === Node.ELEMENT_NODE) {}
```

2. nodeName 返回节点名称
   1. 文档节点 #document
   2. 元素节点 大写标签名
   3. 属性节点 属性key
   4. 文本节点 #text
   5. 文档片段节点 #document-fragment
   6. 注释 #comment
3. nodeValue 只有文本、注释和属性节点才有值，其余都为null
4. previousSibling和nextSibling 返回前后node节点
5. parentNode 返回父节点（只可能是element、document和document-fragment或null）
6. parentElement 返回父元素（element或null）
7. firstChild和lastChild 返回第一个/最后一个子节点
8. childNodes 返回子节点集合（NodeList）
9. isConnected 表示当前节点是否在文档之中

#### textContent

忽略HTML标签返回当前节点和它所有后代节点文本内容，如果写入HTML标签则会进行转义

如果是document和document.doctype则返回null

### 方法

1. insertBefore
2. removeChild 如果参数节点不是当前节点的子节点则报错
3. replaceChild

#### appendChild

将节点插入到子节点列表的末尾

如果是dom中已存在的节点则是移动到子节点末尾

如果是document-fragment则插入的是document-fragment所有子节点，并返回一个空的document-fragment

#### cloneNode

可以选择是否深度克隆节点，但是会丧失addEventListener和on-属性的注册的回调

id属性也会被克隆，需要注意避免同一个dom出现两个相同id

#### contains

如果一个子节点是当前节点或当前节点的后代节点则返回true

#### isEqualNode和isSameNode

isEqualNode比较类型、属性和子节点

isSameNode比较是否为同一个节点

## NodeList

对象节点的集合，类数组对象，但是可以使用forEach、keys、values和entries方法进行遍历（有些浏览器较为过时，可能没有实现forEach等方法）

childNodes或querySelectorAll的返回值

其中childNodes返回的NodeList是动态的，而querySelectorAll返回的NodeList是静态的

## HTMLCollection

元素的集合，类数组对象，没有相关的遍历方法，即时更新子项

document.images、document.forms、document.links等返回值

其中HTMLFormControlsCollection和HTMLOptionsCollection继承了该接口

## 概念

* [list of active formatting elements](https://html.spec.whatwg.org/multipage/parsing.html#formatting) : b, code, i, strong, u ...等
* [current node](https://html.spec.whatwg.org/multipage/parsing.html#current-node)：栈顶element
* [scope](https://html.spec.whatwg.org/multipage/parsing.html#has-an-element-in-scope)：元素归属作用域

## insert mode

* [insert mode](https://html.spec.whatwg.org/multipage/parsing.html#insertion-mode)

### 举个例子

* 处于 "in table"
  * 开始标签遇到th、tr或者td时候，则插入tboday html element并切换为 "in table body"
* 处于 "in table body"
  * 开始标签遇到了tr标签，则插入tr html element并切换insert mode为 "in row"
  * 开始标签遇到了th/td标签，则解析错误，插入tr html element并切换insert mode为"in row"，重新读取当前token(即th/td标签)
  * 如果遇到了与表格相关标签但是insert mode不是 "in table body"则标签忽略
* 处于 "in select"
  * 只有options、optgroup和hr标签才会插入对应的html element，其余要么作为token character，要么parse error

## parse

[parsing-main-inhtml](https://html.spec.whatwg.org/multipage/parsing.html#parsing-main-inhtml)

## 错误修复

[error handling](https://html.spec.whatwg.org/multipage/parsing.html#an-introduction-to-error-handling-and-strange-cases-in-the-parser)

1. 当遇到不匹配的结束元素x，且是formatting element时，触发[Adoption Agency Algorithm](https://html.spec.whatwg.org/multipage/parsing.html#adoptionAgency)
   1. 如果栈中没有开始元素x，则忽略结束元素x
   2. 如果开始元素x到栈顶元素中没有块级元素则依次为栈顶元素补充结束标签并弹出栈顶元素直到弹出开始元素x
   3. 找到离开始元素x最近的块级元素y以及开始元素x和开始元素y的共同祖先元素z，将元素y移动为元素z的子元素，闭合开始元素x，并将当前结束元素x进行闭合作为元素y的子元素
2. 文本节点触发 [reconstruct the active formatting elements](https://html.spec.whatwg.org/multipage/parsing.html#reconstruct-the-active-formatting-elements)
   1. 如果list of active formatting elements队列中有元素，则使用最近的元素将文本进行包裹，否则什么也不做
3. 遇到不匹配结束元素x，但是不是formatting element时栈顶依次弹出进行闭合
4. p元素比较特殊，结束元素也能自己创建新的开始元素进行闭合

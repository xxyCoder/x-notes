## [流式布局](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_display/Flow_layout)

块级元素向文章段落一样一行显示一个，而内联元素像句子中文字一样一行可多个，摆放不下就换行

## [display](https://developer.mozilla.org/zh-CN/docs/Web/CSS/display)

设置元素的内部和外部的*显示类型，* 外部类型参与流式布局，内部类型参与子元素的布局

### 外在盒子

有block和inline属性值

### 内在盒子

有flow、flow-root、table、flex和grid等

#### flow

根据外在盒子是否为inline并且参与一个区块或者行级格式上下文来判断是否创建的是行级元素，否则创建块级元素

还根据其他属性值如position、float和overflow以及是否参与一个区块或者行级格式上下文来判断是否创建[区块格式化上下文](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_display/Block_formatting_context)

#### flow-root

生成一个块级元素盒子，并创建一个新的[区块格式化上下文](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_display/Block_formatting_context)

### list-item

该元素为内容生成一个块级盒子和一个单独的列表元素行级盒子

```Plain Text
┌───────────────────────────────┐
| List Item                     |
|  ┌───────────┐ ┌────────────┐ |
|  | Marker    | | Principal  | |
|  | Box       | | Box        | |
|  └───────────┘ └────────────┘ |
└───────────────────────────────┘
```

### 示例

```CSS
/* block flow，由外在的“块级盒子”和内在的“块级容器盒子”组成*/
display: block; 
/* display: inline flow-root，外在的“内联盒子”和内在的“块级容器盒子”组成*/
display: inline-block;
/* display: inline flow， 内外均是“内联盒子”*/
display: inline;
```

## float

1. 包裹性和收缩性（和inline-block一样）
2. 块状格式化上下文，也就是说除了inline-table会计算为table,其余都计算为block
3. 破坏文档流
4. 没有margin合并

### 作用机制

1. float属性让父元素塌陷的原因就是为了实现文字环绕，这样在父元素之外的元素也能在浮动元素周边环绕
2. 行盒子和浮动元素不会重叠，只会跟随浮动元素，而块级盒子和浮动元素是会完全重叠的
3. 规范约定浮动元素和内联元素在一行显示
  - 如果内联元素换行则浮动元素也会跟着换行
  - 如果内联元素占满一行则浮动换行

## clear

1. 元素盒子的边不能和**前面**的浮动元素相邻
  - 也就是说clear: right在从左往右的水平流中无效，clear: both和clear: left作用一致
  - clear属性设置margin-top为非常大的负值也是没效果的，因为边不能和浮动挨着
2. clear属性只有在块级元素中才有效
3. clear元素后面的元素依然可能会出现环绕
  - 这是因为clear元素后面的元素不一定设置了clear属性，此时只有margin-top设置为负值从而能挨到浮动边就会发生环绕

## BFC

- 如果一个元素具有BFC，内部元素不会影响外部元素，也不受到外部影响
  - 可以用来解决上面说到的clear元素后面的元素依然会出现环绕的问题
1. 根元素html
2. float不为none
3. overflow不为visible
4. position不为static和relative

## overflow

1. 裁剪的是border内边缘
2. overflow-x和overflow-y中有一个值设置为visible而另外一个不为visible，则visible样式表现如同auto
3. pc端滚动条会占据可用宽度，而移动端不会（滚动条是悬浮的）

## absolute

- float和absolute同时存在时，float无效
1. 块状化
2. 包裹性和收缩性，最大可用宽度为包含块宽度
3. 流体特性，就像没有设置宽度的div（前提是设置了left和right）

### 无依赖绝对定位

- 即没有设置top、left、right和bottom属性，其表现为相对定位+不占据css流空间尺寸
- IE7块状的无依赖绝对定位表现如内联元素，也就是会和其他内联元素一行显示

### 包含块

1. 可视窗口
2. position: relative | static元素，包含块是最近**块级**祖先盒的content box边界形成
3. position: fixed，包含块是可视窗口或者transform元素
4. position: absolute，包含块由最近position不为static元素的padding box边界形成
  - 对于有padding的内联元素换行则包含块是未定义的（内联padding会换行）

## relative

- left/bottom/right/top的百分比相对包含块计算的

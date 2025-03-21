## z-index

1. 只有和定位元素（position不为static）在一起使用才有效果
2. 当z-index不为auto时会产生一个层叠上下文（IE6和IE7浏览器有个bug，就是z-index:auto的定位元素也会创建层叠上下文，而Chrome等WebKit内核浏览器下，position:fixed元素天然层叠上下文元素，无须z-index为数值）
3. position为static 属性可防止z-index产生影响

### 层叠上下文

1. 层叠顺序：background/border < 负值z-index < block盒子 < float盒子 < inline（包括inline-block）盒子 < z-index: 0/auto < 正值z-index，相等的层叠水平则“后来者居上"
2. 每个层叠规则只适用于当前层叠上下文中
3. 层叠上下文可以嵌套，每个层叠上下文和兄弟元素相互独立（也就是说渲染相互不影响，一个层叠上下文发生渲染不会导致另外一个兄弟层叠上下文发生渲染）
4. 根元素天生就是一个层叠上下文

#### 新方式创建层叠上下文

1. opacity不为0
2. transform不为none
3. filter不为none

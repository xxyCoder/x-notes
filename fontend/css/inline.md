## line-height

- 定义为两基线的间距，默认值为normarl（和font-family相关）
  - 比如说字体为宋体，那么normal解析为1.14
- 数值如line-height: 1.5; 最终计算值为当前font-size相乘后的值，子元素继承初始值line-height: 1.5;
- 百分比，同数值计算方式一致，子元素继承最终值；
- 长度值如15px。

## 内联元素

- 其高度由font-size、vertical-align和line-height决定的。

### 块级元素

- line-height对其块级元素本身是没有用的，只是作用于块级元素里的内联级别元素占据的高度实现改变自身块级元素高度的。


### 替换元素

- line-height只能影响最小高度

## vertical-align

- 百分比值则是相对于line-height的计算值计算的；
- 只能应用于内联元素以及display值为table-cell的元素；
- vertical-align的数值是基于基线位置上下移动，负值基线往上走（与其他元素基线对其导致自身需要往下走），正值基线往上走（与其他元素对其导致自身需要往上走）；
- 内联元素默认都是沿着字母x的下边缘对齐的。对于图片等替换元素，往往使用元素本身的下边缘作为基线；
- 对字符而言，font-size越大字符的基线位置越往下

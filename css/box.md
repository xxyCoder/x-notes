## content

- content生成的文本是无法选中，同时屏幕阅读设备和搜索引擎也无法抓取

### 计数器

- counter-reset计数器重置为设定值或默认值0；IE和Firefox将小数当0处理，Chrome则是向下取整
- counter-increment计数器递增，默认为1，出现在dom元素身上，计数器便会添加修改值一次
- counter(name, style)，其实style支持的属性为list-style-type属性值
- counters(name, string, style)嵌套技术，string为子序号的连接符，表现为上层节点的`${上层节点counter}${string连接符}${当前节点counter}`，如果当前节点覆盖上层节点的counter，则不会形成连接符

```css
.counter {
  counter-reset: c1 1 c2 2;
  counter-increment: c3 2 c4 3;
  content: counter(c5);
}
```

# padding

- 对于非替换元素的内联元素，不仅padding不会加入行盒高度的计算，margin和border也都是如此，都是不计算高度，但实际上在内联盒周围发生了渲染
- 内联元素，其padding是会断行的，也就是padding会跟着行宽盒子走
- padding不支持负值，百分比相对自身宽度计算

# margin

- 只有元素是“充分利用可用空间”状态的时候，margin才可以改变元素的可视尺寸
- 定位元素设置方向的值和margin方向值累加表现，非定位方位设置margin无效
- 支持负值，百分比相对自身宽度计算

## margin合并

- 块级元素（不包括浮动和定位元素），发生在和当前文档流方向相垂直的方向上

1. 相邻兄弟元素
2. 父级和第一个/最后一个子元素，表现为margin全部合并到父元素上
3. 空块级元素文档流同向和反向合并

## auto合并

- 触发条件：元素是具有对应方向的自动填充特性
- 一侧定值，一侧auto，则auto为剩余空间大小
- 两侧都是auto，则平分剩余空间

# border

- 不支持负值也不支持百分比
- width默认是3px，因为当边框为3px的时候，才开始有双线边框的表现
- border-color未设置时会使用元素的color

# text

## text-indent

- text-indent的百分比值是相对于当前元素的“包含块”计算的，而不是当前元素
- text-indent仅对第一行内联盒子内容有效
- 非替换元素以外的display计算值为inline的内联元素设置text-indent值无效，如果计算值是inline-block/inline-table则会生效

## letter-spacing

- 默认值是normal而不是0。虽然说正常情况下，normal的计算值就是0，但两者还是有差别的，在有些场景下，letter-spacing会调整normal的计算值以实现更好的版面布局
- letter-spacing负值仅能让字符重叠，但是不能让替换元素或者inline-block/inline-table元素发生重叠
- 在默认的左对齐情况下，无论值如何设置，第一个字符的位置一定是纹丝不动的
- 支持小数，不支持百分比
- letter-spacing作用于所有字符，但word-spacing仅作用于空格字符

## word-break

1. normal表示使用默认换行规则
2. break-all表示允许任意非CJK文本间的单词换行
3. keep-all表示不允许非CJK单词换行，只能在半角符号、空格或连字符处换行，表现和非CJK的normal规则一致
  - 移动端目前不支持

## word-wrap

1. normal表示默认换行规则
2. break-word表示一行单词中没有合适换行点时换行
  - 如果这一行文字有可以换行的点，如空格或CJK（中文/日文/韩文）之类的，就不打英文单词或字符的主意了，在这些换行点换行，至于对不对齐、好不好看则不关心

## white-space

1. normal会合并空白符和换行符
2. pre不合并空白符，并且内容只有在有换行符时才换行
3. nowrap会合并空白符，但不允许文本环绕
4. pre-wrap相当于pre+允许文本环绕
5. pre-line相当于pre+合并空白符+允许文本环绕

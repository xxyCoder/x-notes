## content

- content生成的文本是无法选中，同时屏幕阅读设备和搜索引擎也无法抓取

### 计数器

- counter-reset计数器重置为设定值或默认值0；IE和Firefox将小数当0处理，Chrome则是向下取整
- counter-increment计数器递增，默认为1，出现在dom元素身上，计数器便会添加修改值一次
- counter(name, style)，其实style支持的属性为list-style-type属性值
- counters(name, string, style)嵌套技术，string为子序号的连接符，表现为上层节点的`${上层节点counter}${string连接符}${当前节点counter}`，如果当前节点没有重置上层节点的counter，则不会形成连接符

```css
.counter {
  counter-reset: c1 1 c2 2;
  counter-increment: c3 2 c4 3;
  content: counter(c5);
}
```

## padding

- 对于非替换元素的内联元素，不仅padding不会加入行盒高度的计算，margin和border也都是如此，都是不计算高度，但实际上在内联盒周围发生了渲染
- 内联元素，其padding是会断行的，也就是padding会跟着行宽盒子走
- padding不支持负值，百分比相对自身宽度计算

## margin

- 只有元素是“充分利用可用空间”状态（eg: width: auto的div元素）的时候，margin才可以改变元素的可视尺寸
- 定位元素设置方向的值和margin方向值累加表现，非定位方位设置margin无效
- 支持负值，百分比相对自身宽度计算

### 无效场景

1. display: inline的非替换元素垂直方向无效
2. display: table-cell|table-row的元素垂直和水平方向无效
3. 定位元素的非定位方向无效（eg: position: absolute; left: 10px; margin-right: 10px; 此时margin-right无效）

### margin合并

- 块级元素（不包括浮动和定位元素），发生在和当前文档流方向相垂直的方向上

1. 相邻兄弟元素
2. 父级和第一个/最后一个子元素，表现就像margin全部合并到父元素上一样
3. 空块级元素文档流同向和反向合并

### margin: auto填充

- 触发条件：元素是具有对应方向的自动填充特性（eg: width: auto的div元素）
- 一侧定值，一侧auto，则auto为剩余空间大小
- 两侧都是auto，则平分总空间减去元素宽度的剩余空间

## border

- 不支持负值也不支持百分比
- width默认是3px，因为当边框为3px的时候，才开始有双线边框的表现
- border-color未设置时会使用元素的color

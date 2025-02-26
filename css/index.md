## 如何让上下两个元素宽度保持一致，宽度大小为最小的元素宽度？

```html
<!-- 让h2和p元素宽度保持一致，大小为宽度最小的h2 -->
<section>
  <h2>xxxxxx</h2>
  <p>xxxxxxxxxxxxxxxx</p>
</section>
```
1. 第一种实现办法，利用table-caption让元素不参与父元素的尺寸、背景色等非继承样式的设置，从而让section的宽度由h2的宽度决定

```css
section {
  display: table;
}
section p {
  display: table-caption;
  caption-side: bottom;
}
```

2. 第二种办法则是利用width: min-content+white-space: norwrap，min-content会让宽度变为最小内容宽度，即一个中文或一个连续不可断英文字符占据的宽度，然后添加white-space: norwap避免中文字符断开，使得section按照h2宽度渲染

```css
section {
  width: min-content;
  white-space: nowrap;
}
section p {
  white-space: normal;
}
```

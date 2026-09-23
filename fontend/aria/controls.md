# aria-controls

用来告诉屏幕阅读器等辅助技术：当前元素控制的是哪个元素。它的值是被控制元素的 id

只描述控制关系，不会自动实现展开、隐藏或点击行为

## Example

```html
<button aria-controls="details" aria-expanded="false">
  查看详情
</button>

<div id="details" hidden>
  这里是详细内容
</div>
```
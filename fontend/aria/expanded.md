# aria-expanded

用来告诉屏幕阅读器：当前元素控制的内容是否已展开

## Example

```html
<button aria-expanded="false" aria-controls="details">
  查看详情
</button>

<div id="details" hidden>
  详细内容
</div>
```

展开内容时，需要同步将 aria-expanded 改为 "true"。它只描述状态，不会自动实现展开或折叠。
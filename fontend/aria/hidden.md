# aria-hidden

用来控制元素是否向屏幕阅读器等辅助技术暴露

## Example

```html
<button>
  <span aria-hidden="true">🔍</span>
  搜索
</button>
```

这里的图标仍然显示，但屏幕阅读器会忽略它，只读出“搜索”，避免重复或无意义的朗读。
- aria-hidden="true"：从无障碍树中隐藏该元素及其所有子元素，不影响视觉显示。
- aria-hidden="false" 或不设置：通常允许辅助技术访问，但无法覆盖祖先元素上的 aria-hidden="true"。
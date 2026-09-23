# aria-label

用来给元素提供一个供屏幕阅读器朗读的名称，不会在页面上显示文字

## Example

```html
<button aria-label="关闭">
  <span aria-hidden="true">×</span>
</button>
```

- 屏幕阅读器会将它识别为“关闭，按钮”。如果按钮已经有明确的文字，通常不需要额外设置（通常会覆盖元素原有文字作为无障碍名称）
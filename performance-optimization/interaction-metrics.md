## INP

[Interaction to Next Paint](https://web.dev/articles/inp?hl=zh-cn)

* 当网页响应互动时，浏览器会在其绘制的下一个帧中显示视觉反馈，而inp衡量下一次绘制被阻塞的时间

### 计算方式

* inp是最长互动时间，而互动时间是指用户手势期间触发一组事件处理脚本到下次绘制帧的时间

### 互动包含哪些内容？

1. Javascript驱动
2. 非Javascript驱动的控件（select element、input element）

### 如何优化

[优化 Interaction to Next Paint](https://web.dev/articles/optimize-inp?hl=zh-cn)

[content-visible：可提升渲染性能的新 CSS 属性](https://web.dev/articles/content-visibility?hl=zh-cn)

#### 组成

1. 输入延迟时间：从用户开始互动到互动回调开始运行之前
   1. [优化输入延迟](https://web.dev/articles/optimize-input-delay?hl=zh-cn)
2. 处理时长：事件回调开始到完成所需时间
   1. [优化耗时较长的任务](https://web.dev/articles/optimize-long-tasks?hl=zh-cn)
3. 呈现延迟时间：从互动事件处理脚本完成时开始，一直到绘制下一个帧为止
   1. [DOM 大小对互动的影响以及应对措施](https://web.dev/articles/dom-size-and-interactivity?hl=zh-cn)
   2. [长时间运行的 requestAnimationFrame 回调](https://web.dev/articles/find-slow-interactions-in-the-field?hl=zh-cn#long-running_requestanimationframe_callbacks)

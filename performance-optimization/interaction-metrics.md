## 度量指标与收集数据

- 如果要对一个页面的性能进行真正有效的优化，而不是只让自己感觉它似乎快了一些，就需要先找到一个合理的方式度量页面的性能
- 为了评估用户真实感受到的性能，还需要采集和统计用户端的性能数据
  - **[webpagetest](https://www.webpagetest.org/ "测试网站性能")**
  - [gtmetrix](https://gtmetrix.com/ "测试网站性能")

### 均值

- 把多个用户多次访问的首屏指标求均值即可
- 缺点在于难以排除极值影响和没有可解释性（无法描述均值代表的意义）

### 分位数

- 可以说有不少于x%的用户首屏渲染在y秒内，这个x就是耗时渲染的x分位数

### 秒开率

- n秒内能过打开的用户占比，主要关注有多少用户可以达到非常高的性能水平

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
  
## LCP

[Largest Contentful Paint (LCP)](https://web.dev/articles/lcp?hl=zh-cn)

* 视口内最大图片、文本或者视频渲染的时间（相对用户首次导航到网页的时间）

### 考虑元素

* img（第一帧呈现时间）
* svg中image元素
* video元素（使用poster加载时间或是视频第一帧呈现时间中的最小者）
* 使用url函数加载的背景图片
* 包含文本节点或其他内嵌级文本元素子元素的块级元素

### 如何确定元素大小

* 视口中呈现的大小，外边距、内边距、边框、超出视口范围、被裁剪或者不可见的溢出都不会计入元素大小
* 文本元素仅考虑所有文本节点的最小矩形

### 计算

* [在 JavaScript 中监控 LCP 细分](https://web.dev/articles/optimize-lcp?hl=zh-cn#monitor_lcp_breakdown_in_javascript)

```JavaScript
// Largest Contentful Paint API
new PerformanceObserver((entryList) => {
const entries = entryList.getEntries();
const lcpEntry = entries[entries.length - 1]; // 取最后一个 LCP 候选元素
const element = lcpEntry.element; // 获取对应的 DOM 元素

// 输出元素信息
console.log("LCP 元素标签:", element.tagName);
console.log("LCP 元素尺寸:", lcpEntry.size, "px²");
console.log("LCP 元素 URL（如果是图片）:", lcpEntry.url);

}).observe({ type: "largest-contentful-paint", buffered: true });
```

### 优化

[优化 Largest Contentful Paint](https://web.dev/articles/optimize-lcp?hl=zh-cn)

#### 组成

1. 收到第一个字节的时间
2. 资源加载延迟
   1. CSS、JS或图片需要等待加载的时长
   2. [消除资源加载延迟](https://web.dev/articles/optimize-lcp?hl=zh-cn#1_eliminate_resource_load_delay)
3. 资源加载时长
   1. [缩短资源加载时长](https://web.dev/articles/optimize-lcp?hl=zh-cn#reduce-resource-load-duration)
4. 元素延迟渲染
   1. [消除元素渲染延迟](https://web.dev/articles/optimize-lcp?hl=zh-cn#2_eliminate_element_render_delay)
  
## TTI

* [Time to Interactive](https://web.dev/articles/tti?hl=en)

### 计算方式

* 从FCP开始往后找到一个至少持续了5秒且没有长任务、并行未来请求不超过两个到窗口，从该窗口开始时间往后找到最后一个长任务的结束时间，如果没有则认为是FCP的位置

### 如何优化

* [如何提高TTI](https://web.dev/articles/tti#how_to_improve_tti)

1. 优化FCP
2. 减少JS工作时间
3. 最小化并行请求数量

## FID

* [First Input Delay](https://web.dev/articles/fid)
* 从用户首次与页面交互到浏览器实际能够开始执行事件处理以响应该交互的时间

### 计算方式

```JavaScript
new PerformanceObserver((entryList) => {
  for (const entry of entryList.getEntries()) {
    const delay = entry.processingStart - entry.startTime;
    console.log("FID candidate:", delay, entry);
  }
}).observe({ type: "first-input", buffered: true });
```

## TBT

* [Total Blocking Time](https://web.dev/articles/tbt)
* 总阻塞时间 (TBT) 指标测量FCP之后主线程被阻塞足够长的时间以阻止输入响应的总时间

### 计算方式

* 所有（长任务耗时-200ms）的总和

### 如何优化

1. 减少长任务

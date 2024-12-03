# 度量指标与收集数据

- 如果要对一个页面的性能进行真正有效的优化，而不是只让自己感觉它似乎快了一些，就需要先找到一个合理的方式度量页面的性能
- 为了评估用户真实感受到的性能，还需要采集和统计用户端的性能数据
  - **[webpagetest](https://www.webpagetest.org/ "测试网站性能")**
  - [gtmetrix](https://gtmetrix.com/ "测试网站性能")

## 均值

- 把多个用户多次访问的首屏指标求均值即可
- 缺点在于难以排除极值影响和没有可解释性（无法描述均值代表的意义）

## 分位数

- 可以说有不少于x%的用户首屏渲染在y秒内，这个x就是耗时渲染的x分位数

## 秒开率

- n秒内能过打开的用户占比，主要关注有多少用户可以达到非常高的性能水平

## 首屏指标

### FP

- FP代表浏览器第一次在页面上绘制的时间（比如背景色），这个时间仅仅是指开始绘制的时间，但是未必真的绘制了什么有效的内容

```js
const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
        if (entry.name === 'first-paint') {
            console.log('FP时间:', entry.startTime);
            // 可以将这个数据发送到服务器或者进行其他处理
        }
    }
});
observer.observe({ entryTypes: ['paint'] });
```

### FCP

- FCP代表浏览器第一次绘制出DOM元素（如文字、`<input>`标签等）的时间。FP可能和FCP是同一个时间，也可能早于FCP

```js
const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint') {
            console.log('FCP时间：', entry.startTime);
            // 可以将这个数据发送到服务器或者用于其他分析目的
        }
    }
});
observer.observe({ entryTypes: ['paint'] });
```

### FMP

- FMP是一个主观的指标，毕竟意义（Meaningful）本身就是一个主观的概念
  - 记录关键逻辑的时间点，如页面关键组件渲染完成（useEffect、onLoad事件，onMounted生命周期等）、API接口数据的返回，手动使用JS记录，但是会存在一定误差

### LCP

- LCP是根据占用页面面积最大的元素的渲染时间确定的
  - 元素的面积主要是根据用户在页面中能够看到的元素的大小计算的。
  - 显示到屏幕以外，或者被容器的overflow裁剪、遮挡的面积不计算在内。
  - 文字元素的面积为包含文字的最小矩形的面积。
  - 图片以实际 `<img/>`组件的大小计算，而非原始图片的大小。
  - CSS设置的border padding等都不计算在内。
- 由于用户的交互也可能会改变页面上的元素，因此当用户在页面上进行交互后（包括点击、滚动等），浏览器就会停止报告largest-contentful-paint。

```js
const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
        console.log('LCP时间：', entry.startTime);
        // 可以将这个数据发送到服务器或者用于其他分析目的
    }
});
observer.observe({ entryTypes: ['largest-contentful-paint'] });
```

### SI

- 它是一个用于衡量页面可视部分加载速度的综合指标，速度指数主要关注页面内容填充视口的速度，而不是某个特定元素的加载时间。计算类似于对页面可视部分在加载过程中的时间进行积分。

## 优化首屏

## 什么是window

该对象是浏览器环境下的全局对象，拥有全局作用域，代表当前浏览器窗口或标签页，提供了浏览器窗口本身的属性、控制方法和HTML文档的入口

## 常用属性

* document 指向HTML文档
* location 提供了URL信息和操作方法
* history 操作浏览历史记录
* navigator 提供了浏览器和系统信息
* localStorage / sessionStorage 存储数据
* isSecureContext 表示是否处于加密环境

### opener

表示打开当前窗口的父窗口，如果没有则为null（比如浏览器地址栏直接输入），有同源限制

如果是非同源页面，只能通过opener拿到少部分属性和方法，其中只有location属性是可读写的，但只允许调用replace方法和写入href属性

### frameElement

获取当前页面嵌入在其他页面所在元素节点（如iframe、object或embed），有同源限制

如果非同源页面，则返回null

### top、parent

分别获取顶层和父窗口，如果当前页面不在某个框架下则都指向当前window

### 位置属性

* screenX/Y 表示浏览器窗口距离屏幕左上角X/Y位置
* innerHeight/Width 表示窗口可见部分的高度/宽度，缩放也会改变（像素大小不变，占据空间变小/大，可见范围变大/小）
* outerHeight/Width 表示innerHeight/Width + 包括浏览器菜单和边框
* scrollX/Y 表示滚动距离

## 常用方法

### open

返回新窗口引用，许多浏览器默认都不允许脚本自动新建窗口。只允许在用户点击链接或按钮时，脚本做出反应，弹出新窗口。因此，有必要检查一下打开新窗口是否成功

```JavaScript
var popup = window.open();
if (popup === null) {
  // 新建窗口失败
}
```

### scrollTo、scrollBy

to方法将文档滚动到指定位置，by方法将文档相对参数进行滚动

### requestAnimationFrame

要求在下一次重绘之前，调用 用户提供的回调函数，为一次性调用

#### 为什么设计为独立阶段

1. 其核心目的是在浏览器执行渲染前更新动画状态
2. 浏览器可以在页面不可见或者执行时间过长时放弃raf回调
3. 如果设计为宏任务，则某个宏任务执行过久，会阻塞后面的宏任务

#### 浏览器中的EventLoop

* 执行所有script中同步代码

1. 执行所有微任务
2. 执行一个宏任务，然后查看微任务队列，有则执行所有微任务
3. 执行所有requestAnimationFrame
4. 执行渲染流水线
5. 执行requestIdleCallback（如果有空余时间）

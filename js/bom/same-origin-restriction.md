## 源的定义

URL的协议、端口和域名

## 源的更改

通过document.domain进行更改，但是只能设置为其当前域和父域，不能为顶级域名或者其他域名（失败报 SecurityError 错误）

## 源的限制

### Window

#### 方法

blur、close、focus、postMessage

#### 属性

closed、location、opener、parent、top

其中location只能调用replce方法和写入href属性

### 存储数据

Storage和IndexedDB是以源分割的，每个源都有自己的存储空间，一个源中的JS不能读取另外一个源中的数据

Cookie则可用为子域、父域设置cookie

### Image

如果没有指定crossorigin属性，则允许加载任何来源的图片资源，但是禁止js读取图片像素数据

如果指定了crossorigin属性，图片响应中没有Access-Control-Allow-Origin或者该属性没指定当前页面源则会阻止图像加载并报CORS错误

### Form

允许跨源提交（即使没有Access-Control-Allow-Origin头），提交后页面跳转，原页面是拿不到返回值的

### Link

跨源css是可以加载的，但是如果内部使用url等函数引用的某些资源（比如font-face、使用了cross-fade）可能会被浏览器阻止加载（除非服务器配置cors）

指定或未指定crossorigin和Image元素一致，也禁止js读取cssRules（报SecurityError错误）

指定rel="preload"会受到同源限制

### Script

允许加载跨源脚本，跨源脚本中发生的错误能被当前源脚本捕获，但是无法获取完整的错误信息（如行列号、文件和堆栈信息）

指定或未指定crossorigin和Image元素一致

指定type="module"会受到同源限制

### Iframe

允许加载跨源文件，父子window限制和Window中提到的一致

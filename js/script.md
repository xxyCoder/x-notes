## 属性

### type

* text/javascript（默认值），标准的Javascript脚本
* module，ES6脚本模块，支持import和export语法
* importmap，导入映射，定义模块别名
* 其他值（随意取名），浏览器不执行，可以用做存储HTML模块、JSON数据

### defer

* 浏览器并行下载脚本文件，不阻塞页面渲染，脚本文件在DOM解析以及放置在该script之前的css文件下载和解析完成后，DOMContentLoaded事件执行之前执行脚本内容（也就是说defer脚本会阻塞DOMContentLoaded事件执行），保证各个defer script执行顺序

### async

* 浏览器并行下载脚本文件，下载期间不阻塞页面渲染，下载完成后等待script之前的css文件下载和解析，然后才开始执行脚本内容并阻塞页面渲染，不保证script执行顺序，async和defer同时存在，则浏览器按照async来处理

### src

* 指定外部脚本文件位置，默认使用http协议，如果script脚本有内置内容则忽略

### integrity

* 脚本的hash值，确保一致性

### referrerpolicy

* 表示在获取脚本或者脚本获取资源时要发送什么类型的referrer

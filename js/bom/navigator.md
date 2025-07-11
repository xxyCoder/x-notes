## 什么是Navigator

包含了浏览器和系统信息

## 常用属性

* userAgent 表示用户设备信息，但不一定准确（可被代理替换）
* onLine 表示当前用户在线还是离线（浏览器断线），返回true不一定能访问互联网（连接局域网但是局域网不能连接外网）
* geolocation 返回一个Geolocation对象，包含用户地理位置的信息，只能在https协议使用，调用时会给用户弹框要求授权
  * Geolocation.getCurrentPosition() 得到用户当前位置
  * Geolocation.watchPosition() 监听用户位置变化
  * Geolocation.clearWatch() 取消监听
* hardwareConcurrency 实验属性，表示用户计算机可用的逻辑处理器数量
* connection 实验属性，表示用户网络连接相关信息

### cookieEnable

指示是否启用了cookie

当浏览器配置为阻止第三方cookie时，第三方的iframe中调用cookieEnable有可能返回true

## 常用方法

### sendBeacon

在unload之前通过HTTP POST将少量数据异步传输到Web服务器，返回值指明是否成功将数据加入传输队列

无法自定义请求头，不能显式控制是否携带cookie

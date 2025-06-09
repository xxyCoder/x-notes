## Navigator

* userAgent属性返回了浏览器的User Agent字符串，表示用户设备、浏览器厂商、版本、操作系统等信息
* onLine属性表示当前用户在线（只要连接到本地网络即可，无论是否可上网）还是离线（无网络连接）
  * 可以通过监听online和offline事件得知属性值的改变
* languages属性表示用户可接受的语言；language表示用户首选语言（languages[0]），其属性值改变触发languagechange事件
  * 浏览器设置
  * 操作系统设置
  * HTTP Accept-Langugae头
  * 浏览器默认设置
* geolocation属性返回用户地理位置信息，只能在https协议下使用，以下三个方法调用需要弹出对话框要求用户授权
  * getCurrentPosition(success, error, options)得到用户当前位置
  * id = watchPosition(success, error, options)监听用户位置变化
  * clearWatch(id)取消监听
* deviceMemory属性返回当前计算机内存数量，单位为GB，只有在https下可读取，四舍五入到最接近的2的幂
* hardwareConcurrency属性返回当前计算机可用的逻辑处理器数量
* connection属性返回一个对象，表示网络的连接相关信息
  * downlink：有效的带宽值，单位Mbps，四舍五入到每秒 25KB 的最接近倍数
  * effectiveType：返回连接类型，可能取值slow-2g、2g、3g、4g
  * rtt：前连接的估计有效往返时间，四舍五入到最接近的25毫秒的倍数
* cookieEnabled属性指示是否启用了cookie，如果是第三方iframe调用并且浏览器阻止了第三方cookie，Safari、IE等浏览器依然返回true

# 问题

- 支付次数过多时触发3DS验证，有部分用户支付失败原因为没有登录，根据后端接口日志来看，确实是前端没有写入token。

# 代码逻辑

- 使用了三层保险（第一层cookie，第二层localStorage，第三层为全局store）去写入token。
- store存储数据来源是从cookie中读取的。
- 触发3DS验证是接口返回了auth页面的url，前端判断字段后通过iframe进行展示。auth页面会调接口进行3DS验证并在成功后支付。

# 触发可能

1. 用户在支付时清除了cookie和storage并刷新（清除store），但是刷新后又会重新请求接口然后重新设置cookie、storage和store，故不可能；
2. cookie、localStorage和store都读不到数据，百度了一下，ios safari在禁止cookie的模式下是无法使用cookie和storage的，使用会报错，这样一来，cookie没法存储数据，那么store中也无法存储。
   1. 对照打点看了一下，有个用户触发3DS后在当前页面卡住了，因为后续流程是从cookie中读取数据后才会进行下一步

# 解决方法

1. 在iframe中展示页面时候，给iframe的url拼接t=token
   1. 发起请求时候，referer可能会泄漏token，故需要改变referer策略
   2. url有长度限制，目前看起来长度应该够
2. 双向通信，将token传递过去
3. 后端返回3DS的url时候携带一个针对该用户的临时token

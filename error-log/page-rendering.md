## 渲染不符合预期

* Safari表现
  ![](https://lightweight.feishu.cn/space/api/box/stream/download/asynccode/?code=NjQxOGNlMWE4YjcyYmFlZWM4NzIzOTgyYWY4Zjk4MmZfcWdVc3NwRTA2Z0t2TmV0eHlXVnE4eWl1a1FrUjNtdzdfVG9rZW46THpOU2JKdEZKb0czTm14elB6cmNuU2k4bmNoXzE3NDAxMDkyMTA6MTc0MDExMjgxMF9WNA)
* Chrome表现
  ![](https://lightweight.feishu.cn/space/api/box/stream/download/asynccode/?code=ZDJmNDcwZTFkYzk1ZTQ1OTBiNjg1MDc1NzJhZWQzMDNfa1l3UERMUG9OSlFNdFRxVnYydHB1TU5EeEZNQU1rYkVfVG9rZW46Sjh0NGJDVEQ0b2RYenV4cTAxWWM5WTZ6bmxqXzE3NDAxMDkyMTA6MTc0MDExMjgxMF9WNA)

### 检查元素排查原因

* 项目css使用的是tailwindcss，结构整体flex布局（左侧图片+右侧登录选项）设置了width: 1200px，左侧图片设置width: 540px，右侧登录选项设置为width: 100%和flex: 1，登录选项中的Email登录整体设置width: 100%。如图所示：
  ![](https://lightweight.feishu.cn/space/api/box/stream/download/asynccode/?code=ZmRkOWFkY2JhZWY4ZDlmOTc4YzIwM2FjYjI0ZTNjNmNfREZtUllHTnVucHpmdzh4M0JTZG1SZDBSVEs0VjU2QzRfVG9rZW46R3NqRWJMWjhLb1FKNUt4QXhzOWNwYXRabmFnXzE3NDAxMDkyMTA6MTc0MDExMjgxMF9WNA)
* 右侧登录设置width:100%的话那么width实际是1200px，但是由于设置了flex:1，所以占据剩余可用宽度(1200 - 540)px = 660px，右侧登录内部可用宽度为660 - 200(左右padding) = 460px；
* 对比元素宽度发现，只有input框渲染在两个浏览器中是不一致的，单独渲染input发现，在Safari下宽度317px，而Chrome下宽度为169px，导致Safari的渲染宽度导致右侧容器的width大于660px（flex布局为了不让内部元素超出容器，需要将内部元素宽度进行收缩）；
  * 在使用tailwindcss的项目中，两个渲染器渲染input宽度差距并不大

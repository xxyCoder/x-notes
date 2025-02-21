## 渲染不符合预期

* Safari表现
  ![](https://lightweight.feishu.cn/space/api/box/stream/download/asynccode/?code=NmE1OTljYTMyZGQyYzhlYzNhZmU1MWE2MTM0ZWJjYzJfNGlVUDVoY2FPY2p1djlselB4cG54MlA3WmNvREd3RE9fVG9rZW46THpOU2JKdEZKb0czTm14elB6cmNuU2k4bmNoXzE3NDAxMTEzNTM6MTc0MDExNDk1M19WNA)
* Chrome表现
  ![](https://lightweight.feishu.cn/space/api/box/stream/download/asynccode/?code=MDEyMWMwOTAwN2M2MjViMTJlN2E0Yjk3M2UyOTU2YmNfSXRmQUlBNEF4ZWJhS0NDcUh0RG56R1UxN3BiWVVIZDVfVG9rZW46Sjh0NGJDVEQ0b2RYenV4cTAxWWM5WTZ6bmxqXzE3NDAxMTEzNTM6MTc0MDExNDk1M19WNA)

### 检查元素排查原因

* 项目css使用的是tailwindcss，结构整体flex布局（左侧图片+右侧登录选项）设置了width: 1200px，左侧图片设置width: 540px，右侧登录选项设置为width: 100%和flex: 1，登录选项中的Email登录整体设置width: 100%。如图所示：
  ![](https://lightweight.feishu.cn/space/api/box/stream/download/asynccode/?code=YTczMWUzNGJiZGRkMTljY2M2M2NjZmJjN2QwM2ZiY2FfVWhNTmo3TE9FUXI1MmtaUFdKbkhEejdJa1hEUUZhOUVfVG9rZW46R3NqRWJMWjhLb1FKNUt4QXhzOWNwYXRabmFnXzE3NDAxMTEzNTM6MTc0MDExNDk1M19WNA)
* 右侧登录设置width:100%的话那么width实际是1200px，但是由于设置了flex:1，所以占据剩余可用宽度(1200 - 540)px = 660px，右侧登录内部可用宽度为660 - 200(左右padding) = 460px；
* 对比元素宽度发现，只有input框渲染在两个浏览器中是不一致的，单独渲染input发现，在Safari下宽度317px，而Chrome下宽度为169px，导致Safari的渲染宽度导致右侧容器的width大于660px（flex布局为了不让内部元素超出容器，需要将内部元素宽度进行收缩）；
  * 在使用tailwindcss的项目中，两个渲染器渲染input宽度差距并不大

## 文件按钮

前提：设置font-size: 0目的是为了隐藏“未选择任何文件"的文字；

```HTML
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Document</title>
  <style>
    ::file-selector-button {
      height: 10px;
      width: 100px;
      border: 10px solid red;
      background-color: aqua;
    }
    input {
      font-size: 0;
    }
  </style>
</head>

<body>
  <input type="file" name="" id="">
</body>

</html>
```

* Safari渲染完整

![](https://lightweight.feishu.cn/space/api/box/stream/download/asynccode/?code=YTFkNWI5M2ZjMTdkMjIxZjIwNmYwODk3NjU2Y2VlYmNfSGxLQjJaU0k0cWFvUTI2UkYyZGs4dkNXa3FVQ1h0ekRfVG9rZW46UGhTZ2JUNDQwb2FuSVh4eUxWUGN0cjhKbnFnXzE3NDAxMTEzNTM6MTc0MDExNDk1M19WNA)

* Chrome选项则被截断

![](https://lightweight.feishu.cn/space/api/box/stream/download/asynccode/?code=YjY4NTE2NzFhN2YzOGMyYzY5ZGM1MGY4NzZhN2Q0NzdfZVNNdGtzOEhiSFFhd3pYRThOQUhhSDRpNmRkNGRwZGFfVG9rZW46TUM5ZWJvUTlOb2hmSER4MjkwMGNsN2psbkZmXzE3NDAxMTEzNTM6MTc0MDExNDk1M19WNA)

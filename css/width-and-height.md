## width的作用细节

### 默认值auto的四种表现

1. 充分利用可用空间，如div、p这种表现为占据整个水平流宽度，其margin、border、padding和content自动分配水平空间；
   ![](https://lightweight.feishu.cn/space/api/box/stream/download/asynccode/?code=Y2MyNThkODNiYTc3ZmI0MjhhMDhkZjMyOGE4Mzg1NzJfV2NHQlhKUkY1VjRabUxYdXFiUUF0STZyMkowSXQxeXdfVG9rZW46THloa2JOUEYwb2U4V3R4WXU4NWNiTDN5bk05XzE3NDA1NTUzNDI6MTc0MDU1ODk0Ml9WNA)
2. 收缩与包裹，如浮动元素、inline-block、table或绝对定位（没设置对位属性），表现为根据宽度随内容撑开，但是不超过包含块的宽度；
   ![](https://lightweight.feishu.cn/space/api/box/stream/download/asynccode/?code=ZGIxODU2NDIyYjQ3MzVjYjIyNDEyYzUxZmUwMjhiMGZfbElXNzIzNkF2SWF5aDZXR0JPak1TbHd1TkQ4Z2g0ZHpfVG9rZW46QVBKU2JMdTZIb0gwam54YVBqRWM1V1dqbjNiXzE3NDA1NTUzNDI6MTc0MDU1ODk0Ml9WNA)
3. 收缩到最小，容易出现父元素宽度较小或者display: min-content，表现为一个中文字符或连续不间断英文字符占据的宽度；
   ![](https://lightweight.feishu.cn/space/api/box/stream/download/asynccode/?code=MGY2MTA0OWQ2NTNhMjY1NzdlNmQ3Mzk5MGQ3MWM1Y2RfQlJOQkoxclpHMGpDbmpvbGNJRDVZRExoM0Vqb1hvbDdfVG9rZW46TEYwNmJXYmd4bzBGTmt4S3h1N2NTa2FNbk1iXzE3NDA1NTUzNDI6MTc0MDU1ODk0Ml9WNA)
4. 超出容器宽度限制，一般出现在连续不可间断的英文字符或者设置了white-space: nowrap情况；
   ![](https://lightweight.feishu.cn/space/api/box/stream/download/asynccode/?code=NzA5MWY5Njg1NTcwOTdhYWVmNGQwN2RkMjgwYmM1ZDdfaTFVdFlqZ2dtb3dEb09mN2JCbEV5d25heEJpUW9VYXZfVG9rZW46VFY0WmJBSGZUb3JoYUt4Vlcyd2NEZmxpbjRnXzE3NDA1NTUzNDI6MTc0MDU1ODk0Ml9WNA)

### 元素width: 100%的表现

* “如果包含块的宽度取决于该元素的宽度，那么产生的布局在CSS 2.1中是未定义的。” ，既然是未定义，那么具体实现由各个浏览器厂商决定，目前来看表现都一致，表现如下：

1. 渲染是从外往内的，父元素的width: auto时宽度取决元素宽度是收缩与包裹的情况；
2. 先计算出子元素占据水平流总宽度后，子元素按照父元素宽度 * 100%计算

   ![](https://lightweight.feishu.cn/space/api/box/stream/download/asynccode/?code=Zjk4YmQ5NDdmMGVhYTIwOGViNjVmMzI0OWE0MDZmMGFfeUpCTGtDRlBQcHd6aUt0V3BpREJWVzlvTHNVaEJaaVRfVG9rZW46VExENWJtZ2ppb3czTGx4MlpSdWNyU0ljbmVoXzE3NDA1NTUzNDI6MTc0MDU1ODk0Ml9WNA)

   ![](https://lightweight.feishu.cn/space/api/box/stream/download/asynccode/?code=Nzg2MjNmNzI0MTNiNzliMjRlM2Y5MWE5YmNiNGE2NTlfVTB1ZGNVOVlOTmtlMDhGSmc5SGYwOGxwZzAzRVZ1dHJfVG9rZW46SXBtZmJLSkNKb01BSFV4U2dPU2NPdVF4bnlkXzE3NDA1NTUzNDI6MTc0MDU1ODk0Ml9WNA)

## 元素height: 100%的表现

* 如果包含块的高度没有显式指定（即高度由内容决定），并且该元素不是绝对定位，则计算值为auto。一句话总结就是：因为解释成了auto。要知道，auto和百分比计算，肯定是算不了的；

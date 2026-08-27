## attachment

* 如果指定了background-image，那么background-attachment决定背景是在视口中固定还是随着包含它的区块滚动

1. scroll：背景图随着元素本身滚动，而不随着元素内部内容滚动
2. fixed：相对浏览器适口固定，不随页面或元素内容滚动
3. local：随着元素内容滚动而滚动

## color

* 会填充整个元素（包括border，只不过border-color盖住了background-color），不受origin、position影响

## image

* 一个元素如果display计算值为none，在IE浏览器下（IE8～IE11，更高版本不确定）依然会发送图片请求，Firefox浏览器不会，具体看浏览器如何支持。

## origin

* 决定了position定位起点，默认是padding-box

## position

* 指定background-image偏移位置，缺省值为center

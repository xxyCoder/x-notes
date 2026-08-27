## 风格分类

1. 衬线体：字母笔画末端有“衬线"或”爪形"，如Times New Roman、宋体
2. 无衬线体：字母笔画末端没有装饰性衬线，线条粗细相对均匀，如Roboto、黑体
3. 等宽字体：每个字符占据完全相同的水平空间，如Courier New
4. 手写体：线条流畅自然，常有连笔，如Brush Script
5. 装饰体/展示体：设计夸张、独特，主要用户标题、海报等需要吸引眼球的地方，如Impact

## 存储格式

1. TTF使用二次贝塞尔曲线定义[字体轮廓](https://photopea.github.io/Typr.js/)
2. OTF使用PostScript曲线定义字体
3. WOFF对TTF或OTF使用无损压缩
4. WOFF2是在WOFF上使用更好的压缩算法

## 字体优化

### @font-face

使用font-face声明的字体不会向服务器发送下载请求，只有在页面中使用才会进行下载

### unicode-range

可以通过unicode-range+字体子集化进一步优化，只有当页面使用了unicode-range声明范围中的字符才会进行下载（目前测试Safari可能会无视unicode-range）

### Local

local()可以检查用户是否已在本地安装过该字体，如果是则不才会从网络上下载字体文件

### 按需加载

获取前端用到的文字获取需要生成的字体集

```JavaScript
[...new Set(fontFamilies)].forEach((fontName) => {
  // 在字体库中找到对应字体详细信息
  const obj = fontLibrary.find((el) => el?.value === fontName) ?? {};

  if (obj.value && obj.src) {
    const text = textMap[obj.value].join('');
    const font = new FontFace(
      obj.value,
      `url(http://127.0.0.1:5000/font/${obj.value}?text=${text}&format=woff2)`
    );
    // 加载字体
    font.load();
    // 添加到文档字体集中
    document.fonts.add(font);
  }
});
```

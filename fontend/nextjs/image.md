# Next.js 图片：构建产物、CDN、loader 与 unoptimized 的完整流程

本文基于 **Next.js v16.0.0 的 Webpack 构建实现和 `next/image` 组件**，不包含 `next/legacy/image`。这是用于解释机制的固定源码版本，不代表当前项目使用的版本；Turbopack 也不通过本文中的 Webpack loader 执行构建。

## 1. 首先分清：两个 loader、两种路径、一个接口

### 1.1 两个不同的 loader

| 名称  | 执行阶段 | 职责 |
| --- | --- | --- |
| `next-image-loader` | Webpack 处理图片 `import` 时 | 生成哈希文件名、输出图片文件、读取图片信息、拼接 `assetPrefix`，导出图片信息对象 |
| `defaultLoader` | `<Image>` 生成图片属性时 | 接收原图 URL、候选宽度和质量，返回 `/_next/image?...` 字符串 |


- `images.loader`、`images.loaderFile`、`<Image loader={...}>` 配置的是第二类 loader，不负责修改 Webpack 的图片输出目录。
- `unoptimized: true` 会跳过第二类 loader 的 URL 生成，但不阻止第一类 loader 处理图片 import、输出静态文件。

### 1.2 磁盘路径和 URL 路径

```text
磁盘构建目录：.next
静态资源 URL 前缀：/_next/static
```

磁盘路径和 URL 不需要同名。Next.js 服务端通过路由把 URL 映射到磁盘文件；CDN 部署时则要通过上传路径或 CDN 映射保证 URL 对应正确文件。

### 1.3 `/_next/image` 是接口，不是目录

```text
/_next/static/media/photo.a1b2c3d4.jpg
→ 静态图片资源 URL

/_next/image?url=...&w=640&q=75
→ 图片优化接口 URL
```

这里的 `...` 仅表示被编码的原图地址，后文给出完整拼接示例。

默认优化流程是收到图片请求后按需处理，并不是构建时把不同尺寸图片提前放进一个名为 `/_next/image` 的目录。

## 2. 一个贯穿全文的例子

配置文件：

```js
// next.config.js
module.exports = {
  assetPrefix: "https://cdn.example.com/assets",
  images: {
    unoptimized: true,
  },
};
```

页面组件：

```jsx
import Image from "next/image";
import photo from "./photo.jpg";

export default function Page() {
  return (
    <Image src={photo} width={400} height={300} alt="照片" />
  );
}
```

为方便追踪，假设：

- 原图尺寸是 1600 × 1200。
- 本次生成的八位哈希是 `a1b2c3d4`。
- CDN 域名和 `/assets` 均为示例，需要替换为实际部署配置。
- 没有额外的 `basePath`、`overrideSrc` 或自定义图片 loader。

## 3. 构建阶段：谁生成 `.next/static/media/photo.哈希.jpg`？

Webpack 遇到：

```js
import photo from "./photo.jpg";
```

就通过 Next.js 内置的 **`next-image-loader`** 处理图片。

### 3.1 生成文件名

源码使用的模板是：

```text
/static/media/[name].[hash:8].[ext]
```

本例展开为：

```text
"/static/media/"
+ "photo"
+ "."
+ "a1b2c3d4"
+ ".jpg"

= "/static/media/photo.a1b2c3d4.jpg"
```

随后，loader 通过 Webpack 文件输出机制把图片内容写入构建产物。默认磁盘文件位置可理解为：

```text
构建目录 + 静态资源相对路径

".next"
+ "/static/media/photo.a1b2c3d4.jpg"

= ".next/static/media/photo.a1b2c3d4.jpg"
```

哈希文件名用于区分内容版本，方便缓存。这里输出的主体图片仍是原图内容，不是按 `<Image width={400}>` 缩放后的版本。

构建阶段可以读取图片尺寸，并为支持的图片生成模糊占位信息；这与提前生成一组供 `srcset` 使用的全尺寸优化图片不是一回事。

### 3.2 用 `assetPrefix` 生成图片 URL

源码拼接关系为：

```text
outputPath = assetPrefix + "/_next" + interpolatedName
```

代入本例：

```text
"https://cdn.example.com/assets"
+ "/_next"
+ "/static/media/photo.a1b2c3d4.jpg"

= "https://cdn.example.com/assets/_next/static/media/photo.a1b2c3d4.jpg"
```

如果不设置 `assetPrefix`，对应前缀为空：

```text
""
+ "/_next"
+ "/static/media/photo.a1b2c3d4.jpg"

= "/_next/static/media/photo.a1b2c3d4.jpg"
```

**`assetPrefix` 改的是访问 URL，不会改变图片在本地的输出位置，也不会自动上传图片。**

### 3.3 导出图片信息

构建后的 `photo` 可以理解成如下对象，省略模糊占位等字段：

```js
{
  src: "https://cdn.example.com/assets/_next/static/media/photo.a1b2c3d4.jpg",
  width: 1600,
  height: 1200
}
```

因此 `<Image src={photo}>` 拿到的并不是磁盘路径，而是含有图片 URL 和尺寸信息的对象。

源码：[next-image-loader](https://github.com/vercel/next.js/blob/v16.0.0/packages/next/src/build/webpack/loaders/next-image-loader/index.ts#L15)。

## 4. 为什么构建在 `.next`，访问 `/_next` 却能成功？

### 4.1 请求由 Next.js 服务处理时

Next.js 内置了这样的静态资源映射：

```text
请求 URL：/_next/static/后面的路径
    ↓
磁盘文件：项目目录/<distDir>/static/后面的路径
```

`distDir` 默认是 `.next`。例如浏览器请求：

```text
/_next/static/media/photo.a1b2c3d4.jpg
```

服务端处理过程是：

```text
① 识别 /_next/static 前缀

② 移除该前缀
   剩余：/media/photo.a1b2c3d4.jpg

③ 确定静态文件根目录
   项目目录 + distDir + "/static"
   默认：项目目录/.next/static

④ 拼接实际磁盘路径
   项目目录/.next/static
   + /media/photo.a1b2c3d4.jpg

⑤ 读取文件并返回内容
```

这不是浏览器自动把 `_next` 换成 `.next`，也不要求磁盘上存在 `_next` 目录。是 Next.js 服务端执行了映射。

源码：[静态资源根目录](https://github.com/vercel/next.js/blob/v16.0.0/packages/next/src/server/lib/router-utils/filesystem.ts#L149)、[移除 URL 前缀并拼接磁盘路径](https://github.com/vercel/next.js/blob/v16.0.0/packages/next/src/server/lib/router-utils/filesystem.ts#L629)。

### 4.2 文件上传到 CDN 对象存储时

CDN 后面如果是对象存储，而不是 Next.js 服务，就没有 Next.js 帮你完成上述映射。

对于本文的配置，必须保证：

```text
本地文件：
.next/static/media/photo.a1b2c3d4.jpg

可访问 URL：
https://cdn.example.com/assets/_next/static/media/photo.a1b2c3d4.jpg
```

如果 CDN 的 URL 路径直接对应对象存储路径，就应当上传成：

```text
对象键：assets/_next/static/media/photo.a1b2c3d4.jpg
```

整体上传映射为：

```text
.next/static/ 的内容
    ↓
assets/_next/static/
```

如果 CDN 有额外的源站路径或路径重写，上传路径可以不同，但最终访问 URL 必须能够取到该文件。

**若直接按 `.next/static/...` 上传，又没有配置任何映射，那么访问 `/_next/static/...` 会找不到文件。**

用于静态资源 CDN 的是 `.next/static/`，不要把整个 `.next/` 当成静态资源目录上传。

文档：[assetPrefix 与上传路径](https://nextjs.org/docs/app/api-reference/config/next-config-js/assetPrefix)。

## 5. 能修改哪些路径？

| 需求 | 配置 | 影响 |
| --- | --- | --- |
| 把磁盘构建目录 `.next` 改成 `build` | `distDir: "build"` | 磁盘产物变成 `build/static/media/...` |
| 修改 CDN 域名，或在 URL 前增加目录 | `assetPrefix` | 修改生成的静态资源 URL 前缀 |
| 把内置 `/_next/static/media/` 直接替换为 `/pictures/` | 没有直接对应的普通配置项 | 需要额外构建处理或资源 URL、部署路径映射方案 |

例如：

```js
module.exports = {
  distDir: "build",
  assetPrefix: "https://cdn.example.com/assets",
  images: {
    unoptimized: true,
  },
};
```

结果是：

```text
磁盘文件：
build/static/media/photo.a1b2c3d4.jpg

访问 URL：
https://cdn.example.com/assets/_next/static/media/photo.a1b2c3d4.jpg
```

`distDir` 不会把 URL 中的 `/_next` 变为 `/build`。`assetPrefix` 是在内置路径前添加前缀，也不会替换中间的 `/_next/static/media/`。

`images.path` 配置的是图片优化接口地址，不能拿来修改静态图片输出目录。

文档：[distDir](https://nextjs.org/docs/app/api-reference/config/next-config-js/distDir)。

## 6. `unoptimized` 在哪里生效？

构建阶段生成图片文件和 `photo.src` 后，`<Image>` 的属性生成流程是：

```text
读取图片来源
    ↓
如果 src 是静态 import 对象，取出对象的 src 字符串
    ↓
结合组件属性和全局配置，确定 unoptimized
    ↓
generateImgAttrs() 生成 src、srcSet、sizes
    ↓
渲染原生 <img>
```

对于普通 JPG，全局与组件属性的关系为：

| 全局 `images.unoptimized` | 组件 `unoptimized` | 最终结果 |
| --- | --- | --- |
| `false` | 不传或 `false` | 进入候选宽度和 URL 生成流程 |
| `false` | `true` | 直接使用源地址 |
| `true` | 任意值，包括显式 `false` | 直接使用源地址 |

全局 `true` 会强制关闭优化。`data:`、`blob:` 图片，以及默认 loader 下未允许 SVG 优化的 `.svg` 图片，会自动进入跳过优化的分支。

下面两个分支都假设主体图片为普通 JPG，没有 `overrideSrc`。

## 7. `unoptimized: true`：完整流程

### 7.1 构建照常进行

```text
import photo from "./photo.jpg"
    ↓ next-image-loader
输出 .next/static/media/photo.a1b2c3d4.jpg
    ↓
photo.src =
assetPrefix + "/_next" + "/static/media/photo.a1b2c3d4.jpg"
    ↓
https://cdn.example.com/assets/_next/static/media/photo.a1b2c3d4.jpg
```

### 7.2 生成属性时提前返回

`generateImgAttrs()` 判断 `unoptimized` 为 `true`，直接返回源地址，并令 `srcSet`、`sizes` 为 `undefined`。

因此跳过：

- 候选宽度计算。
- `defaultLoader` 或自定义图片 URL loader 的调用。
- `srcset` 生成。
- `/_next/image` 优化 URL 的拼接。

本例生成的相关 HTML 为：

```html
<img
  src="https://cdn.example.com/assets/_next/static/media/photo.a1b2c3d4.jpg"
  width="400"
  height="300"
  loading="lazy"
  alt="照片"
/>
```

### 7.3 浏览器直接加载文件

```text
浏览器读取 src
    ↓
直接请求 CDN URL
    ↓
CDN 命中缓存，或从源站取回上传的文件
    ↓
返回图片
    ↓
浏览器按页面布局显示
```

显示尺寸变小，不等于图片文件被压缩。即使显示为 400 × 300，浏览器仍下载上传的那张原图；需要提前压缩时，应由其他构建步骤或图片服务完成。

### 7.4 仍然保留和不再生效的能力

- 懒加载、宽高预留布局空间等能力仍可使用。
- 传入 `sizes` 也不会生成 `sizes` 或 `srcset` 属性。
- 不会调用自定义图片 loader 给 URL 添加 CDN 前缀。需要在源地址中已有前缀，或通过静态 import 的 `assetPrefix` 生成。
- 浏览器和 CDN 仍可正常缓存图片；关闭的是 Next.js 图片优化，不是所有缓存。

## 8. `unoptimized: false`：完整流程

此节保留 `assetPrefix`，将全局 `unoptimized` 改为 `false`，使用默认图片 loader。图片来源需要通过相应来源校验。

### 8.1 构建阶段不变

```text
next-image-loader 处理 import
    ↓
输出带哈希的静态图片
    ↓
生成带 assetPrefix 的 photo.src
```

与 `true` 的差异从 `<Image>` 生成属性时开始。

### 8.2 候选宽度从哪里来？

v16.0.0 的默认档位为：

```js
deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840]
imageSizes: [32, 48, 64, 96, 128, 256, 384]
```

- `deviceSizes` 提供覆盖较大图片、整屏图片需求的宽度。
- `imageSizes` 补充头像、图标、缩略图等较小宽度。
- 它们不是电脑和手机的分类，也不是 CSS 媒体查询断点。
- 它们决定可生成的候选档位，不代表对应图片已提前生成。

内部先将两个数组合并并升序排列为 `allSizes`，再根据组件属性决定如何选择：

| 输入 | 选择规则 | `srcset` 描述符 |
| --- | --- | --- |
| 有数值 `width`，没有 `sizes` | 用 `width`、`width × 2` 在 `allSizes` 中向上匹配档位，并去重；超出最大档位时取最大值 | `1x`、`2x` |
| 有非空 `sizes` | 使用 `allSizes`；若识别到 `vw`，用最小 `vw` 比例做候选下限过滤 | `384w`、`640w` 等 |
| 没有数值 `width`，也没有 `sizes`，例如使用 `fill` | 使用 `deviceSizes`，补 `sizes="100vw"` | 宽度描述符 |

本例 `width={400}`、没有 `sizes`：

```text
1 倍目标：400 → 第一个不小于 400 的档位 → 640
2 倍目标：800 → 第一个不小于 800 的档位 → 828

候选宽度：[640, 828]
```

若 `width={64}`，则通常得到 `[64, 128]`。因此固定宽度图片也会用到 `imageSizes` 中的档位。

可以在 `next.config.js` 的 `images.deviceSizes`、`images.imageSizes` 中配置自有数组，替换对应默认值。

有 `sizes` 时，例如 `sizes="(max-width: 768px) 100vw, 50vw"`，源码提取最小比例 50%，以 `640 × 0.5 = 320` 为下限过滤档位，所以候选从 384 开始。Next.js 并不在此测量实际 DOM；完整 `sizes` 表达式交给浏览器，用于选择合适资源。

### 8.3 默认图片 loader 如何拼 URL？

默认 `defaultLoader` 只生成 URL 字符串，不发请求，也不处理图片。

本例的拼接公式是：

```text
images.path
+ "?url="
+ encodeURIComponent(原图 src)
+ "&w="
+ 候选宽度
+ "&q="
+ 质量参数
```

默认 `images.path` 为 `/_next/image`。本例质量参数为 75，原图地址为：

```text
https://cdn.example.com/assets/_next/static/media/photo.a1b2c3d4.jpg
```

宽度 640 时，完整拼接为：

```text
"/_next/image"
+ "?url="
+ "https%3A%2F%2Fcdn.example.com%2Fassets%2F_next%2Fstatic%2Fmedia%2Fphoto.a1b2c3d4.jpg"
+ "&w=640"
+ "&q=75"

= /_next/image?url=https%3A%2F%2Fcdn.example.com%2Fassets%2F_next%2Fstatic%2Fmedia%2Fphoto.a1b2c3d4.jpg&w=640&q=75
```

宽度 828 时再调用一次，生成另一个 URL。

`q=75` 是编码质量参数，不表示体积缩为原来的 75%。

**`assetPrefix` 在原图 URL 中，不会自动加到外层 `/_next/image` 前面。**

### 8.4 `srcset` 和 HTML 的 `src` 分别怎么生成？

```text
srcset：
    640 宽度的 loader 返回值 + " 1x"
    + ", "
    + 828 宽度的 loader 返回值 + " 2x"

src：
    使用最大的候选宽度 828，再调用 loader 得到 URL
```

也就是说，在这个例子中，生成属性阶段对 loader 有两次候选 URL 调用和一次 `src` URL 调用；它们都是函数调用，不是三次 HTTP 请求。

对应 HTML，省略其他属性：

```html
<img
  srcset="
    /_next/image?url=https%3A%2F%2Fcdn.example.com%2Fassets%2F_next%2Fstatic%2Fmedia%2Fphoto.a1b2c3d4.jpg&w=640&q=75 1x,
    /_next/image?url=https%3A%2F%2Fcdn.example.com%2Fassets%2F_next%2Fstatic%2Fmedia%2Fphoto.a1b2c3d4.jpg&w=828&q=75 2x
  "
  src="/_next/image?url=https%3A%2F%2Fcdn.example.com%2Fassets%2F_next%2Fstatic%2Fmedia%2Fphoto.a1b2c3d4.jpg&w=828&q=75"
  width="400"
  height="300"
  alt="照片"
/>
```

### 8.5 谁选择实际请求地址？

Next.js 生成候选集合。浏览器结合描述符、像素密度，以及宽度描述符场景下的 `sizes` 等信息选择资源。

本例通常表现为：

- DPR 为 1 时，选择标记为 `1x` 的候选。
- DPR 为 2 时，选择标记为 `2x` 的候选。
- 不支持 `srcset` 时，使用 `src`。

实际选择还可能受缓存等因素影响，不能把某个 DPR 与候选绝对绑定。

**HTML 的 `src` 不等于浏览器最终选中的 URL。** 浏览器不需要改写 `src` 属性；实际选择结果可从图片 DOM 元素的 `currentSrc` 查看。

也不是先把 `src` 下载一次，再把 `srcset` 所有候选下载一遍。

普通 `<img>` 若只有 `src`、没有其他候选来源，浏览器不会自行猜测其他尺寸的 URL。

### 8.6 服务端何时处理图片？

假设浏览器选择 640 宽的优化 URL：

```text
浏览器请求本站 /_next/image?...&w=640&q=75
    ↓
Next.js 图片接口校验来源与参数
    ↓
按原图 URL、宽度、质量、输出格式等查找优化缓存
    ├─ 有有效缓存 → 直接返回
    └─ 没有缓存
           ↓
       从 url 参数指定的 CDN 地址获取原图
           ↓
       缩放、编码，并根据配置和浏览器支持选择输出格式
           ↓
       缓存处理结果
           ↓
       返回图片内容
```

普通 Node 自部署默认将优化结果缓存到 `<distDir>/cache/images`，默认即 `.next/cache/images`。过期缓存还有重新验证逻辑，不等同于每次都重新处理；托管平台也可能接管优化和缓存。

原图不会被覆盖。通常只处理被请求的版本，不会因为列出了候选就提前生成所有版本；默认缩放逻辑也不会把较小原图强行放大到请求宽度。

**仅设置 `assetPrefix`，仍会走以上优化链路；设置 `unoptimized: true` 后才直接使用原图 CDN URL。**

源码：[候选与属性生成](https://github.com/vercel/next.js/blob/v16.0.0/packages/next/src/shared/lib/get-img-props.ts)、[默认 URL loader](https://github.com/vercel/next.js/blob/v16.0.0/packages/next/src/shared/lib/image-loader.ts)、[图片请求与缓存](https://github.com/vercel/next.js/blob/v16.0.0/packages/next/src/server/next-server.ts#L963)、[图片处理实现](https://github.com/vercel/next.js/blob/v16.0.0/packages/next/src/server/image-optimizer.ts)。

## 9. 全局关闭与单图关闭的区别

- 全局 `images.unoptimized: true`：所有 `<Image>` 都跳过优化 URL 生成，普通 Node 服务中的内置 `/_next/image` 接口也返回 404。
- 只对某个组件设置 `<Image unoptimized>`：这张图片直接使用源地址，但不关闭整个站点的图片优化接口。

上述接口行为针对本文固定版本的普通 Node 服务，不泛化到托管平台的独立图片服务。

另外，`ImageProps` 排除了原生 `srcSet` 属性，运行时也会删除外部传入的 `srcSet`：

- `unoptimized: false`：使用 Next.js 内部生成的 `srcset`。
- `unoptimized: true`：不生成 `srcset`。
- 需要完全自己管理候选列表时，使用原生 `<img srcSet={...}>`，或按需求设计其他响应式图片方案。

## 10. `public` 图片与 import 图片的区别

### 10.1 通过 import 引入

```jsx
import photo from "./photo.jpg";

<Image src={photo} alt="照片" />
```

会执行构建时的 `next-image-loader`，生成哈希图片，并将 `assetPrefix` 拼进导出的 `src`。

### 10.2 通过字符串引用 public 文件

```jsx
<Image src="/photo.jpg" width={400} height={300} alt="照片" />
```

这个字符串对应 `public/photo.jpg`，没有图片 import：

- 不会由该构建 loader 生成哈希文件名。
- 不会自动添加 `assetPrefix`。
- 全局 `unoptimized: true` 时，浏览器仍请求当前站点的 `/photo.jpg`。

如果要从 CDN 加载，需要单独上传文件，并明确写 CDN URL，或通过统一的资源地址函数补前缀：

```jsx
<Image
  src="https://cdn.example.com/assets/photo.jpg"
  width={400}
  height={300}
  alt="照片"
/>
```

这时配合 `unoptimized: true`，浏览器直接访问上述地址。`public` 文件不在 `.next/static/` 上传范围里，需要单独处理。

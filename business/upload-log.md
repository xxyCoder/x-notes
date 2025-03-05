## 浏览器存储API

1. Storage API
2. Cookie
3. IndexedDB
4. Caches API [精读《Caches API》_缓存](https://www.sohu.com/a/289464290_500651)
5. Origin Private File System [Web 文件系统(OPFS 及工具)介绍 | 风痕 · 术&amp; 思](https://hughfenghen.github.io/posts/2024/03/14/web-storage-and-opfs/)

### 对比存储API

1. Storage容量不是很大，考虑到上传会失败导致堆积xlog数据，大大减少storage可以使用的剩余空间；
2. Cookie同上；
3. Caches API不适合，是针对 Request Response 的；
4. OPFS兼容性不是很好，根据mixpanel可知有用户是ios safari 15.1版本以及更低版本的
   ![](https://lightweight.feishu.cn/space/api/box/stream/download/asynccode/?code=YWZmMjg4MzBhMTVmMTU5OTc2ZWVjZjI3OGI1YjY4OGJfeHlBQTV3MFg3Zjh6VDl3R3hkS0I1NWk1T21Na3ZJRWhfVG9rZW46UklVMmJlcUNHb01zcGx4TEE0TmNxNU9LbnBmXzE3NDAwNDc3MDc6MTc0MDA1MTMwN19WNA)
5. Indexed DB兼容性较好，存储容量大，可以存储任意数据类型

## 具体实现

1. 照搬了Support Chat实现思路，将数据和方法集成在一个类中操作，同时开启一个Web Worker，在Worker中执行数据的读写操作；
2. 还需要考虑到数据上传后需要删除数据，此时indexed DB中可能被写入了新数据，不能直接一次性清空indexed DB，所以需要记录上传到数据有哪些，从而针对性删除；
3. 最后上报的时候根据时间戳排序，indexed DB读出来的数据可能是乱序的。

## 遇到的问题

### Web Worker跨域了？

```JavaScript
import xlog from './xlog-worker.ts'

new Worker(xlog)
```

* 通过引入文件形式创建worker在本地运行没有任何问题，当发到测试服时，网页直接白屏了，打开控制台发现报同源策略的错误。查看了一下xlog文件的url发现文件是位于cdn下的，和网站不同源（Web Worker有同源限制）；
* 解决办法是将文件放入public目录下保证文件请求url和网站同源，然后通过fetch获取而不是文件引入 [Web Worker 同源策略报错解决方案](https://lwebapp.com/zh/post/web-worker#google_vignette) 。

#### 怎么使用TS呢？

* 我看了一下项目应该是使用webpack进行打包的，打包规则并不会让webpack处理public下的文件，仅仅是将public下文件复制到打包目录下；
* 考虑在根目录下新建一个目录为tworkers，配置新的tsconfig针对workers目录下的文件进行编译为js并将结果存放在public/workers下，在package.json添加新命令，每次改动了执行即可（改动频率不是很大，就不想在dev命令中添加监听xlog文件改变）：[在next中使用web worker](https://medium.com/@ngrato/harnessing-the-power-of-web-workers-with-next-js-350901a99a10)。
  * 由于workers目录下文件并没有被引用，打包的时候并不会处理这部文件也不会将其添加到打包产物中，所以并不会增加产物体积。

```JSON
// workers/tsconfig.json
{
  "compilerOptions": {
    "baseUrl": ".",
    "moduleResolution": "node",
    "allowSyntheticDefaultImports": true,
    "sourceMap": false,
    "outDir": "../public/workers",
    "module": "ES6",
    "noEmit": false,
    "noImplicitAny": true,
  },
  "include": [
    "./"
  ],
  "exclude": [
    "node_modules"
  ]
}
```

```JSON
// package.json
"workers:tsc": "tsc --project workers/tsconfig.json;"
```

### IOS Safari禁用cookie同时也会将Indexed DB禁止了怎么办？

* 最好的办法是写一个抽象接口，对外抛出统一的使用方法；
* 浏览器存储的API已经没有可用的，考虑使用Map数据类型变量存储，和使用Indexed DB存储数据的key value格式一致。至于刷新丢失就丢失了，只是尽量避免完全没有数据。

```JavaScript
interface XLogContainer {
  destroy: () => void
  save: (data: { xlogData: XlogData }) => Promise<unknown>
  getAll: () => Promise<XlogData[]>
  remove: () => Promise<unknown>
}
class XLogDB implements XLogContainer {}
class XLogVariable implements XLogContainer {}

let xlogContainer: XLogContainer | null = null
const init = () => {
  const xlogDB = new XLogDB()
  xlogDB
    .open()
    .then(() => {
      xlogContainer = xlogDB
    })
    .catch(() => {
      xlogContainer = new XLogVariable()
    })
}
init()
```

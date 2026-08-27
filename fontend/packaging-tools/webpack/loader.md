## 为什么需要loader

* loader是为了将文件资源的读取与处理逻辑解耦，本质上一个mapping函数，接收source返回转译结果
* 计算机中文件资源格式比较多，后续也可能新增资源格式，将其一一实现非常麻烦，不如直接将解析资源的功能开放出去由第三方实现

## 执行顺序

### 配置顺序

* 从右到左，从下到上
* 可以通过enforce: 'pre' | 'post'改变
* 顺序按照 pre -> normal -> inline -> post

```JSON
{
  "rules": [
    {
      "test": /\.js$/,
      enforce: 'pre',
      use: ['loader-t1']
    },
    {
      "test": /\.js$/,
      enforce: 'post',
      use: ['loader-t2']
    },
    {
      "test": /\.js$/,
      use: ['loader-t3']
    },
  ]
}
// loader-t1 -> loader-t3 -> loader-t2
// 如果没有enforce则顺序为 loader-t3 -> loader-t2 -> loader-t1
```

### 两阶段顺序

1. 先执行pitch阶段（也就是normal阶段反序），如果某个pitch阶段返回了值则从该loader开始走normal阶段

```JavaScript
// 按照enforce loader-t2 pitch -> loader-t3 pitch -> loader-t1 pitch
// loader-t3 picth有返回值： loader-t2 pitch -> loader-t3 picth -> loader-t3 -> loader-t2
```

2. 后执行normal阶段（走配置顺序）

### 什么是[Pitching Loader](https://webpack.docschina.org/api/loaders/#pitching-loader)

* webpack运行loader函数上挂载一个名为pitch的函数，提供给开发者提前返回的功能

```JavaScript
// style-loader
const loader = function loader(content) {
  if (
    this._compiler &&
    this._compiler.options &&
    this._compiler.options.experiments &&
    this._compiler.options.experiments.css &&
    this._module &&
    (this._module.type === "css" ||
      this._module.type === "css/global" ||
      this._module.type === "css/module" ||
      this._module.type === "css/auto")
  ) {
    return content;
  }
};

loader.pitch = function pitch(request) {
  const options = this.getOptions(schema);
  const injectType = options.injectType || "styleTag";
  const esModule =
    typeof options.esModule !== "undefined" ? options.esModule : true;
  // ...

  switch (injectType) {
    case "linkTag": {
      return "...";
    }
    case "styleTag":
    case "autoStyleTag":
    case "singletonStyleTag":
    default: {
      // ...
      return "...";
    }
  }
};

export default loader;
```

### [内联Loader](https://webpack.docschina.org/concepts/loaders#inline)

* 使用 ! 进行分割，开头使用!、-!、!!进行配置

```JavaScript
import Styles from '-!style-loader!css-loader?modules!./styles.css';

/**
禁止所有pre和normal loader 
使用了css-loader，query参数为modules，将结果传递给style-loader
*/
```

## [Loader Context](https://webpack.docschina.org/api/loaders/#the-loader-context)

* loader context会在loader运行时以 this 方式注入，可以有限制的影响webpack编译过程

### loader的缓存

```JavaScript
export default function(source) {
  this.cacheable(false) // 取消缓存
  // ...
  return output
}

// 输出结果： ./src/test.xxy 1 bytes [not cacheable] [built] [code generated]
```

### 返回更多信息

```JavaScript
// eslint-loader
export default function loader(content, map) {
  const options = getOptions(this);
  const linter = new Linter(this, options);

  this.cacheable();

  // return early if cached
  if (options.cache) {
    cacheLoader(linter, content, map);
    return;
  }

  linter.printOutput(linter.lint(content));
  this.callback(null, content, map);
}
```

### 返回异步结果

```JavaScript
// less-loader
async function lessLoader(source) {
  // 获取异步callback
  const callback = this.async();
  // ...
  let result;
  try {
    result = await implementation.render(data, lessOptions);
  } catch (error) {
    if (error.filename) {
      this.addDependency(path.normalize(error.filename));
    }
    callback(errorFactory(error));
  } finally {
    implementation.logger.removeListener(loggerListener);
    delete lessOptions.pluginManager.webpackLoaderContext;
    delete lessOptions.pluginManager;
  }
  // ...
  callback(null, css, map);
}

export default lessLoader;
```

### 直接写出新的产物文件

```JavaScript
export default function loader(content) {
  const options = getOptions(this);

  validate(schema, options, {
    name: "File Loader",
    baseDataPath: "options",
  });

  let publicPath = `__webpack_public_path__ + ${JSON.stringify(outputPath)}`;

  if (options.publicPath) {
    if (typeof options.publicPath === "function") {
      publicPath = options.publicPath(url, this.resourcePath, context);
    } else {
      publicPath = `${
        options.publicPath.endsWith("/")
          ? options.publicPath
          : `${options.publicPath}/`
      }${url}`;
    }

    publicPath = JSON.stringify(publicPath);
  }

  // ...

  if (typeof options.emitFile === "undefined" || options.emitFile) {
    // ...

    this.emitFile(outputPath, content, null, assetInfo);
  }

  const esModule =
    typeof options.esModule !== "undefined" ? options.esModule : true;

  return `${esModule ? "export default" : "module.exports ="} ${publicPath};`;
}

// 期望以二进制方式读入资源文件
export const raw = true;
```

### 额外添加依赖

```JavaScript
async function lessLoader(source) {
  // ...
  const { css, imports } = result;

  imports.forEach((item) => {
    if (isUnsupportedUrl(item)) {
      return;
    }

    // `less` return forward slashes on windows when `webpack` resolver return an absolute windows path in `WebpackFileManager`
    // Ref: https://github.com/webpack-contrib/less-loader/issues/357
    const normalizedItem = path.normalize(item);

    // 将 import 到的文件都注册为依赖，此后这些资源文件发生变化时都会触发重新编译
    if (path.isAbsolute(normalizedItem)) {
      this.addDependency(normalizedItem);
    }
  });

  let map =
    typeof result.map === "string" ? JSON.parse(result.map) : result.map;

  if (map && useSourceMap) {
    map = normalizeSourceMap(map, this.rootContext);
  }

  callback(null, css, map);
}

export default lessLoader;
```

### 上报错误日志

* logger仅仅打印出输入的信息
* emitError提供的信息更详细，能够定位是哪个module出错
* callback传入error时会中断编译流程

```JavaScript
export default function loader(source) {
  const logger = this.getLogger("xxy-loader");
  // 支持：verbose/log/info/warn/error
  logger.error("error in xxy-loader");
 
  const err = new Error('error in xxy-loader')
  this.emitError(err)
  // 导致流程中断
  this.callback(err)
}
```

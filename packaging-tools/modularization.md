## 背景

- 前端编写的代码越来越多，需要分模块进行管理

## 模块化有那几种方法

1. 全局function模式

   * 将不同功能封装成不同的全局函数
   * 缺点是容易命名冲突，导致被覆盖

   ```js
   function m1() {
     return {}
   }

   function m2() {
     return {}
   }
   ```
2. namespace模式

   - 减少全局变量
   - 缺点是数据不安全，外部也可以修改内部数据

   ```js
   let aModule {
     data: '',
     fn() {}
   }
   ```
3. 匿名函数自调用

   - 通过挂载在windows上暴露内部方法或数据，避免外部修改内部数据
   - 缺点是容易命名冲突，导致被覆盖

   ```js
   (function(window, $dependency) {
     window.xxx = ''
   })(window, jquery)
   ```

## 现代模块化方法

- 为了解决script脚本需要手动编写加载顺序、难以维护等问题，有CommonJS、ES6等

### CommonJS

#### 实现大致原理

******[CommonJs源码](https://github.com/nodejs/node-v0.x-archive/blob/master/lib/module.js)******

```js
function Module(id, parent) {
  this.id = id; // 模块标识符，通常是带绝对路径的模块文件名
  this.parent = parent; // 调用该模块的模块
  this.exports = {}; // 导出内容
  if (parent && parent.children) {
    parent.children.push(this);
  }
  this.children = []; // 该模块引用的模块
  this.filename = null; // 文件名
  this.loaded = false; // 是否加载完成
}

Module.prototype.require = function require(path) {
  return Module._load(path, this);
};

Module._load = function (request, parent) {
  // 计算绝对路径
  const filename = Module._resolveFilename(request, parent);

  // 有缓存则直接返回缓存内容
  const cacheModule = Module._cache[filename];
  if (cacheModule) {
    return cacheModule.exports;
  }

  // 判断是否为内置模块
  if (NativeModule.exists(filename)) {
    return NativeModule.require(filename);
  }

  // 生成模块实例，存入缓存
  const module = new Module(filename, parent);
  Module._cache[filename] = module;

  try {
    // 读取文件内容
    module.loaded(filename);
  } catch (e) {
    delete Module._cache[filename];
  }

  return module.exports;
};

Module.prototype.loaded = function (filename) {
  // 不同模块加载方式不一样
  let extension = path.extname(filename) || "js";
  if (!Module._extensions[extensions]) {
    // 如果没有对应的加载方式，则使用js的加载方式
    extension = "js";
  }
  Module._extensions[extension](this, filename);
  this.loaded = true;
};

Module._extensions["js"] = function (module, filename) {
  const content = fs.readFileSync(filename, "utf8");
  module._compile(stripBOM(content), filename);
};


Module.prototype._compile = function(content, filename) {
  var self = this;

  content = content.replace(/^\#\!.*/, '');
  var wrapper = Module.wrap(content);
  var compiledWrapper = runInThisContext(wrapper, { filename: filename });
  var args = [self.exports, require, self, filename, dirname];

  return compiledWrapper.apply(self.exports, args);
};

/**
包装成如下代码
(function (exports, require, module, __filename, __dirname) {
  // 模块源码
});
*/
```

#### 总结

1. exports实际为module.exports的指针，最后使用的还是module.exports中的值，如果更改exports指向进行导出是无效的
2. 使用exports或module.exports导出时都是值的拷贝（即通过 = 进行赋值）
   * 对于基本数据类型来说，延迟更新对于其他模块来说不可见
3. 由于模块缓存，不会出现死循环（即A模块加载B模块，B模块加载A模块）
4. 通过require函数运行时加载，生成一个Module对象

### ES-Module

#### 核心原理

1. 从入口文件开始，编译为AST分析import语句找到下载文件url，获取文件并解析为模块记录（包含当前文件源码编译出来的AST、export导出值等）
   * 模块记录创建后会在模块map中保留一份，方便后续相同的url请求，可以直接从map中取
2. JS引擎创建一个模块环境记录来跟踪内存中所有模块记录导出值的变量位置与导出值的联系
   * 导入和导出都指向同一个内存位置，先链接导出位置，从而确保导入的链接可以指向导出链接，但是限制了修改
   * 此时导出值所在的内存位置还没有真正的内容
3. 执行代码将导出值填充在内存中
   * 导出值即使是延迟更新也依旧可以被其他模块看见

#### 总结

1. 导出的是值的引用
2. 编译时执行，分析AST找import和export语句
3. 导入值相当于设置了const
4. 不会出现死循环，由于模块记录map确保了只加载一次

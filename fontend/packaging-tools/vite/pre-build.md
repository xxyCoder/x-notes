## 为什么需要依赖预构建

[两点原因](https://vitejs.cn/vite3-cn/guide/dep-pre-bundling.html#the-why)

Vite 1.x使用了Rollup进行预构建，而Vite 2.x使用[ESBuild](https://esbuild.github.io/)进行预构建

## 预构建入口

1. [optimizeDeps.entries](https://vitejs.cn/vite3-cn/config/dep-optimization-options.html#optimizedeps-entries) 自定义入口
2. [optimizeDeps.include](https://vitejs.cn/vite3-cn/config/dep-optimization-options.html#optimizedeps-include) 强制预构建链接的包
3. build.rollupOptions.input
4. 默认抓取index.html来检测预构建依赖项

## 流程

[预构建源码](https://github.com/vitejs/vite/blob/main/packages/vite/src/node/optimizer/index.ts)

Vite每次预构建之后都将一些关键信息写在_metadata.json文件中，二次启动会通过文件hash值进行判断缓存是否命中

```JavaScript
// 整体流程
async function optimizeDeps(config, force = config.server.force) {
  // 加载_metadata.json文件判断缓存是否有效
  const cachedMetadata = await loadCachedDepOptimizationMetadata(config, force);
  // 返回有结果说明缓存有效
  if (cachedMetadata) {
    return cachedMetadata;
  }

  // 扫描项目中依赖
  const deps = await discoverProjectDependencies(config).result;
  // 处理手动添加的依赖
  await addManuallyIncludedOptimizeDeps(config, deps);
  // 整理依赖关系
  const depsInfo = toDiscoveredDependencies(config, deps);
  // 使用esbuild执行构建
  const result = await runOptimizeDeps(config, depsInfo).result;
  // 将结果写入缓存
  await result.commit();

  return result.metadata;
}
```

### 检查缓存

以package-lock.json这种锁文件+vite.config.js中某些配置项是否发生变化为缓存是否失效的依据

缓存文件默认存放在node_modules/.vite/deps目录下

```JavaScript
async function loadCachedDepOptimizationMetadata(config, force) {
  const depsCacheDir = getDepsCacheDir(config); // node_modules/.vite/deps
  // 判断hash是否一致
  if (!force) {
    let cachedMetadata;
    try {
      const cachedMetadataPath = path.join(depsCacheDir, "_metadata.json");
      cachedMetadata = parseDepsOptimizerMetadata(
        await fsp.readFile(cachedMetadataPath, "utf-8"),
        depsCacheDir
      );
    } catch {}
    // hash is consistent, no need to re-bundle
    if (cachedMetadata) {
      if (cachedMetadata.lockfileHash !== getLockfileHash(environment)) {
        // package-lock.json等锁文件变更
        // logger
      } else if (cachedMetadata.configHash !== getConfigHash(environment)) {
        // vite.config文件中mode、root、resolve、assetsInclude、plugins、optimizeDeps.include|exluce|esbuildOptions相关配置变更
        // logger
      } else {
        return cachedMetadata;
      }
    }
  }
  await fsp.rm(depsCacheDir, { recursive: true, force: true });
}
```

### 寻找入口创建ESBuild扫描器

vite目前借助了ESBuild进行扫描入口找寻依赖

比如说扫描HTML文件，需要找出所有带有 type = module 的 script 标签，对含有src的script改写为import语句，对于有具体内容的script抽出脚本内容，最后将所有script拼接为一段js代码

```JavaScript
async function discoverProjectDependencies(config) {
  const { result } = scanImports(config);
  return {
    result: result.then(({ deps }) => deps),
  };
}

async function scanImports(config) {
  const entries = [];
  const explicitEntryPatterns = config.optimizeDeps.entries;
  const buildInput = config.build.rollupOptions.input;
  if (explicitEntryPatterns) {
    // ...
  } else if (buildInput) {
    // ...
  } else {
    entries.push(...globEntries("**/*.html", config));
  }

  const deps = {};

  const plugin = esbuildScanPlugin(config, deps, entries);
  const { plugins = [], ...esbuildOptions } =
    config.optimizeDeps.esbuildOptions ?? {};
  const context = await esbuild.context({
    absWorkingDir: process.cwd(),
    write: false,
    stdin: {
      contents: entries.map((e) => `import ${JSON.stringify(e)}`).join("\n"),
      loader: "js",
    },
    bundle: true,
    format: "esm",
    logLevel: "silent",
    plugins: [...plugins, plugin],
    ...esbuildOptions,
    tsconfigRaw,
  });
  await context.rebuild();
  context.dispose();
  return {
    deps,
  };
}
```

#### 如何记录依赖

使用vite提供的插件即可，需要传入记录依赖的容器（一个对象），由ESBuild进行扫描，期间会调用各个插件，在resolve阶段就可以记录依赖了

```JavaScript
function esbuildScanPlugin(config, depImports) {
  return {
    name: "vite:dep-scan",
    setup(build) {
      build.onResolve(
        {
          // avoid matching windows volume
          filter: /^[\w@][^:]/,
        },
        async ({ path: id, importer }) => {
          // 如果在 optimizeDeps.exclude 列表或者已经记录过了，则将其 externalize (排除)，直接 return

          // 接下来解析路径，内部调用各个插件的 resolveId 方法进行解析
          const resolved = await resolve(id, importer);
          if (resolved) {
            if (shouldExternalizeDep(resolved, id)) {
              return externalUnlessEntry({ path: id });
            }

            if (resolved.includes("node_modules") || include?.includes(id)) {
              // 如果 resolved 为 js 或 ts 文件
              if (OPTIMIZABLE_ENTRY_RE.test(resolved)) {
                // 记录依赖
                depImports[id] = resolved;
              }
              // 进行 externalize，因为这里只用扫描出依赖即可，不需要进行打包
              return externalUnlessEntry({ path: id });
            } else {
              // resolved 为 「类 html」 文件，则标记上 'html' 的 namespace
              const namespace = htmlTypesRE.test(resolved) ? "html" : undefined;
              // linked package, keep crawling
              return {
                path: path.resolve(resolved),
                namespace,
              };
            }
          } else {
            // 没有解析到路径，记录到 missing 表中，后续会检测这张表，显示相关路径未找到的报错
            missing[id] = normalizePath(importer);
          }
        }
      );
    },
  };
}
```

### 创建ESBuild构建器

ESBuild可以将commonjs导入导出改写为ESM的语法规则，并将多个导入文件合并为一个文件避免请求瀑布流

```JavaScript
function runOptimizeDeps(config, depsInfo) {
  const metadata = initDepsOptimizerMetadata(config);

  metadata.browserHash = getOptimizedBrowserHash(
    metadata.hash,
    depsFromOptimizedDepInfo(depsInfo)
  );
  // ...

  const preparedRun = prepareEsbuildOptimizerRun(
    environment,
    depsInfo,
    processingCacheDir,
    optimizerContext
  );

  const runResult = preparedRun.then(({ context }) => {
    return context.rebuild().then((result) => {
      // ...
      return {
        metadata,
        commit: () => {
          //...
        },
      };
    });
  });

  return {
    result: runResult,
  };
}
```

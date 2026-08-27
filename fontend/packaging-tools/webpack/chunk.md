## Chunk

* 一组模块集合，与Entry的区别在于Chunk可以包含多个Entry（Entry也是一个Module）

```JSON
{
  "entry": {
    "main": ['./src/a.js', './src/b.js'],
    "index": './src/index.js'
  }
}
// chunk
[{
  name: "main"
},{
  name: "index"
}]
```

## ChunkGroup

* 一个ChunkGroup包含一个或多个Chunk对象（同一个chunk被splitChunks规则分包了），ChunkGroup通过_children和_parents形成父子依赖（比如异步模块生成的chunk和引入该异步模块的chunk形成父子关系、depenOn所在的chunk和使用该depenOn的chunk也会形成父子关系）
* EntryPoint继承了ChunkGroup

```JSON
{
  "chunks": [...],
  _parents: Set(),
  _children: Set() 
}
```

## ChunkGraphChunk

* 记录了当前ChunkGroup依赖的Module实例

## ChunkGraph

* 记录了Chunk和ChunkGroupChunk之间的对应关系，挂载在compilation.chunkGraph属性中
* 通过_modules属性记录了module与ChunkGroupModule的对应关系，ChunkGroupModule在chunks属性中记录了module所在的chunk集合

## Seal阶段

1. 首先遍历Compilation.entries，为每一个Entry实例创建一个空的Chunk与EntryPoint实例，然后再次遍历entries获取depenOn和runtime
2. dependOn和runtime不能共存，dependOn指定的entrypoint会存放在当前entrypoint的_parents集合属性上，而当前entrypoint会存放在dependOn指定entrypoint的_children集合属性上
3. runtime会单独抽离为一个chunk，存放在Entrypoint的_runtimeChunk属性上

```JavaScript
class Compilation {
  seal(callback) {
    const chunkGraph = new ChunkGraph(
      this.moduleGraph,
      this.outputOptions.hashFunction
    );
    this.chunkGraph = chunkGraph;
    // ...
    const chunkGraphInit = new Map();
    // 遍历入口模块列表
    for (const [name, { dependencies, options }] of this.entries) {
      // 为每一个 entry 创建对应的 Chunk 对象并添加在Compilation.chunks集合中
      const chunk = this.addChunk(name);
      // 为每一个 entry 创建对应的 ChunkGroup 对象
      const entrypoint = new Entrypoint(options);
      // 关联 Chunk 与 ChunkGroup
      connectChunkGroupAndChunk(entrypoint, chunk);

      // 遍历 entry Dependency 列表
      for (const dep of [...this.globalEntry.dependencies, ...dependencies]) {
        // 为每一个 EntryPoint 关联入口依赖对象，以便下一步从入口依赖开始遍历其它模块
        entrypoint.addOrigin(null, { name }, /** @type {any} */ (dep).request);

        const module = this.moduleGraph.getModule(dep);
        if (module) {
          // 在 ChunkGraph 中记录入口模块与 Chunk 关系
          chunkGraph.connectChunkAndEntryModule(chunk, module, entrypoint);
          // ...
          const modulesList = chunkGraphInit.get(entrypoint);
          if (modulesList === undefined) {
            chunkGraphInit.set(entrypoint, [module]);
          } else {
            modulesList.push(module);
          }
        }
      }
    }
    outer: for (const [
      name,
      {
        options: { dependOn, runtime },
      },
    ] of this.entries) {
      if (dependOn && runtime) {
        throw Error('')
      }
      if (dependOn) {
        const entry = /** @type {Entrypoint} */ (this.entrypoints.get(name));

        const dependOnEntries = [];
        for (const dep of dependOn) {
          const dependency = this.entrypoints.get(dep);

          dependOnEntries.push(dependency);
        }
        for (const dependency of dependOnEntries) {
          connectChunkGroupParentAndChild(dependency, entry);
        }
      } else if (runtime) {
       // runtime不为空
        const entry = /** @type {Entrypoint} */ (this.entrypoints.get(name));
        let chunk = this.namedChunks.get(runtime);
        // 为每个运行时依赖创建chunk
        chunk = this.addChunk(runtime);
        chunk.preventIntegration = true;
        runtimeChunks.add(chunk);
        entry.unshiftChunk(chunk);
        chunk.addGroup(entry);
        entry.setRuntimeChunk(chunk);
      }
    }
    // 调用 buildChunkGraph 方法，开始构建 ChunkGraph
    buildChunkGraph(this, chunkGraphInit);
    // 触发各种优化钩子
    // SplitChunkPlugin监听了 optimizeChunks hook
    while (this.hooks.optimizeChunks.call(this.chunks, this.chunkGroups)) {
      /* empty */
    }
    // ...
  }
}
```

4. 执行buildChunkGraph
   1. 执行visitModules函数，遇到异步模块时为其创建ChunkGroup和Chunk对象
   2. 执行connectChunkGroups函数，建立ChunkGroup之间、Chunk之间的依赖关系
   3. 执行cleanupUnconnectedGroups函数，清理无效ChunkGroup

## 分包

### 规则

ChunkGraph构建流程会将Module组织成三种类型的Chunk:

1. Entry Chunk：同一个Entry下到达的Module组织成一个Chunk
2. Async Chunk：异步模块单独组织为一个Chunk
3. Runtime Chunk：entry.runtime不为空时，会将运行时模块单独组织成一个Chunk

#### 设置分包规则

默认情况下只对Async Chunk生效，可以通过chunks: 'all' | 'initial' | 'async' | (chunk) => boolean进行调整

#### Module使用频率

通过minChunks配置最小引用次数（该次数不等于import次数，而是initial chunk或async chunk中的引用次数）

次数可以在通过ChunkGraph获取

#### 限制分包数量

在minChunks基础上，防止产物数量过多导致http请求数量剧增，可通过maxInitialRequest/maxAsyncRequest限制分包数量（被数量限制会放弃体积较小的，runtime chunk和async chunk不算并行请求）

#### 限制分包体积

为了避免分包体积过小或者过大，可以通过min/max[initial | async]Size控制分包大小

#### 缓存组

提供了cacheGroup配置项用于为不同文件设置不同规则

```JavaScript
module.exports = {
  //...
  optimization: {
    splitChunks: {
      cacheGroups: {
        vendors: {
            test: /[\\/]node_modules[\\/]/,
            minChunks: 1,
            minSize: 0,
            priority: 10
        }
      },
    },
  },
};
```

### 具体流程

1. 先尝试命中minChunks的module统一抽到一个额外chunk实例中
2. 判断该chunk是否满足maxInitialReuqests阈值，不满足则取消体积小的module分包
3. 判断该chunk的体积是否满足minSize，不满足则取消分包
4. 判断该chunk体积是否满足maxSize，如果超过则尝试将该chunk分割为更小的部分

### 原理

1. SplitChunkPlugin在apply时注册了optimizeChunks 的事件函数
2. 首先遍历所有modules，找出匹配的cacheGroup，将cacheGroup和外层规则合并，判断module被引用的次数是否大于minChunks，符合则生成一个新的Chunk实例，记录在chunksInfoMap变量中
3. 遍历chunksInfoMap中记录的chunk，移除不符合minSize的chunk
4. 遍历chunksInfoMap中未移除的chunk，如果没有enforced且设置了maxXXXRequest，则移出不符合要求的chunk
5. 遍历所有chunks（包含上面拆出来的chunks），判断体积是否超过maxSize，超出就尝试创建新chunk

```JavaScript
class SplitChunksPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap("SplitChunksPlugin", (compilation) => {
      // ...
      compilation.hooks.optimizeChunks.tap(
        {
          name: "SplitChunksPlugin",
          stage: STAGE_ADVANCED,
        },
        (chunks) => {
          for (const module of compilation.modules) {
            // 获取匹配的cache group
            const cacheGroups = this.options.getCacheGroups(module, context);
            if (!Array.isArray(cacheGroups) || cacheGroups.length === 0) {
              continue;
            }

            // Prepare some values (usedExports = false)
            const getCombs = memoize(() => {
              const chunks = chunkGraph.getModuleChunksIterable(module);
              const chunksKey = getKey(chunks);
              return getCombinations(chunksKey);
            });

            // Prepare some values (usedExports = true)
            const getCombsByUsedExports = memoize(() => {
              // fill the groupedByExportsMap
              getExportsChunkSetsInGraph();
              /** @type {Set<Set<Chunk> | Chunk>} */
              const set = new Set();
              const groupedByUsedExports =
                /** @type {Iterable<Chunk[]>} */
                (groupedByExportsMap.get(module));
              for (const chunks of groupedByUsedExports) {
                const chunksKey = getKey(chunks);
                for (const comb of getExportsCombinations(chunksKey))
                  set.add(comb);
              }
              return set;
            });

            let cacheGroupIndex = 0;
            for (const cacheGroupSource of cacheGroups) {
              // 合并外层的split chunk配置
              const cacheGroup = this._getCacheGroup(cacheGroupSource);

              const combs = cacheGroup.usedExports
                ? getCombsByUsedExports()
                : getCombs();
              // For all combination of chunk selection
              for (const chunkCombination of combs) {
                // 获取被引用次数
                const count =
                  chunkCombination instanceof Chunk ? 1 : chunkCombination.size;
                if (count < /** @type {number} */ (cacheGroup.minChunks))
                  continue;
                // Select chunks by configuration
                const { chunks: selectedChunks, key: selectedChunksKey } =
                  getSelectedChunks(
                    chunkCombination,
                    /** @type {ChunkFilterFunction} */
                    (cacheGroup.chunksFilter)
                  );

                addModuleToChunksInfoMap(
                  cacheGroup,
                  cacheGroupIndex,
                  selectedChunks,
                  selectedChunksKey,
                  module
                );
              }
              cacheGroupIndex++;
            }
          }
          // Filter items were size < minSize
          for (const [key, info] of chunksInfoMap) {
            // 移除不符合大小的chunk
            if (removeMinSizeViolatingModules(info)) {
              chunksInfoMap.delete(key);
            } else if (
              !checkMinSizeReduction(
                info.sizes,
                info.cacheGroup.minSizeReduction,
                info.chunks.size
              )
            ) {
              chunksInfoMap.delete(key);
            }
          }
          debugger
          // Check if maxRequests condition can be fulfilled
          if (
            !enforced &&
            (Number.isFinite(item.cacheGroup.maxInitialRequests) ||
              Number.isFinite(item.cacheGroup.maxAsyncRequests))
          ) {
            for (const chunk of usedChunks) {
              // respect max requests
              const maxRequests = /** @type {number} */ (
                chunk.isOnlyInitial()
                  ? item.cacheGroup.maxInitialRequests
                  : chunk.canBeInitial()
                  ? Math.min(
                      /** @type {number} */
                      (item.cacheGroup.maxInitialRequests),
                      /** @type {number} */
                      (item.cacheGroup.maxAsyncRequests)
                    )
                  : item.cacheGroup.maxAsyncRequests
              );
              if (
                Number.isFinite(maxRequests) &&
                getRequests(chunk) >= maxRequests
              ) {
                usedChunks.delete(chunk);
              }
            }
          }

          // 考虑maxSize
          const { fallbackCacheGroup } = this.options;
          for (const chunk of Array.from(compilation.chunks)) {
            const chunkConfig = maxSizeQueueMap.get(chunk);
            const {
              minSize,
              maxAsyncSize,
              maxInitialSize,
              automaticNameDelimiter,
            } = chunkConfig || fallbackCacheGroup;
            if (!chunkConfig && !fallbackCacheGroup.chunksFilter(chunk))
              continue;
            /** @type {SplitChunksSizes} */
            let maxSize;
            if (chunk.isOnlyInitial()) {
              maxSize = maxInitialSize;
            } else if (chunk.canBeInitial()) {
              maxSize = combineSizes(maxAsyncSize, maxInitialSize, Math.min);
            } else {
              maxSize = maxAsyncSize;
            }
            if (Object.keys(maxSize).length === 0) {
              continue;
            }
        
            const results = deterministicGroupingForModules({
              // ...
            });
            if (results.length <= 1) {
              continue;
            }
            for (let i = 0; i < results.length; i++) {
              const group = results[i];
              const key = this.options.hidePathInfo
                ? hashFilename(group.key, outputOptions)
                : group.key;
              let name = chunk.name
                ? chunk.name + automaticNameDelimiter + key
                : null;
              if (name && name.length > 100) {
                name =
                  name.slice(0, 100) +
                  automaticNameDelimiter +
                  hashFilename(name, outputOptions);
              }
              if (i !== results.length - 1) {
                // 创建新的chunk
                const newPart = compilation.addChunk(
                  /** @type {Chunk["name"]} */ (name)
                );
                chunk.split(newPart);
                newPart.chunkReason = chunk.chunkReason;
                if (chunk.filenameTemplate) {
                  newPart.filenameTemplate = chunk.filenameTemplate;
                }
                // Add all modules to the new chunk
                for (const module of group.items) {
                  if (!module.chunkCondition(newPart, compilation)) {
                    continue;
                  }
                  // Add module to new chunk
                  chunkGraph.connectChunkAndModule(newPart, module);
                  // Remove module from used chunks
                  chunkGraph.disconnectChunkAndModule(chunk, module);
                }
              } else {
                // change the chunk to be a part
                chunk.name = /** @type {Chunk["name"]} */ (name);
              }
            }
          }
        }
      );
    });
  }
}
```

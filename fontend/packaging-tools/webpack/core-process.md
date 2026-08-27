## 初始化阶段

1. 将process.args和webpack.config.js合并配置
2. 校验配置对象，调用validateScheme
   ```JavaScript
   const { validate } = require("schema-utils");

   const validateSchema = (schema, options, validationConfiguration) {
     validate(scheme, options, validationConfiguration || {...})
   }
   ```
3. 规范化配置对象并对缺失配置应用默认值，getNormalizedWebpackOptions+applyWebpackOptionsBaseDefaults生成最终配置
4. 创建compiler对象，将options挂载在compiler.options属性上，方便后续阶段直接访问
5. 遍历配置中plugins集合，执行其apply方法
   ```JavaScript
   const createCompiler = (rawOptions) => {
     const options = getNormalizedWebpackOptions(rawOptions);
     applyWebpackOptionsBaseDefaults(options);
     const compiler = new Compiler(options.context, options);
     // 注入参数中指明的plugin
     if (Array.isArray(options.plugins)) {
       for (const plugin of options.plugins) {
         if (typeof plugin === "function") {
           plugin.call(compiler, compiler);
         } else if (plugin) {
           plugin.apply(compiler);
         }
       }
     }
     // ...
     new WebpackOptionsApply().process(options, compiler); // 动态注入插件（如EntryPlugin）并调用apply方法
     compiler.hooks.initialize.call();
     return compiler;
   };
   ```
6. 根据配置文件动态注入相应插件：
   1. EntryPlugin（监听make钩子）或DynamicEntryPlugin
   2. Sourcemap插件
   3. RuntimePlugin

   ```JavaScript
   // WebpackOptionsApply.js
   new EntryOptionPlugin().apply(compiler); // 内部注入EntryPlugin等plugins

   if (options.optimization.splitChunks) {
     const SplitChunksPlugin = require("./optimize/SplitChunksPlugin");
     new SplitChunksPlugin(options.optimization.splitChunks).apply(compiler);
   }

   if (options.optimization.runtimeChunk) {
     const RuntimeChunkPlugin = require("./optimize/RuntimeChunkPlugin");
     new RuntimeChunkPlugin(
       /** @type {{ name?: (entrypoint: { name: string }) => string }} */
       (options.optimization.runtimeChunk)
     ).apply(compiler);
   }
   ```
7. 调用compiler.compile方法开始构建，触发compiler.hook.make钩子

### compiler对象

* 提供了Webpack  **完整的构建生命周期钩子** ，允许你在不同阶段插入自定义逻辑，其compile方法是整个打包流程的抽象
  ```JavaScript
  class Compiler {
    constructor(context, options) {
      this.hooks = Object.freeze({
        /** @type {AsyncSeriesHook<[CompilationParams]>} */
        beforeCompile: new AsyncSeriesHook(["params"]),
        /** @type {SyncHook<[CompilationParams]>} */
        compile: new SyncHook(["params"]),
        /** @type {AsyncParallelHook<[Compilation]>} */
        make: new AsyncParallelHook(["compilation"]),
        /** @type {AsyncParallelHook<[Compilation]>} */
        finishMake: new AsyncSeriesHook(["compilation"]),
        /** @type {AsyncSeriesHook<[Compilation]>} */
        afterCompile: new AsyncSeriesHook(["compilation"]),
      });

      this.options = options;
      this.context = context;
    }
    compile(callback) {
      const params = this.newCompilationParams();
      this.hooks.beforeCompile.callAsync(params, (err) => {
        // ...
        const compilation = this.newCompilation(params);
        this.hooks.make.callAsync(compilation, (err) => {
          // ...
          this.hooks.finishMake.callAsync(compilation, (err) => {
            // ...
            process.nextTick(() => {
              compilation.finish((err) => {
                // ...
                compilation.seal((err) => {
                  // ...
                  this.hooks.afterCompile.callAsync(compilation, (err) => {
                    if (err) return callback(err);
                    return callback(null, compilation);
                  });
                });
              });
            });
          });
        });
      });
    }
  }
  ```

## 构建阶段

* 从 entry 模块开始递归解析模块内容，找出模块依赖，并构建module之间的依赖关系图

1. EntryPlugin在注入时候会为每一个entry创建其 EntryDependency，并监听make钩子，钩子触发时调用compilation.addEntry将 EntryDependency加入到Compilation.entries中
   ```JavaScript
   class EntryOptionPlugin {
     static applyEntryOption() {
       // ...
       for (const entry of descImport) {  
         new EntryPlugin(context, entry, options).apply(compiler);
       }
     }
   }

   class EntryPlugin {
     apply(compiler) {
       const { entry, options, context } = this;
       // 创建入口 Dependency 对象
       const dep = new EntryDependency(entry);

       compiler.hooks.make.tapAsync("EntryPlugin", (compilation, callback) => {
         compilation.addEntry(context, dep, options, (err) => {
           callback(err);
         });
       });
     }
   }

   // addEntry内部会调用_addEntryItem方法，_addEntryItem内部调用addModuleTree方法
   class Compilation {
     constructor() {
       /** @type {Map<string, EntryData>} */
       this.entries = new Map();

       /** @type {Map<DepConstructor, ModuleFactory>} */
       this.dependencyFactories = new Map();
     }

     _addEntryItem(context, entry, target, options, callback) {
       const { name } = options;
       let entryData = this.entries.get(name);
       if (entryData === undefined) {
         entryData = {
           dependencies: [],
           includeDependencies: [],
           options: {
             name: undefined,
             ...options,
           },
         };
         entryData[target].push(entry);
         this.entries.set(name, entryData);
       } else {
         entryData[target].push(entry);
         for (const key of Object.keys(options)) {
           if (entryData.options[key] === undefined) {
             entryData.options[key] = options[key];
           }
         }
       }

       // addModuleTree function简略:
       const Dep = dependency.constructor;
       // dependencyFactories中的factory是在某些plugin中注入的
       const moduleFactory = this.dependencyFactories.get(Dep);

       // 内部调用了 this.factorizeModule 方法
       this.handleModuleCreation({
         factory: moduleFactory,
         dependencies: [dependency],
         originModule: null,
         contextInfo,
         context,
       });
     }
   }
   ```
2. 在handleModuleCreation方法中会调用factorizeModule方法，将其加入待处理队列
   1. 对于队列中的待处理的Dependency，根据其对应的moduleFactory调用create方法准备创建Dependency对应的Module实例
   2. 触发resolve相关的hook，在resolve阶段收集loaders，同时创建一个parser（JavascriptParser实例），结束后执行resolve回调创建Module实例
   3. factorizeModule方法成功后执行回调，调用addModule方法，将Module实例和回调函数放入addModuleQueue队列，当回调函数执行时会调用到buildModule方法，将module放入buildQueue队列准备解析模块内容

   ```JavaScript
   class NormalModuleFactory {
     constructor() {
       this.hooks.factorize.tapAsync(
         {
           name: "NormalModuleFactory",
           stage: 100,
         },
         (resolveData, callback) => {
           this.hooks.resolve.callAsync(resolveData, (err, result) => {
             this.hooks.createModule.callAsync(
               createData,
               resolveData,
               (err, createdModule) => {
                 if (!createdModule) {
                   createdModule = this.hooks.createModuleClass
                     .for(createData.settings.type)
                     .call(createData, resolveData);

                   if (!createdModule) {
                     // 创建module实例
                     createdModule = new NormalModule(createData);
                   }
                 }
                 createdModule = this.hooks.module.call(
                   createdModule,
                   createData,
                   resolveData
                 );

                 return callback(null, createdModule);
               }
             );
           });
         }
       );
       this.hooks.resolve.tapAsync(
         {
           name: "NormalModuleFactory",
           stage: 100,
         },
         (data, callback) => {
           const loaderResolver = this.getResolver("loader");
           const continueCallback = needCalls(3, () => {
             // 存储loaders
             const allLoaders = postLoaders;
             if (matchResourceData === undefined) {
               for (const loader of loaders) allLoaders.push(loader);
               for (const loader of normalLoaders) allLoaders.push(loader);
             } else {
               for (const loader of normalLoaders) allLoaders.push(loader);
               for (const loader of loaders) allLoaders.push(loader);
             }
             for (const loader of preLoaders) allLoaders.push(loader);
             const type = settings.type;

             try {
               Object.assign(data.createData, {
                 parser: this.getParser(type, settings.parser), // 创建javascript parser
                 parserOptions: settings.parser,
               });
             } catch (createDataErr) {
               return callback(createDataErr);
             }
             callback();
           });
           // 通过loader对内容进行转译
           this.resolveRequestArray(
             contextInfo,
             contextScheme ? this.context : context,
             elements,
             loaderResolver,
             resolveContext,
             (err, result) => {
               if (err) return continueCallback(err);
               loaders = result;
               continueCallback();
             }
           );
         }
       );
     }
     create(data, callback) {
       // ...
       this.hooks.beforeResolve.callAsync(resolveData, (err, result) => {
         // ...
         // constructor中注册了hooks.factorize的监听函数
         this.hooks.factorize.callAsync(resolveData, (err, module) => {
           const factoryResult = {
             module,
             fileDependencies,
             missingDependencies,
             contextDependencies,
             cacheable: resolveData.cacheable,
           };

           callback(null, factoryResult);
         });
       });
     }
   }
   ```
3. 执行Module中build方法，随后执行runLoaders方法，读取源内容，执行各个阶段的loaders进行转译，之后调用回调函数执行parser.parse方法将Javascript文本转AST结构，遍历AST触发相关hooks
   1. 遇到import触发相关hook，有相关插件监听该钩子触发，将其转换为HarmonyImportDependency；遇到export也会触发hook，并将其转换为HarmonyExportSpecifierDependency
   2. 调用module.addDependency函数，并添加到依赖数组中

   ```JavaScript
   class NormalModule {
     build(options, compilation, resolver, fs, callback) {
       // ...
       this._source = null;
       this._ast = null;

       return this._doBuild(options, compilation, resolver, fs, hooks, (err) => {
         const handleParseResult = () => {
           this.dependencies.sort(
             concatComparators(
               compareSelect((a) => a.loc, compareLocations),
               keepOriginalOrder(this.dependencies)
             )
           );
           this._initBuildHash(compilation);
           this._lastSuccessfulBuildMeta =
             /** @type {BuildMeta} */
             (this.buildMeta);
           return handleBuildDone();
         };
         // ...

         try {
           // 读取转译后内容开始执行parse方法
           const source = /** @type {Source} */ (this._source).source();
           /** @type {Parser} */
           (this.parser).parse(this._ast || source, {
             source,
             current: this,
             module: this,
             compilation,
             options,
           });
         } catch (parseErr) {
           handleParseError(/** @type {Error} */ (parseErr));
           return;
         }

         handleParseResult();
       });
     }
     _doBuild() {
       // ....
       runLoaders(
         {
           resource: this.resource,
           loaders: this.loaders,
           context: loaderContext,
           processResource: (loaderContext, resourcePath, callback) => {
             const resource = loaderContext.resource;
             const scheme = getScheme(resource);
             // FileUriPlugin注册了该回调函数
             hooks.readResource
               .for(scheme)
               .callAsync(loaderContext, (err, result) => {
                 // ...
               });
           },
         },
         (err, result) => {
           // Cleanup loaderContext to avoid leaking memory in ICs
           loaderContext._compilation =
             loaderContext._compiler =
             loaderContext._module =
             // @ts-expect-error avoid memory leaking
             loaderContext.fs =
               undefined;

           const buildInfo = /** @type {BuildInfo} */ (this.buildInfo);
           // 遍历loaders
           for (const loader of this.loaders) {
             const buildDependencies =
               /** @type {NonNullable<KnownBuildInfo["buildDependencies"]>} */
               (buildInfo.buildDependencies);

             buildDependencies.add(loader.loader);
           }
           buildInfo.cacheable = buildInfo.cacheable && result.cacheable;
           processResult(err, result.result);
         }
       );
     }
   }

   class FileUriPlugin {
     apply() {
       // ....
       const hooks = NormalModule.getCompilationHooks(compilation);
       hooks.readResource
         .for(undefined)
         .tapAsync("FileUriPlugin", (loaderContext, callback) => {
           const { resourcePath } = loaderContext;
           loaderContext.addDependency(resourcePath);
           loaderContext.fs.readFile(resourcePath, callback);
         });
     }
   }



   parser.hooks.import.tap(
     "HarmonyImportDependencyParserPlugin",
     (statement, source) => {
       parser.state.lastHarmonyImportOrder =
         (parser.state.lastHarmonyImportOrder || 0) + 1;
       const clearDep = new ConstDependency(
         parser.isAsiPosition(/** @type {Range} */ (statement.range)[0])
           ? ";"
           : "",
         /** @type {Range} */ (statement.range)
       );
       clearDep.loc = /** @type {DependencyLocation} */ (statement.loc);
       parser.state.module.addPresentationalDependency(clearDep);
       parser.unsetAsiPosition(/** @type {Range} */ (statement.range)[1]);
       const attributes = getImportAttributes(statement);
       const sideEffectDep = new HarmonyImportSideEffectDependency(
         /** @type {string} */ (source),
         parser.state.lastHarmonyImportOrder,
         attributes
       );
       sideEffectDep.loc = /** @type {DependencyLocation} */ (statement.loc); // 语句的行列开始和结束位置
       // 将dependency加入当前module的dependencies中
       parser.state.module.addDependency(sideEffectDep);
       return true;
     }
   );
   ```
4. 流程走到processModuleDependencies方法，将模块加入processDependenciesQueue队列处理依赖数组，随后执行_processModuleDependencies方法，流程回到第二步
   ```JavaScript
   class Compilation {
     _processModuleDependencies(module, callback) {
       // ...
       const onDependenciesSorted = err => {
         // 处理模块产生的dependency，执行handleModuleCreation，流程回到第二步
         for (const item of sortedDependencies) {
           inProgressTransitive++;
           // eslint-disable-next-line no-loop-func
           this.handleModuleCreation(item, err => {
             // In V8, the Error objects keep a reference to the functions on the stack. These warnings &
             // errors are created inside closures that keep a reference to the Compilation, so errors are
             // leaking the Compilation object.
             if (err && this.bail) {
               if (inProgressTransitive <= 0) return;
               inProgressTransitive = -1;
               // eslint-disable-next-line no-self-assign
               err.stack = err.stack;
               onTransitiveTasksFinished(err);
               return;
             }
             if (--inProgressTransitive === 0) onTransitiveTasksFinished();
           });
         }
         if (--inProgressTransitive === 0) onTransitiveTasksFinished();
       };

       // ...
       onDependenciesSorted()
     }
   }
   ```
5. 全部处理完后，调用compilation.seal函数

## 生成阶段

1. 创建本次的ChunkGraph对象
2. 遍历compilation.entries，为每一个入口调用addChunk方法创建chunk对象，同时创建一个Entrypoint对象，并将入口对应的chunk设置为Entrypoint的入口chunk
3. 遍历入口的Dependency集合，找到相应的module对象并将其关联到该chunk
4. 如果配置了entry.runtime，还需要为其创建相应的chunk并直接分配给entry对应的ChunkGroup中
5. 触发optimizeChunks等钩子进一步拆合chunk

```JavaScript
class Compilation {
  seal() {
    const chunkGraph = new ChunkGraph(
      this.moduleGraph,
      this.outputOptions.hashFunction
    );
    this.chunkGraph = chunkGraph;
    // ...
    this.moduleGraph.freeze("seal");

    const chunkGraphInit = new Map();
    for (const [name, { dependencies, includeDependencies, options }] of this
      .entries) {
      const chunk = this.addChunk(name);

      const entrypoint = new Entrypoint(options);

      entrypoint.setEntrypointChunk(chunk);
      this.namedChunkGroups.set(name, entrypoint);
      this.entrypoints.set(name, entrypoint);
      this.chunkGroups.push(entrypoint);
      connectChunkGroupAndChunk(entrypoint, chunk);

      for (const dep of dependencies) {
        entrypoint.addOrigin(null, { name }, dep.request);
        // moduleGraph可以通过dep反向查找对应的module
        const module = this.moduleGraph.getModule(dep);
        if (module) {
          // 进行关联
          chunkGraph.connectChunkAndEntryModule(chunk, module, entrypoint);
          const modulesList = chunkGraphInit.get(entrypoint);
          if (modulesList === undefined) {
            chunkGraphInit.set(entrypoint, [module]);
          } else {
            modulesList.push(module);
          }
        }
      }
      // 将chunk处理为graph结构
      buildChunkGraph(this, chunkGraphInit);
      // 触发优化 hook
    }
  }
}
```

5. 调用compilation.codeGeneration方法，为每一个module生成产物代码（将module转为可执行代码）

   1. 遍历所有modules，收集module和module对应的entry name，最后执行_runCodeGenerationJobs方法
   2. 在_runCodeGenerationJobs方法中遍历 modules 并为其调用_codeGenerationModule方法
   3. 在_codeGenerationModule调用module的codeGeneration（不同类型的Module实例有不同的codeGeneration实现）方法，该方法内部主要是调用了JavascriptGenerator的generate方法

   ```JavaScript
   class Compilation {
     codeGeneration(callback) {
       const { chunkGraph } = this;
       this.codeGenerationResults = new CodeGenerationResults(
         this.outputOptions.hashFunction
       );
       const jobs = [];
       for (const module of this.modules) {
         // entry对应的名字，比如“main”
         const runtimes = chunkGraph.getModuleRuntimes(module);
         if (runtimes.size === 1) {
           for (const runtime of runtimes) {
             const hash = chunkGraph.getModuleHash(module, runtime);
             jobs.push({ module, hash, runtime, runtimes: [runtime] });
           }
         } else if (runtimes.size > 1) {
           const map = new Map();
           for (const runtime of runtimes) {
             const hash = chunkGraph.getModuleHash(module, runtime);
             const job = map.get(hash);
             if (job === undefined) {
               const newJob = { module, hash, runtime, runtimes: [runtime] };
               jobs.push(newJob);
               map.set(hash, newJob);
             } else {
               job.runtimes.push(runtime);
             }
           }
         }
       }

       this._runCodeGenerationJobs(jobs, callback);
     }

     _runCodeGenerationJobs(jobs) {
       const { chunkGraph, moduleGraph, dependencyTemplates, runtimeTemplate } =
         this;
       const results = this.codeGenerationResults;
       const runIteration = () => {
         // 遍历所有modules
         asyncLib.eachLimit(jobs, this.options.parallelism, (job) => {
           const { module } = job;
           const { hash, runtime, runtimes } = job;
           this._codeGenerationModule(
             module,
             runtime,
             runtimes,
             dependencyTemplates,
             chunkGraph,
             moduleGraph,
             runtimeTemplate,
             results
           );
         });
       };
       runIteration();
     }

     _codeGenerationModule(
       module,
       runtime,
       runtimes,
       dependencyTemplates,
       chunkGraph,
       moduleGraph,
       runtimeTemplate,
       results
     ) {
       const cache = new MultiItemCache();
       // ...
       cache.get((err, cachedResult) => {
         let result;
         if (!cachedResult) {
           try {
             this.codeGeneratedModules.add(module);
             // 调用module对应的方法产物代码
             result = module.codeGeneration({
               chunkGraph,
               moduleGraph,
               dependencyTemplates,
               runtimeTemplate,
               runtime,
               codeGenerationResults: results,
               compilation: this,
             });
           } catch (err) {}
         } else {
           result = cachedResult;
         }
         for (const runtime of runtimes) {
           results.add(module, runtime, result);
         }
       });
     }
   }
   ```
6. 生成模块对应的产物

   1. 首先遍历module的所有dependency，获取dependency对应的template（不同Dependency实例有不同的Template实现），调用template.apply方法对原始代码进行修改（每一个修改都是一个Replacement实例，包含了替换的开始和结束位置以及替换内容，Replacement实例存放在ReplaceSource中的_replacements属性中）或添加（添加内容存放在initFragments，每个fragments包含了添加在source开头或结尾的内容属性)
   2. 调用addToSource方法，先合并fragments.getContent()，再合并source，最后合并fragments.getEndContent()，从而生成最终产物

   ```JavaScript
   class JavascriptGenerator {
       generate(module, generateContext) {
           // 先取出 module 的原始代码内容
           const source = new ReplaceSource(module.originalSource());
           const { dependencies, presentationalDependencies } = module;
           const initFragments = [];
           for (const dependency of [...dependencies, ...presentationalDependencies]) {
               // 找到 dependency 对应的 template
               const template = generateContext.dependencyTemplates.get(dependency.constructor);
               // 调用 template.apply，传入 source、initFragments
               // 在 apply 函数可以直接修改 source 内容，或者更改 initFragments 数组，影响后续转译逻辑
               template.apply(dependency, source, {initFragments})
           }
           // 遍历完毕后，调用 InitFragment.addToSource 合并 source 与 initFragments
           return InitFragment.addToSource(source, initFragments, generateContext);
       }
   }

   // Dependency 子类
   class xxxDependency extends Dependency {}

   // Dependency 子类对应的 Template 定义
   const xxxDependency.Template = class xxxDependencyTemplate extends Template {
       apply(dep, source, {initFragments}) {
           // 1. 直接操作 source，更改模块代码
           source.replace(dep.range[0], dep.range[1] - 1, 'some thing')
           // 2. 通过添加 InitFragment 实例，补充代码
           initFragments.push(new xxxInitFragment())
       }
   }

   class InitFragment {
     static addToSource(source, initFragments, generateContext) {
       // 先排好顺序
       const sortedFragments = initFragments
         .map(extractFragmentIndex)
         .sort(sortFragmentWithIndex);
       // ...

       const concatSource = new ConcatSource();
       const endContents = [];
       for (const fragment of sortedFragments) {
           // 合并 fragment.getContent 取出的片段内容
         concatSource.add(fragment.getContent(generateContext));
         const endContent = fragment.getEndContent(generateContext);
         if (endContent) {
           endContents.push(endContent);
         }
       }

       // 合并 source
       concatSource.add(source);
       // 合并 fragment.getEndContent 取出的片段内容
       for (const content of endContents.reverse()) {
         concatSource.add(content);
       }
       return concatSource;
     }
   }
   ```
7. 遍历所有chunks，调用createChunkAssets生成一个资产文件
8. 调用compiler.emitAssets方法输出资产文件

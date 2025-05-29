## 什么是Tree Shaking

* 是 Webpack 中用于移除 JavaScript 上下文中未引用代码（dead-code）的优化技术

## 如何开启Tree-Shaking?

1. 代码使用ES Module规范

   1. 对于其他模块规范，导入导出都是难以预测的，而ESM规范避免该行为，导入导出必须都在模块顶层，更适合做静态分析，从而找出未使用的导出值

   ```JavaScript
   if(process.env.NODE_ENV === 'development'){
     require('./bar');
     exports.foo = 'foo';
   }
   ```
2. 配置optimization.usedExports为true，开启标记功能
3. 开启代码优化功能，以下选择其一，会对标记为未使用的导出值（unused harmony）进行删除

   1. 配置mode = production
   2. 配置optimization.minimize = true
   3. 提供optimization.minimizer数组

### 模块化

[来来来，探究一下CommonJs的实现原理其实刚看到这个题目的时候，我的内心是拒绝的，但是本着对科学的敬畏精神，我开始了 - 掘金](https://juejin.cn/post/6844903665547870216)

[ES modules: A cartoon deep-dive – Mozilla Hacks - the Web developer blog](https://hacks.mozilla.org/2018/03/es-modules-a-cartoon-deep-dive/)

## 核心原理

### 流程

[Webapck5核心打包原理全流程解析](https://zhuanlan.zhihu.com/p/464885853)

```JavaScript
const compile = (callback) => {
  const params = {
    normalModuleFactory: this.createNormalModuleFactory(),
    contextModuleFactory: this.createContextModuleFactory()
  };

  this.hooks.beforeCompile.callAsync(params, (err) => {
    // ...
    const newCompilation = (params) => {
      const compilation = this.createCompilation(params);
      // 触发compilation hook注册的事件
      this.hooks.compilation.call(compilation, params);
      return compilation;
    };
    const compilation = newCompilation(params);
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
};
```

### Tapable Hook

[深度解析Webpack核心模块-Tapable](https://zhuanlan.zhihu.com/p/470657214)

```JavaScript
const hooks = {  
  /** @type {AsyncSeriesHook<[CompilationParams]>} */
  beforeCompile: new AsyncSeriesHook(["params"]),

  /** @type {AsyncParallelHook<[Compilation]>} */
  make: new AsyncParallelHook(["compilation"]),

  /** @type {AsyncParallelHook<[Compilation]>} */
  finishMake: new AsyncSeriesHook(["compilation"]),

  /** @type {AsyncSeriesHook<[Compilation]>} */
  afterCompile: new AsyncSeriesHook(["compilation"])
};
```

### 源码

```JavaScript
// src/index.js
import { age, gender } from "./a.js";

console.log(gender);

// src/a.js
export const name = 'name'
export const age = 20
export const gender = 'gender'

export default xxx = 'xxx'

// index.js
import webpack from '../webpack/lib/webpack.js'
import config from './webpack.config.js'

const compiler = webpack(config)

compiler.run((err, stats) => {
  if (err) {
    console.error(err)
  } else {
    console.log(
      stats.toString({
        errorDetails: true
      })
    )
  }
})
```

1. 想要处理 Entry 就需要EntryPlugin或者DynamicEntryPlugin，这个plugin在webpack中会自动注入

```JavaScript
const webpack = (webpackOptions) => {
  // ...
  compiler = createCompiler(webpackOptions);
  
  return compiler;
}

const createCompiler = () => {
  // ...
  new WebpackOptionsApply().process(options, compiler);
}

class WebpackOptionsApply {
  process() {
    // ...
    new EntryOptionPlugin().apply(compiler);
    // 执行 entryOption hook中的事件
    compiler.hooks.entryOption.call(
      (options.context),
      options.entry
    );
  
    new HarmonyModulesPlugin({
      topLevelAwait: options.experiments.topLevelAwait
    }).apply(compiler);
  
    if (options.optimization.providedExports) {
      const FlagDependencyExportsPlugin = require("./FlagDependencyExportsPlugin");
      new FlagDependencyExportsPlugin().apply(compiler);
    }
    if (options.optimization.usedExports) {
      const FlagDependencyUsagePlugin = require("./FlagDependencyUsagePlugin");
      new FlagDependencyUsagePlugin(
        options.optimization.usedExports === "global"
      ).apply(compiler);
    }
  }
}

class EntryOptionPlugin {

  apply(compiler) {
    // 在 entryOption hook中注册事件
    compiler.hooks.entryOption.tap("EntryOptionPlugin", (context, entry) => {
      EntryOptionPlugin.applyEntryOption(compiler, context, entry);
      return true;
    });
  }

  static applyEntryOption(compiler, context, entry) {
    if (typeof entry === "function") {
      const DynamicEntryPlugin = require("./DynamicEntryPlugin");
      new DynamicEntryPlugin(context, entry).apply(compiler);
    } else {
      const EntryPlugin = require("./EntryPlugin");
      for (const name of Object.keys(entry)) {
        const desc = entry[name];
        const options = EntryOptionPlugin.entryDescriptionToOptions(
          compiler,
          name,
          desc
        );
        const descImport =
          /** @type {Exclude<EntryDescription["import"], undefined>} */
          (desc.import);
        for (const entry of descImport) {
          new EntryPlugin(context, entry, options).apply(compiler);
        }
      }
    }
  }
}

class EntryPlugin {
  apply(compiler) {
    compiler.hooks.compilation.tap(
      "EntryPlugin",
      (compilation, { normalModuleFactory }) => {
        compilation.dependencyFactories.set(
          EntryDependency,
          normalModuleFactory
        );
      }
    );

    const { entry, options, context } = this;
    // entry不仅仅是一个entry还是一个dependency
    const dep = EntryPlugin.createDependency(entry, options);
    // 向 make hook注册事件
    compiler.hooks.make.tapAsync("EntryPlugin", (compilation, callback) => {
      compilation.addEntry(context, dep, options, err => {
        callback(err);
      });
    });
  }
}
```

2. 在构建(make)过程中

   1. 从Entry开始作为入口，遍历所有Module
      1. 将module通过 [acorn](https://astexplorer.net/) 转化为AST，找到 ImportDeclaration 节点从而继续遍历依赖
   2. 遍历过程中会触发各种hook（由于我是在console.log中使用了Identifier节点，所以会触发expression hook map中注册的函数）

   ```JavaScript
   class JavascriptParser {
     walkIdentifier(expression) {
       this.callHooksForName(this.hooks.expression, expression.name, expression);
     }
   }

   parser.hooks.expression
     .for(harmonySpecifierTag)
     .tap("HarmonyImportDependencyParserPlugin", (expr) => {
       const settings = /** @type {HarmonySettings} */ (parser.currentTagData);
       // 类型是ImportSpecifier的Identifier才会创建该Dependency
       const dep = new HarmonyImportSpecifierDependency(
         settings.source,
         settings.sourceOrder,
         settings.ids,
         settings.name,
         /** @type {Range} */ (expr.range),
         exportPresenceMode,
         settings.attributes,
         []
       );
       // ...
       parser.state.module.addDependency(dep);

       return true;
     });
   ```
   1. 对于所有export 语句分别生成  **HarmonyExportSpecifierDependency** （具名导出）和  **HarmonyExportExpressionDependency** （default导出），并记录导出名字
      ```JavaScript
      parser.hooks.exportSpecifier.tap(
        "HarmonyExportDependencyParserPlugin",
        (statement, id, name, idx) => {
          const harmonyNamedExports = (parser.state.harmonyNamedExports =
            parser.state.harmonyNamedExports || new Set());
          harmonyNamedExports.add(name);
          // ...
          InnerGraph.addVariableUsage(parser, id, name);
          const dep = new HarmonyExportSpecifierDependency(id, name)

          // ...
          parser.state.current.addDependency(dep);
          return true;
        }
      );
      ```
3. 所有模块编译完后触发 compilation.hooks.finishModules，开始执行 **FlagDependencyExportsPlugin **注册的回调函数

   1. optimization.provideExports默认为true
      ![](https://lightweight.feishu.cn/space/api/box/stream/download/asynccode/?code=Mzc1MDdkNGE2ZGEwNmNmZmFiMTA1ODY2ZjVhNzZjYjJfZzlIN2U0V1M5VUNQODc2aUtUMmcyUlNDU2owNGM2VTJfVG9rZW46UndGZmJpNHJ5b3R5WW94UERaemN1a2pMbnJjXzE3NDg1MTA0Mjc6MTc0ODUxNDAyN19WNA)

   ```JavaScript
   // new WebpackOptionsApply().process(options, compiler)方法内部
   if (options.optimization.providedExports) {
     const FlagDependencyExportsPlugin = require("./FlagDependencyExportsPlugin");
     new FlagDependencyExportsPlugin().apply(compiler);
   }
   ```
   1. 首先遍历所有 module 对象中的 dependencies 数组，找到 **HarmonyExportSpecifierDependency** 和**HarmonyExportExpressionDependency **对象，并转换为 ExportInfo 对象，然后记录到 ModuleGraph 对象的_exports 属性中（后续操作就可以从 ModuleGraph 中直接读取出模块的导出值）
      ```JavaScript
      asyncLib.each(
        modules,
        (module, callback) => {
          //...
        },
        (err) => {

          let module;

          let exportsInfo;

          const exportsSpecsFromDependencies = new Map();

          const processDependenciesBlock = (depBlock) => {
            for (const dep of depBlock.dependencies) {
              // 拿到HarmonyExportXXXDependency的导出信息
              const exportDesc = dep.getExports(moduleGraph); 
              // 如果不是HarmonyExportXXXDepdency则没有导出信息
              if (!exportDesc) return;
              exportsSpecsFromDependencies.set(dep, exportDesc);
            }
            // ...
          };

          const processExportsSpec = (dep, exportDesc) => {
            const exports = exportDesc.exports;

            const mergeExports = (exportsInfo, exports) => {
              for (const exportNameOrSpec of exports) {
                let name;
                let exports;
                // ...
                // 根据导出值进行创建ExportInfo并记录在moduleGraph中
                const exportInfo = exportsInfo.getExportInfo(name); 
                // ...
                if (exports) {
                  const nestedExportsInfo = exportInfo.createNestedExportsInfo();
                  mergeExports(
                    /** @type {ExportsInfo} */ (nestedExportsInfo),
                    exports
                  );
                }
                // ../
              }
            };
            // 将导出信息挂载在exportsInfo中
            mergeExports(exportsInfo, exports);
            // ...
          };

          while (queue.length > 0) {
            module = /** @type {Module} */ (queue.dequeue());

            statQueueItemsProcessed++;
            // 每个module的导出信息都会在moduleGraph中挂载一份
            exportsInfo = moduleGraph.getExportsInfo(module);

            cacheable = true;
            changed = false;

            exportsSpecsFromDependencies.clear();
            moduleGraph.freeze();
            processDependenciesBlock(module);
            moduleGraph.unfreeze();
            for (const [dep, exportsSpec] of exportsSpecsFromDependencies) {
              processExportsSpec(dep, exportsSpec);
            }

          }
          // ...
        }
      );
      ```
4. 触发 compilation.hooks.optimizeDependencies 钩子，开始执行 **FlagDependencyUsagePlugin** 注册的回调函数

   ```JavaScript
   // new WebpackOptionsApply().process(options, compiler)方法内部
   if (options.optimization.usedExports) {
     const FlagDependencyUsagePlugin = require("./FlagDependencyUsagePlugin");
     new FlagDependencyUsagePlugin(
       options.optimization.usedExports === "global"
     ).apply(compiler);
   }
   ```
   1. 遍历所有 modules 中依赖数组，找到与 import 产生的 Dependency 如HarmonyImportSideEffectDependency，通过 compilation.getDependencyReferencedExports 方法取出引用的导出值，将引用的模块和导出值记录在Map中
   2. 遍历Map集合，拿到 module 实例的 exportsInfo，找到与导出值对应的 exportInfo 并调用exportInfo.setUsedConditionally 方法标记被使用过
      ```JavaScript
       compilation.hooks.optimizeDependencies.tap(
          { name: PLUGIN_NAME, stage: STAGE_DEFAULT },
          (modules) => {

            /** @type {Map<ExportsInfo, Module>} */
            const exportInfoToModuleMap = new Map();

            /** @type {TupleQueue<[Module, RuntimeSpec]>} */
            const queue = new TupleQueue();

            const processReferencedModule = (
              module,
              usedExports,
              runtime,
              forceSideEffects
            ) => {
              const exportsInfo = moduleGraph.getExportsInfo(module);
              if (usedExports.length > 0) {

                for (const usedExportInfo of usedExports) {
                  let usedExport;
                  let canMangle = true;
                  if (Array.isArray(usedExportInfo)) {
                    usedExport = usedExportInfo;
                  } else {
                    usedExport = usedExportInfo.name;
                    canMangle = usedExportInfo.canMangle !== false;
                  }
                  if (usedExport.length === 0) {
                    if (exportsInfo.setUsedInUnknownWay(runtime)) {
                      queue.enqueue(module, runtime);
                    }
                  } else {
                    let currentExportsInfo = exportsInfo;
                    for (let i = 0; i < usedExport.length; i++) {
                      const exportInfo = currentExportsInfo.getExportInfo(
                        usedExport[i]
                      );
                      // 内部修改 exportInfo._usedInRuntime 属性，记录该导出被如何使用
                      if (
                        exportInfo.setUsedConditionally(
                          (v) => v !== UsageState.Used,
                          UsageState.Used,
                          runtime
                        )
                      ) {
                        const currentModule =
                          currentExportsInfo === exportsInfo
                            ? module
                            : exportInfoToModuleMap.get(currentExportsInfo);
                        if (currentModule) {
                          queue.enqueue(currentModule, runtime);
                        }
                      }
                      break;
                    }
                  }
                }
              }
            };

            const processModule = (module, runtime, forceSideEffects) => {
              /** @type {Map<Module, (string[] | ReferencedExport)[] | Map<string, string[] | ReferencedExport>>} */
              const map = new Map();

              /** @type {ArrayQueue<DependenciesBlock>} */
              const queue = new ArrayQueue();
              queue.enqueue(module);
              for (;;) {
                const block = queue.dequeue();
                if (block === undefined) break;
                for (const b of block.blocks) {
                  if (!this.global && b.groupOptions && b.groupOptions.entryOptions) {
                    processModule(
                      b,
                      b.groupOptions.entryOptions.runtime || undefined,
                      true
                    );
                  } else {
                    queue.enqueue(b);
                  }
                }
                for (const dep of block.dependencies) {
                  const connection = moduleGraph.getConnection(dep);
                  if (!connection || !connection.module) {
                    continue;
                  }
                  const activeState = connection.getActiveState(runtime);
                  if (activeState === false) continue;
                  const { module } = connection;
                  if (activeState === ModuleGraphConnection.TRANSITIVE_ONLY) {
                    processModule(module, runtime, false);
                    continue;
                  }
                  const oldReferencedExports = map.get(module);
                  if (oldReferencedExports === EXPORTS_OBJECT_REFERENCED) {
                    continue;
                  }
                  // 如果是HarmonyImportXXXDependency则会有值
                  const referencedExports =
                    compilation.getDependencyReferencedExports(dep, runtime);
                  if (
                    oldReferencedExports === undefined ||
                    oldReferencedExports === NO_EXPORTS_REFERENCED ||
                    referencedExports === EXPORTS_OBJECT_REFERENCED
                  ) {
                    map.set(module, referencedExports);
                  } else if (
                    oldReferencedExports !== undefined &&
                    referencedExports === NO_EXPORTS_REFERENCED
                  ) {
                    continue;
                  } else {
                    let exportsMap;
                    if (Array.isArray(oldReferencedExports)) {
                      exportsMap = new Map();
                      for (const item of oldReferencedExports) {
                        if (Array.isArray(item)) {
                          exportsMap.set(item.join("\n"), item);
                        } else {
                          exportsMap.set(item.name.join("\n"), item);
                        }
                      }
                      map.set(module, exportsMap);
                    } else {
                      exportsMap = oldReferencedExports;
                    }
                    for (const item of referencedExports) {
                      if (Array.isArray(item)) {
                        const key = item.join("\n");
                        const oldItem = exportsMap.get(key);
                        if (oldItem === undefined) {
                          exportsMap.set(key, item);
                        }
                        // if oldItem is already an array we have to do nothing
                        // if oldItem is an ReferencedExport object, we don't have to do anything
                        // as canMangle defaults to true for arrays
                      } else {
                        const key = item.name.join("\n");
                        const oldItem = exportsMap.get(key);
                        if (oldItem === undefined || Array.isArray(oldItem)) {
                          exportsMap.set(key, item);
                        } else {
                          exportsMap.set(key, {
                            name: item.name,
                            canMangle: item.canMangle && oldItem.canMangle,
                          });
                        }
                      }
                    }
                  }
                }
              }

              for (const [module, referencedExports] of map) {
                debugger;
                if (Array.isArray(referencedExports)) {
                  processReferencedModule(
                    module,
                    referencedExports,
                    runtime,
                    forceSideEffects
                  );
                } else {
                  processReferencedModule(
                    module,
                    Array.from(referencedExports.values()),
                    runtime,
                    forceSideEffects
                  );
                }
              }
            };
            for (const module of modules) {
              const exportsInfo = moduleGraph.getExportsInfo(module);
              exportInfoToModuleMap.set(exportsInfo, module);
              // 为每个exportInfo设置_hasUseInRuntimeInfo为true
              // 判断是否使用过先判断_hasUseInRuntimeInfo是否标记为true
              // 没有则认为不开启导出标记，算作被使用情况
              exportsInfo.setHasUseInfo(); 
            }

            const processEntryDependency = (dep, runtime) => {
              const module = moduleGraph.getModule(dep);
              if (module) {
                processReferencedModule(module, NO_EXPORTS_REFERENCED, runtime, true);
              }
            };
            /** @type {RuntimeSpec} */
            let globalRuntime;
            for (const [
              entryName,
              { dependencies: deps, includeDependencies: includeDeps, options },
            ] of compilation.entries) {
              const runtime = this.global
                ? undefined
                : getEntryRuntime(compilation, entryName, options);
              for (const dep of deps) {
                processEntryDependency(dep, runtime);
              }
              for (const dep of includeDeps) {
                processEntryDependency(dep, runtime);
              }
              globalRuntime = mergeRuntimeOwned(globalRuntime, runtime);
            }

          }
        );
      ```
5. 触发 compilation.seal 函数，在 compilation.codeGeneration 中调用 HarmonyExportXXXDependency 对应的Template.apply 方法

   1. 读取ModuleGraph中的exportsInfo，对于已经使用和没有使用的导出值分别创建HarmonyExportInitFragment（未使用的额外有个unused harmony export xxx注释)，保存在initFragments中

   ```JavaScript
   HarmonyExportSpecifierDependency.Template = 
       class HarmonyExportSpecifierDependencyTemplate extends (
         NullDependency.Template) 
   {
     /**
      * @param {Dependency} dependency the dependency for which the template should be applied
      * @param {ReplaceSource} source the current replace source which can be modified
      * @param {DependencyTemplateContext} templateContext the context object
      * @returns {void}
      */
     apply(
       dependency,
       source,
       { module, moduleGraph, initFragments, runtime, concatenationScope }
     ) {
       const dep = /** @type {HarmonyExportSpecifierDependency} */ (dependency);
       if (concatenationScope) {
         concatenationScope.registerExport(dep.name, dep.id);
         return;
       }
       const used = moduleGraph
         .getExportsInfo(module)
         .getUsedName(dep.name, runtime);
       if (!used) {
         const set = new Set();
         set.add(dep.name || "namespace");
         initFragments.push(
           new HarmonyExportInitFragment(module.exportsArgument, undefined, set)
         );
         return;
       }

       const map = new Map();
       map.set(used, `/* binding */ ${dep.id}`);
       initFragments.push(
         new HarmonyExportInitFragment(module.exportsArgument, map, undefined)
       );
     }
   };

   class HarmonyExportInitFragment {
     getContent({ runtimeTemplate, runtimeRequirements }) {
       runtimeRequirements.add(RuntimeGlobals.exports);
       runtimeRequirements.add(RuntimeGlobals.definePropertyGetters);

       const unusedPart =
         this.unusedExports.size > 1
           ? `/* unused harmony exports ${joinIterableWithComma(
               this.unusedExports
             )} */\n`
           : this.unusedExports.size > 0
           ? `/* unused harmony export ${first(this.unusedExports)} */\n`
           : "";
       const definitions = [];
       const orderedExportMap = Array.from(this.exportMap).sort(([a], [b]) =>
         a < b ? -1 : 1
       );
       for (const [key, value] of orderedExportMap) {
         definitions.push(
           `\n/* harmony export */   ${propertyName(
             key
           )}: ${runtimeTemplate.returningFunction(value)}`
         );
       }
       const definePart =
         this.exportMap.size > 0
           ? `/* harmony export */ ${RuntimeGlobals.definePropertyGetters}(${
               this.exportsArgument
             }, {${definitions.join(",")}\n/* harmony export */ });\n`
           : "";
       return `${definePart}${unusedPart}`;
     }
   }

   class InitFragment {
     static addToSource(source, initFragments, context) {
       if (initFragments.length > 0) {

         const concatSource = new ConcatSource();
         const endContents = [];
         for (let fragment of keyedFragments.values()) {
           if (Array.isArray(fragment)) {
             fragment = fragment[0].mergeAll(fragment);
           }
           // 获取修改后的内容
           concatSource.add(fragment.getContent(context));
           const endContent = fragment.getEndContent(context);
           if (endContent) {
             endContents.push(endContent);
           }
         }

         concatSource.add(source);
         for (const content of endContents.reverse()) {
           concatSource.add(content);
         }
         return concatSource;
       }
       return source;
     }
   }
   ```
6. 之后通过优化工具如terser去删除未使用的部分

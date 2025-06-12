## Dependency Graph是什么

* 以Entry Module为起点，其他Module为节点，以导入导出依赖为边的有向图

### V5版本之前

* Dependency Graph关系隐含在Dependency、Module对象的一系列属性中，这样做类与类之间过于耦合，模块关系不清晰且不好复用（同一个module对象，但是由于issuer不同导致无法复用）
  * module.dependencies数组记录模块依赖对象
  * dependency.module记录依赖对应的模块对象引用
  * module.issuer记录父模块引用

### V5版本

* 将依赖关系解耦，以一套独立的数据结构记录模块间的依赖关系，存储在Compilation.moduleGraph属性中
  * ModuleGraphConnection包含module属性指向文件对应的Module实例、originModule属性指向module的父引用和dependency属性指向module对应Dependency实例
  * ModuleGraphModule包含incomingConnections属性指向引用当前module的父module对应的ModuleGraphConnection集合，outgoingConnections属性指向当前module的子module对应的ModuleGraphConnection集合
  * ModuleGraph包含_dependecyMap属性记录了Dependecy实例和ModuleGraphConnection的对应关系，_moduleMap记录了Module实例和ModuleGraphModule的对应关系

```JavaScript
// index.js
import { ccc } from './c.js'
import { aaa } from './a.js'

// a.js
import { ccc } from './c.js'

// Compilation.ModuleGraph

ModuleGraph: {
  _dependencyMap: Map(count) {
    EntryDependency { request: './index.js' } => ModuleGraphConnection {
      module: NormalModule{ request: './index.js' },
      originModule: null,
      dependency: EntryDependency{ request: './a.js' }
    },
    HarmonyImportSideEffectDependency { request: './c.js' } => ModuleGraphConnection {
      module: NormalModule{ request: './c.js' },
      originModule: NormalModule { request: './index.js' },
      dependency: HarmonyImportSideEffectDependency{ request: './c.js' }
    },
    HarmonyImportSideEffectDependency { request: './c.js' } => ModuleGraphConnection {
      module: NormalModule{ request: './c.js' },
      originModule: NormalModule { request: './a.js' },
      dependency: HarmonyImportSideEffectDependency{ request: './c.js' }
    },
    ...
  },
  _moduleMap: Map(3) {
    NormalModule { 
      request: './index.js',
      dependencies: [
        HarmonyImportSideEffectDependency { request: './c.js' },
        HarmonyImportSpecifierDependency { request: './c.js', name: 'ccc' },
        HarmonyImportSideEffectDependency { request: './a.js' },
        HarmonyImportSpecifierDependency { request: './a.js', name: 'aaa' }
      ]
    } => ModuleGraphModule{
      incomingConnections: Set(1) [
        ModuleGraphConnection { 
          module: NormalModule{ 
            request: './index.js',
            dependencies: [...]
          },
          dependency: EntryDependency {...}
        }
      ],
      outgoingConnections: Set(4) [
        ModuleGraphConnection {
          module: NormalModule { request: './c.js' },
          dependency: HarmonyImportSideEffectDependency { request: './c.js' },
          originModule: NormalModule { request: './index.js' }
        },
        ModuleGraphConnection {
          module: NormalModule { request: './c.js' },
          dependency: HarmonyImportSpecifierDependency { request: './c.js', name: 'ccc' },
          originModule: NormalModule { request: './index.js' }
        },
        ...
      ]
    },
    ...
  }
}
```

## 作用

* 提供了信息索引以及辅助构建ChunkGraph如getModule(dep: Dependency)方法

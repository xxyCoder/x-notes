## Hook 类型

1. Async & Sync，分别代表异步和同步 hook
2. Parallel，底层使用promise.all
3. Sequential，串行 hook
4. First，依次执行hook直到返回一个非null或非undefined的值位置

## [Build 阶段Hook](https://www.rollupjs.com/plugin-development/#build-hooks)

1. 首先经历options hook，可以拿到处理后的配置对象，返回新的options（返回null表示不替换options）
2. 调用buildStart hook，开始构建流程
3. 进入resolveId hook（async + first hook），可以拿到文件的路径进行处理
4. 进入load hook（async + first hook），加载模块内容
5. 执行transform hook（async + sequential hook）对模块进行自定义转化
6. 执行moduleParsed hook（async + parallel hook），解析所有已发现的静态导入和动态导入
   1. 普通import执行resolveId
   2. 动态import执行resolveDynamicImport，解析成功走到步骤4，否则走到步骤3
7. 最终执行buildEnd

```JavaScript
import path from "path";

// @filename: rollup-plugin-my-example.js
/** @returns {import('rollup').Plugin} */
export default function myExample() {
  const dependencyGraph = new Map();
  return {
    name: "my-example", // 此名称将出现在警告和错误中
    resolveId(source) {
      if (source.startsWith("@")) {
        return path.resolve(process.cwd(), source.replace("@", "./"));
      }
      if (source === "lodash") {
        // 标记为外部依赖
        return { id: "lodash", external: true };
      }
      return null; // 其他ID应按通常方式处理
    },
    async load(id) {
      if (/\.xxy$/.test(id)) {
        // 处理非js资源
        const content = await this.fs.readFile(id, "utf-8");
        return `console.error('${content}')`;
      }
      return null; // 其他ID应按通常方式处理
    },
    transform(code, id) {
      // 在观察模式下或明确使用缓存时，当重新构建时，此钩子的结果会被缓存
      if (!/\.(js|jsx|ts|tsx)$/.test(id)) return null;

      const env = process.env.NODE_ENV || "development";
      const injectEvnCode = code
        .replace(/__ENV__/g, JSON.stringify(env))
        .replace(/debugger;?/g, "");

      const ast = this.parse(injectEvnCode, {
        sourceType: "module",
      });
      return {
        code: injectEvnCode,
        map: null,
        ast, // 如果需要AST，可以在这里返回，可以跳过 Rollup 的解析阶段
      };
    },
    moduleParsed(moduleInfo) {
      // 模块解析后触发
      dependencyGraph.set(moduleInfo.id, {
        imports: moduleInfo.importedIds,
        dynamicImports: moduleInfo.dynamicallyImportedIds,
        importers: moduleInfo.importers,
      });
    },
    buildEnd() {
      // 输出依赖关系图
      this.fs.writeFile(
        "dependency-graph.json",
        JSON.stringify(Object.fromEntries(dependencyGraph), null, 2)
      );
    },
  };
}
```

## [Output 阶段Hook](https://www.rollupjs.com/plugin-development/#output-generation-hooks)

1. 执行renderStart开始正式打包
2. 如果遇到了import.meta
   1. 对于import.meta.url执行resolveFileUrl自定义解析逻辑
   2. 对于其他import.meta则执行resolveImportMeta自定义解析逻辑
3. 对于每个chunk执行renderChunk，可以直接操作产物
4. 对于每个chunk执行augmentChunkHash，用于决定是否更改chunk hash
5. 随后调用generateBundle hook，可以拿到chunk + asset
6. 调用bundle.write后产物写入到磁盘结束，触发writeBundle
7. 当bundle.close调用时，触发closeBundle

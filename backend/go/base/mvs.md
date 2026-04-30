# Go MVS 笔记

## 1. MVS 是什么

MVS：`Minimal Version Selection`，最小版本选择。

Go Modules 用 MVS 决定最终构建时使用哪些模块版本。

核心规则：

```text
对同一个 module path，选择所有可达 require 中要求的最高版本。
```

注意：

- MVS 不会自动选择最新版本。
- MVS 选择的是满足当前依赖图的最小可用版本集合。
- “最小”不是选最低版本，而是不超过依赖图明确要求的版本。

## 2. 基本例子

依赖关系：

```text
main
 ├── A v1.0.0
 └── B v1.0.0

A v1.0.0 -> C v1.2.0
B v1.0.0 -> C v1.3.0
```

最终选择：

```text
A v1.0.0
B v1.0.0
C v1.3.0
```

原因：

```text
A 要求 C 至少是 v1.2.0
B 要求 C 至少是 v1.3.0
```

所以最终选 `C v1.3.0`。

即使 `C v1.9.0` 已经发布，Go 也不会自动选它，因为当前依赖图里没有任何模块要求它。

## 3. MVS 的算法思路

可以把每个模块版本看成一个节点：

```text
A@v1.0.0
B@v1.0.0
C@v1.3.0
```

每条 `require` 是一条边：

```text
A@v1.0.0 -> C@v1.2.0
B@v1.0.0 -> C@v1.3.0
```

MVS 从主模块开始遍历依赖图：

```text
1. 读取 main module 的 require。
2. 读取被选中模块版本的 go.mod。
3. 继续读取这些 go.mod 里的 require。
4. 如果同一个 module path 出现更高的要求版本，就升级到这个版本。
5. 重复直到没有版本变化。
```

最终得到的 build list，可以理解为：

```text
对每个 module path，取所有可达 require 中要求版本的最大值。
```

## 4. 为什么 require 可以表示“至少某版本”

Go 的 `require` 表达的是最低版本要求：

```go
require example.com/c v1.5.0
```

含义：

```text
我需要 example.com/c，至少是 v1.5.0。
如果最终选到 v1.6.0、v1.9.0，理论上也应该能工作。
```

Go 能这么做，是因为它依赖一个兼容性约定：

```text
同一个 module path 下，新版本应该兼容旧版本。
```

## 5. Import Compatibility Rule

Go 的兼容性规则可以概括为：

```text
如果旧 package 和新 package 使用相同 import path，
那么新 package 应该兼容旧 package。
```

例如：

```text
example.com/c v1.2.0
example.com/c v1.5.0
example.com/c v1.9.0
```

它们都是同一个 module path：

```text
example.com/c
```

因此 Go 默认认为后续版本应该兼容前面的版本。

## 6. 大版本后缀

如果发生不兼容的大版本升级，从 `v2` 开始，Go 要求修改 module path：

```go
module example.com/c/v2
```

使用方也要按新路径导入：

```go
import "example.com/c/v2/pkg"
```

依赖声明：

```go
require example.com/c/v2 v2.0.0
```

所以：

```text
example.com/c    v1.9.0
example.com/c/v2 v2.0.0
```

在 Go 看来是两个不同模块，可以同时存在。

`v0` 和 `v1` 不需要路径后缀：

```text
example.com/c v0.9.0
example.com/c v1.5.0
```

`v2` 及以后需要：

```text
example.com/c/v2 v2.0.0
example.com/c/v3 v3.0.0
```

## 7. 关键概括

```text
Go 可以安心表达“某个模块至少是 vX.Y.Z 版本”，
是因为同一个 module path 内默认保持兼容；
如果发生不兼容的大版本升级，
就必须通过 /v2、/v3 这种路径后缀变成另一个模块。
```

也就是说：

```text
不兼容升级不是同一个模块里的版本选择问题，
而是通过 module path 变成了另一个模块。
```

这也是 MVS 不需要复杂版本范围求解的关键原因。

## 8. 和版本范围求解的区别

很多包管理器会处理类似这种范围：

```text
A wants C >=1.2 <2.0
B wants C >=1.5 <1.7
```

Go 不这样做。

Go 的 `require` 只表达最低版本要求：

```text
A requires C v1.2.0
B requires C v1.5.0
```

最终直接选择：

```text
C v1.5.0
```

因为同一个 module path 下，较新版本应该兼容较旧版本。

## 9. 记忆点

```text
MVS：不求最新，只求刚好够用。
```

```text
同一个 module path：版本升级应该兼容。
不兼容大版本升级：通过 /v2、/v3 变成不同模块。
```

## 1. 总体逻辑

Go 的版本升级主要围绕这几个东西：

```text
go.mod       依赖声明
go.sum       模块内容校验和
GOPROXY/VCS  查询模块有哪些可用版本
module cache 下载后的模块缓存
```

可以先记住一句话：

```text
go.mod 写的是最低版本要求；
Go 根据主模块和依赖模块的 go.mod，用 MVS 算出最终 build list；
go list 负责查看；
go get 负责调整版本并写回 go.mod / go.sum；
go mod edit 只是直接编辑 go.mod。
```

## 2. go.mod 里的 require 是什么

示例：

```go
require github.com/gin-gonic/gin v1.9.1
```

它的含义不是：

```text
只能使用 github.com/gin-gonic/gin v1.9.1
```

而是：

```text
至少需要 github.com/gin-gonic/gin v1.9.1
```

最终实际用哪个版本，要看整个依赖图。

## 3. go mod edit 底层做什么

`go mod edit` 是一个低层的 `go.mod` 文件编辑器。

示例：

```bash
go mod edit -go=1.23
go mod edit -toolchain=go1.23.6
go mod edit -require=github.com/gin-gonic/gin@v1.10.0
go mod edit -replace=example.com/a=../a
```

底层大致是：

```text
读取 go.mod
解析成 Go module 指令结构
按参数修改 module / go / toolchain / require / replace / exclude / retract 等指令
重新格式化
写回 go.mod
```

重点：

```text
go mod edit 只读写 go.mod；
通常不解析完整依赖图；
不负责查询版本是否存在；
不负责连带调整其他依赖；
不负责下载模块。
```

所以：

```bash
go mod edit -require=github.com/foo/bar@v9.9.9
```

即使这个版本不存在，它也可能先写进 `go.mod`。

等执行下面这些真正需要解析模块图的命令时，才可能报错：

```bash
go mod tidy
go test ./...
go list -m all
```

日常升级依赖，更推荐用：

```bash
go get github.com/foo/bar@v1.2.3
```

而不是直接用 `go mod edit -require=...`。

## 4. go list -m 是什么

默认情况下，`go list` 查的是 package：

```bash
go list ./...
```

输出类似：

```text
example.com/app
example.com/app/internal/service
example.com/app/pkg/config
```

加上 `-m` 后，查的是 module：

```bash
go list -m all
```

输出类似：

```text
example.com/app
github.com/gin-gonic/gin v1.9.1
golang.org/x/net v0.20.0
```

所以：

```text
-m = module mode
```

常用命令：

```bash
go list -m all
```

含义：

```text
列出当前项目最终 build list 里的所有 module。
```

这个结果不是简单打印 `go.mod`，而是 Go 根据：

```text
主模块 go.mod
依赖模块 go.mod
MVS
```

计算出来的最终模块版本列表。

## 5. go list -m -versions 是什么

示例：

```bash
go list -m -versions github.com/gin-gonic/gin
```

含义：

```text
以 module 模式查询 github.com/gin-gonic/gin 这个模块有哪些已发布版本。
```

输出类似：

```text
github.com/gin-gonic/gin v1.8.2 v1.9.0 v1.9.1 v1.10.0 v1.10.1
```

它查的是：

```text
这个模块发布过哪些版本
```

不是：

```text
当前项目用了哪些版本
```

版本来源：

```text
默认从 GOPROXY 查询；
如果 GOPROXY 后面有 direct，则必要时直连源码仓库；
对 GitHub 模块来说，direct 本质上会查 git tags。
```

可以用下面命令看当前代理配置：

```bash
go env GOPROXY
```

常见值：

```text
https://proxy.golang.org,direct
```

所以：

```text
go.mod / MVS 决定当前项目最终用哪个版本；
GOPROXY / VCS 提供某个模块有哪些可用版本；
go list -m -versions 查询的是可用版本列表。
```

## 6. go list -m -u 是什么

常见用法：

```bash
go list -m -u all
```

含义：

```text
-m   查询 module
-u   查询 upgrade 信息
all  当前项目所有 active modules
```

这里要区分清楚：

```bash
go list -m -u
```

没有写模块参数时，默认查询的是当前主模块。

```bash
go list -m -u github.com/gin-gonic/gin
```

写了具体模块路径时，查询的是这个指定模块，并且 `-u` 会显示它的可更新版本。

```bash
go list -m -u all
```

这里的 `all` 也是一个查询参数，表示查询当前项目依赖图里的所有 active modules。

所以：

```text
-u 决定是否附带 upgrade 信息；
all 决定查询范围是所有 active modules。
```

输出类似：

```text
github.com/gin-gonic/gin v1.9.1 [v1.10.0]
golang.org/x/net v0.20.0 [v0.26.0]
```

含义：

```text
当前 gin 使用 v1.9.1，可升级到 v1.10.0
当前 x/net 使用 v0.20.0，可升级到 v0.26.0
```

底层大致是：

```text
读取当前模块 go.mod
读取依赖模块 go.mod
用 MVS 算出当前 build list
对 build list 里的每个 module 查询可用版本
如果有更新版本，就放到 Update 信息里
打印出来
```

注意：

```text
go list -m -u all 只查询，不修改 go.mod。
```

## 7. 怎么判断某个模块可升级

核心判断：

```text
当前 build list 里选中的版本 < 这个 module 可用的更新版本
```

例如当前：

```text
github.com/gin-gonic/gin v1.9.1
```

可用版本里有：

```text
v1.10.0
```

那么：

```bash
go list -m -u all
```

就可能显示：

```text
github.com/gin-gonic/gin v1.9.1 [v1.10.0]
```

中括号里的版本就是 Go 查询到的可升级版本。

## 8. go get 底层做什么

现代 Go 中，`go get` 的主要职责是：

```text
调整 go.mod 里的依赖版本。
```

它不再负责安装命令。安装命令用：

```bash
go install example.com/cmd@latest
```

示例：

```bash
go get github.com/gin-gonic/gin@v1.10.0
```

底层大致是：

```text
解析参数里的模块/包和版本
查询模块版本信息
下载或读取相关模块的 go.mod
构造模块依赖图
使用 MVS 算最终 build list
修改主模块 go.mod
必要时更新 go.sum
必要时下载模块源码到 module cache
```

所以 `go get` 不是简单改一行字符串。

它会根据整个依赖图做版本选择。

## 9. go get -u 是什么

不加 `-u`：

```bash
go get A@v1.1.0
```

含义：

```text
升级你点名的目标模块；
其他依赖只有在“必须满足新版本最低要求”时才变化。
```

加 `-u`：

```bash
go get -u A@v1.1.0
```

含义：

```text
升级你点名的目标模块；
同时主动尝试升级它依赖到的模块。
```

只升级 patch：

```bash
go get -u=patch ./...
```

含义：

```text
主动升级相关依赖，但默认只选择 patch 更新。
```

可以这样记：

```text
go get A@latest
    把 A 升到 latest，依赖只做必要调整。

go get -u A
    把 A 升级，并主动升级 A 的依赖。

go get -u=patch A
    把 A 升级，并主动把 A 的依赖升到 patch 最新。
```

## 10. go get 和 go get -u 的差异例子

当前版本：

```text
main
├── A v1.0.0
│   └── C v1.0.0
└── C v1.0.0
```

远端可用版本：

```text
A: v1.0.0, v1.1.0
C: v1.0.0, v1.1.0, v1.2.0
```

`A v1.1.0` 的 `go.mod`：

```go
require C v1.1.0
```

注意：`A v1.1.0` 只要求 `C >= v1.1.0`，并不要求 `C v1.2.0`。

执行：

```bash
go get A@v1.1.0
```

结果通常是：

```text
A v1.1.0
C v1.1.0
```

原因：

```text
C v1.1.0 已经满足 A v1.1.0 的最低要求。
```

执行：

```bash
go get -u A@v1.1.0
```

结果可能是：

```text
A v1.1.0
C v1.2.0
```

原因：

```text
-u 会主动升级 A 依赖链上的模块；
C 有更新的 v1.2.0，所以可能被一起升上去。
```

所以两者的差别不是：

```text
A 会不会升级
```

而是：

```text
A 的依赖会不会被主动升级到更新版本。
```

## 11. 实战例子

假设项目 `shop-api` 的 `go.mod`：

```go
module example.com/shop-api

go 1.22

require (
    github.com/gin-gonic/gin v1.9.1
    github.com/acme/payment v1.4.0
)
```

假设：

```text
payment v1.4.0 require golang.org/x/net v0.20.0
gin     v1.9.1 require golang.org/x/net v0.17.0
```

那么当前最终使用版本是：

```text
github.com/gin-gonic/gin v1.9.1
github.com/acme/payment  v1.4.0
golang.org/x/net         v0.20.0
```

原因简单说就是：`payment` 对 `x/net` 的最低版本要求更高。

### 11.1 查看当前实际版本

```bash
go list -m all
```

输出类似：

```text
example.com/shop-api
github.com/gin-gonic/gin v1.9.1
github.com/acme/payment v1.4.0
golang.org/x/net v0.20.0
```

这个结果是当前 build list，不是简单打印 `go.mod`。

### 11.2 查看可升级项

```bash
go list -m -u all
```

输出类似：

```text
example.com/shop-api
github.com/gin-gonic/gin v1.9.1 [v1.10.0]
github.com/acme/payment v1.4.0 [v1.5.0]
golang.org/x/net v0.20.0 [v0.26.0]
```

含义：

```text
gin 当前用 v1.9.1，可升级到 v1.10.0
payment 当前用 v1.4.0，可升级到 v1.5.0
x/net 当前用 v0.20.0，可升级到 v0.26.0
```

这一步只查询，不修改文件。

### 11.3 查看 gin 发布过哪些版本

```bash
go list -m -versions github.com/gin-gonic/gin
```

输出类似：

```text
github.com/gin-gonic/gin v1.8.2 v1.9.0 v1.9.1 v1.10.0 v1.10.1
```

这个版本列表来自 `GOPROXY` 或源码仓库，不是从当前项目 `go.mod` 里算出来的。

### 11.4 只升级 gin

执行：

```bash
go get github.com/gin-gonic/gin@v1.10.0
```

假设 `gin v1.10.0` 的 `go.mod` 要求：

```go
require golang.org/x/net v0.25.0
```

此时约束变成：

```text
main require gin v1.10.0
main require payment v1.4.0

gin v1.10.0     require x/net v0.25.0
payment v1.4.0 require x/net v0.20.0
```

最终 `x/net` 会被顶到：

```text
x/net v0.25.0
```

因为 `gin v1.10.0` 对 `x/net` 的最低版本要求变高了。

执行完后，`go.mod` 可能变成：

```go
module example.com/shop-api

go 1.22

require (
    github.com/gin-gonic/gin v1.10.0
    github.com/acme/payment v1.4.0
)

require golang.org/x/net v0.25.0 // indirect
```

`// indirect` 表示：

```text
你的代码没有直接 import 它；
但它是依赖图里需要记录的间接模块。
```

### 11.5 指定低版本不一定能降下去

如果此时执行：

```bash
go get golang.org/x/net@v0.18.0
```

但当前依赖要求：

```text
gin v1.10.0     require x/net v0.25.0
payment v1.4.0 require x/net v0.20.0
```

那么 `x/net v0.18.0` 不满足依赖图。

最终可能仍然是：

```text
golang.org/x/net v0.25.0
```

可以用下面命令确认：

```bash
go list -m golang.org/x/net
```

如果输出：

```text
golang.org/x/net v0.25.0
```

说明它被依赖图里的更高要求顶上去了。

### 11.6 使用 -u 主动升级依赖

普通升级：

```bash
go get github.com/gin-gonic/gin@latest
```

主要升级 `gin`，其他依赖只在必要时变化。

带 `-u`：

```bash
go get -u github.com/gin-gonic/gin
```

表示：

```text
升级 gin，并尝试升级 gin 相关依赖到新的 minor 或 patch 版本。
```

所以可能变成：

```text
github.com/gin-gonic/gin v1.10.0
golang.org/x/net v0.26.0
github.com/json-iterator/go v1.1.12
```

只想保守升 patch：

```bash
go get -u=patch ./...
```

## 12. 常用流程

```bash
# 查看当前实际使用版本
go list -m all

# 查看哪些模块可升级
go list -m -u all

# 查看某个模块有哪些已发布版本
go list -m -versions github.com/gin-gonic/gin

# 升级指定模块
go get github.com/gin-gonic/gin@v1.10.0

# 查看最终使用版本
go list -m github.com/gin-gonic/gin
go list -m golang.org/x/net

# 清理 go.mod / go.sum
go mod tidy

# 验证
go test ./...
```

## 13. 关键总结

```text
go.mod
    写依赖的最低版本要求。

GOPROXY / VCS
    提供模块有哪些可用版本。

go list -m all
    查看当前项目最终 build list。

go list -m -versions
    查询某个模块发布过哪些版本。

go list -m -u all
    查看当前依赖中哪些模块可升级。

go get
    提出版本调整请求，重新计算依赖图，并写回 go.mod / go.sum。

go get -u
    在升级目标模块的同时，主动升级它依赖到的模块。

go mod edit
    直接编辑 go.mod，不负责完整依赖决策。

go mod tidy
    根据源码 import 清理 go.mod / go.sum。
```

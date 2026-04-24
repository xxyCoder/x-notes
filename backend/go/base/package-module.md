# Go Package / Module 笔记

## 1. 核心概念

Go 中需要区分两个层次：

- `package`：代码组织和可见性边界。
- `module`：依赖管理和版本管理边界，由 `go.mod` 定义。

一个 module 可以包含多个 package。一个目录通常对应一个 package。

示例：

```text
myapp/
  go.mod
  main.go              package main
  internal/auth/       package auth
  pkg/client/          package client
```

## 2. package 的基本规则

同一个目录下，普通 `.go` 文件必须声明同一个 package。

```text
user/
  user.go      package user
  service.go   package user
```

不能在同一个目录里混用多个普通 package：

```text
user/
  user.go      package user
  main.go      package main   // 不允许
```

`package main` 表示可执行程序入口包。只有 `package main` 且包含 `func main()` 的代码，才能直接编译成可执行程序。

```go
package main

func main() {}
```

库代码通常不要写成 `package main`，否则不方便被其他 package 复用。

## 3. 包名和导入路径

包名是源码文件里的声明：

```go
package jsonutil
```

导入路径是 module 路径加目录路径：

```go
import "example.com/myapp/internal/jsonutil"
```

目录名、包名通常建议保持一致，但 Go 不强制要求一致。为了可读性，日常开发中最好保持一致。

## 4. 大小写决定可见性

Go 没有 `public`、`private` 关键字，标识符是否导出由首字母大小写决定。

首字母大写：包外可见。

```go
func NewUser() {}
type User struct {}
var Name = "Tom"
```

首字母小写：只在当前 package 内可见。

```go
func validateName() {}
type userCache struct {}
var token = "abc"
```

注意：可见性看的是 package，不是目录父子关系。

## 5. 父目录和子目录的小写变量能否互相访问

不能。

Go 中小写标识符只在同一个 package 内可见。父目录不能访问子目录 package 的小写变量，子目录也不能访问父目录 package 的小写变量。

示例一：子目录不能访问父目录的小写变量。

```text
myapp/
  config.go          package myapp
  service/
    service.go       package service
```

```go
// config.go
package myapp

var token = "abc"
```

```go
// service/service.go
package service

func Run() {
    println(token) // 不允许
}
```

示例二：父目录不能访问子目录的小写变量。

```text
myapp/
  main.go           package main
  user/
    user.go         package user
```

```go
// user/user.go
package user

var name = "Tom"
```

```go
// main.go
package main

import "example.com/myapp/user"

func main() {
    println(user.name) // 不允许
}
```

如果需要跨 package 使用，必须导出：

```go
package user

var Name = "Tom"
```

然后其他 package 才能使用：

```go
import "example.com/myapp/user"

func main() {
    println(user.Name)
}
```

结论：

- 小写：仅同 package 可见。
- 大写：可以被其他 package 访问。
- 父目录、子目录没有特殊访问权限。
- `example.com/myapp`、`example.com/myapp/user`、`example.com/myapp/user/profile` 是三个独立 package，不存在继承关系。

## 6. import 的常见写法

普通导入：

```go
import "fmt"
```

别名导入：

```go
import jsoniter "github.com/json-iterator/go"
```

匿名导入：只执行包的 `init()`，常用于注册驱动。

```go
import _ "github.com/lib/pq"
```

点导入：

```go
import . "fmt"
```

点导入不推荐日常使用，因为会污染当前命名空间，降低代码可读性。

## 7. init 函数

每个 package 可以定义 `init()`：

```go
func init() {
    // 初始化逻辑
}
```

执行顺序大致是：

1. 先初始化依赖 package。
2. 再初始化当前 package。
3. package 内先初始化变量，再执行 `init()`。

注意事项：

- 不要在 `init()` 中做太重的逻辑。
- 不要在 `init()` 中做隐式的远程连接、复杂配置读取、启动后台任务等。
- `init()` 适合轻量注册和必要初始化。

## 8. 循环依赖

Go 不允许 package 之间循环导入。

```text
a imports b
b imports a
```

这种情况会编译失败。

常见解决方式：

- 抽出公共类型到第三个 package。
- 使用 interface 反转依赖。
- 重新划分 package 边界。

## 9. internal 目录

`internal` 是 Go 的特殊目录，用于限制包的导入范围。

```text
myapp/
  internal/auth/
  cmd/server/
```

`internal/auth` 只能被 `internal` 父目录树下的代码导入。外部 module 不能导入它。

适合放项目内部实现，不希望对外暴露的代码。

## 10. cmd 目录

`cmd` 常用于放可执行程序入口。

```text
myapp/
  cmd/
    api/
      main.go
    worker/
      main.go
  internal/
    service/
    repo/
```

每个 `cmd/xxx` 通常都是一个 `package main`。

常用命令：

```bash
go run ./cmd/api
go build ./cmd/worker
```

## 11. go.mod

`go.mod` 是 module 的核心文件。

```go
module example.com/myapp

go 1.22

require (
    github.com/gin-gonic/gin v1.10.0
)
```

`module` 后面的路径就是当前 module 的身份。其他代码导入这个 module 下的 package 时，会使用这个路径。

```go
import "example.com/myapp/pkg/client"
```

如果项目托管在 GitHub，常见写法：

```go
module github.com/you/project
```

## 12. go.sum

`go.sum` 记录依赖版本的校验信息，用来保证下载的依赖没有被篡改。

注意：`go.sum` 应该提交到 Git。

## 13. 常用 module 命令

初始化 module：

```bash
go mod init github.com/you/project
```

整理依赖：

```bash
go mod tidy
```

`go mod tidy` 会：

- 添加代码实际用到但 `go.mod` 缺失的依赖。
- 删除不再使用的依赖。
- 更新 `go.sum`。

查看依赖：

```bash
go list -m all
```

升级依赖：

```bash
go get example.com/pkg@latest
```

指定版本：

```bash
go get example.com/pkg@v1.2.3
```

移除依赖：

1. 删除代码里的相关 import。
2. 执行 `go mod tidy`。

## 14. 语义化版本和 v2+

Go module 使用语义化版本：

```text
vMAJOR.MINOR.PATCH
```

含义：

- `PATCH`：修复 bug。
- `MINOR`：兼容性新增功能。
- `MAJOR`：不兼容变更。

Go 对 `v2+` module 有特殊要求：module path 必须带主版本后缀。

```go
module github.com/you/lib/v2
```

导入时也要带上 `/v2`：

```go
import "github.com/you/lib/v2/client"
```

这是 Go module 中非常常见的坑。

## 15. replace

`replace` 可以把某个依赖替换成本地路径或其他版本。

```go
replace github.com/you/lib => ../lib
```

适合本地同时开发多个 module，不想频繁发布版本的场景。

注意：

- `replace` 常用于本地开发。
- 提交前要确认团队成员是否都能使用这个路径。
- 绝对路径尤其要谨慎。

## 16. go.work

多个 module 一起开发时，可以使用 workspace。

```bash
go work init ./app ./lib
```

生成：

```text
go.work
```

典型结构：

```text
workspace/
  app/
    go.mod
  lib/
    go.mod
```

`go.work` 可以让 `app` 直接使用本地 `lib`，减少手写 `replace` 的需要。

## 17. package 设计建议

一个 package 应该表达一个清晰职责。

不太推荐的命名：

```text
utils/
common/
helper/
```

更推荐根据业务或能力命名：

```text
auth/
payment/
cache/
httpclient/
```

包名建议：

- 短。
- 小写。
- 不使用下划线。
- 尽量和目录名一致。

推荐：

```go
package user
package payment
package cache
```

不推荐：

```go
package user_service
package commonUtils
```

## 18. 测试包写法

同包测试：

```go
package user
```

特点：可以访问当前 package 的未导出成员。

外部测试：

```go
package user_test
```

特点：只能访问导出的 API，更接近真实使用者视角。

建议：

- 测试内部细节时，可以用同包测试。
- 测试公共 API 时，更适合用 `xxx_test` 包。

## 19. 常见注意点

- 不要把所有代码都堆在项目根目录的一个 package 里。
- 不要为了分层过度拆 package，拆太碎容易出现循环依赖。
- 不要随便暴露大写 API，导出的内容就是对外承诺。
- library package 不要直接 `log.Fatal` 或 `os.Exit`，应该返回 error，让调用者决定如何处理。
- 不要随便修改 `go.mod` 的 module 路径，修改后 import path 也会变化。
- 小写变量、函数、类型只在同 package 内可见，和目录父子关系无关。

## 20. 常见项目结构

小项目可以简单一些：

```text
myapp/
  go.mod
  main.go
  handler.go
  service.go
```

中型项目可以这样：

```text
myapp/
  go.mod
  cmd/
    api/
      main.go
  internal/
    handler/
    service/
    repository/
    config/
  pkg/
    client/
```

含义：

- `cmd/`：程序入口。
- `internal/`：项目内部实现。
- `pkg/`：确实希望被外部复用的库代码。
- `go.mod`：module 定义。

## 21. 一句话总结

`package` 管代码组织、命名空间和可见性边界；`module` 管依赖、版本和发布边界。

记住最重要的一条：Go 里访问权限看的是 package，不是目录层级。小写只限同 package，大写才能跨 package 使用。

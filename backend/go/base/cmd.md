# Go 常用命令笔记

这篇只整理几个最常用的 Go 命令：`go mod init`、`go list -m all`、`go mod graph`、`go work`、`go test`、`go vet`、`go build`、`gofmt`、`go generate`。

先记两个常见路径写法：

```bash
.      # 当前目录这个包
./...  # 当前目录以及所有子目录里的包
```

比如：

```bash
go test .
go test ./...
go build .
go build ./...
```

## go mod init

`go mod init` 用来初始化一个新的 Go 模块。

语法：

```bash
go mod init <模块名>
```

例子：

```bash
go mod init github.com/xxycoder/demo
```

执行后会生成 `go.mod`：

```go
module github.com/xxycoder/demo

go 1.22
```

使用场景：

- 新建 Go 项目时执行一次。
- 让当前目录变成一个 Go module。

## go list -m all

`go list -m all` 用来查看当前项目最终使用的模块版本列表。

语法：

```bash
go list -m all
```

例子：

```bash
go list -m all
```

输出可能类似：

```text
github.com/xxycoder/demo
github.com/gin-gonic/gin v1.10.0
golang.org/x/net v0.30.0
```

它看的是最终结果：这个项目最后用了哪些模块、分别是什么版本。

使用场景：

- 想知道项目当前依赖了哪些模块。
- 想确认某个依赖最后选中的版本。

注意：

`go list -m all` 可以粗略理解成 `go mod graph` 经过 Go 的版本选择之后得到的扁平模块清单，但它不是依赖关系图。

## go mod graph

`go mod graph` 用来查看模块之间的依赖关系。

语法：

```bash
go mod graph
```

例子：

```bash
go mod graph
```

输出可能类似：

```text
github.com/xxycoder/demo github.com/gin-gonic/gin@v1.10.0
github.com/gin-gonic/gin@v1.10.0 golang.org/x/net@v0.30.0
```

输出格式是：

```text
模块A 模块B
```

意思是：

```text
模块A 依赖 模块B
```

使用场景：

- 想知道“谁依赖了谁”。
- 想分析某个间接依赖是从哪条链路进来的。

和 `go list -m all` 的区别：

```text
go mod graph    看依赖关系图
go list -m all  看最终模块版本清单
```

## go work

`go work` 用来管理多个本地 Go module 的联调。

常用语法：

```bash
go work init <模块目录...>
go work use <模块目录...>
go work sync
```

例子：

```text
project/
  app/
    go.mod
  sdk/
    go.mod
```

如果 `app` 想直接使用本地的 `sdk`，可以在 `project` 目录执行：

```bash
go work init ./app ./sdk
```

会生成 `go.work`：

```go
go 1.22

use (
    ./app
    ./sdk
)
```

后面再添加一个模块：

```bash
go work use ./common
```

使用场景：

- 一个项目里有多个 Go module。
- 本地同时修改 `app` 和 `sdk`。
- 不想先发布 `sdk` 版本，就让 `app` 直接用本地 `sdk`。

简单理解：

```text
go mod   管单个模块的依赖
go work  管多个本地模块一起开发
```

## go test

`go test` 用来编译并运行测试。

语法：

```bash
go test <包路径>
```

常用例子：

```bash
go test .
go test ./...
go test -v ./...
go test -run TestAdd ./...
go test -count=1 ./...
go test -race ./...
```

含义：

```bash
go test .                 # 测试当前包
go test ./...             # 测试当前目录以及所有子目录里的包
go test -v ./...          # 显示详细测试日志
go test -run TestAdd ./... # 只运行名字匹配 TestAdd 的测试
go test -count=1 ./...    # 禁用测试缓存，强制重新跑
go test -race ./...       # 检查并发数据竞争
```

代码例子：

```go
func Add(a, b int) int {
    return a + b
}
```

测试文件一般叫 `xxx_test.go`：

```go
func TestAdd(t *testing.T) {
    got := Add(1, 2)
    if got != 3 {
        t.Fatalf("want 3, got %d", got)
    }
}
```

执行：

```bash
go test .
```

`go test` 大概会做这些事：

1. 编译业务代码。
2. 编译测试代码。
3. 生成临时测试二进制。
4. 运行 `TestXxx` 测试函数。

使用场景：

- 改完代码后验证功能是否正确。
- 提交代码前跑测试。
- 改了并发代码时用 `go test -race ./...` 多检查一层。

## go vet

`go vet` 用来检查“能编译，但很可疑”的代码。

语法：

```bash
go vet <包路径>
```

例子：

```bash
go vet .
go vet ./...
```

代码例子：

```go
fmt.Printf("%d", "hello")
```

这段代码可能能通过编译，因为 `Printf` 的参数类型比较宽松。但 `%d` 是打印整数的，`"hello"` 是字符串，所以 `go vet` 会提醒这里很可疑。

和 `go build` 的区别：

```text
go build  检查代码能不能编译
go vet    检查代码虽然能编译，但有没有明显可疑的问题
```

使用场景：

- 提交代码前检查。
- CI 里配合 `go test` 一起跑。

常见组合：

```bash
go vet ./...
go test ./...
```

## go build

`go build` 用来编译代码。

语法：

```bash
go build <包路径>
go build -o <输出文件> <包路径>
```

例子：

```bash
go build .
go build ./...
go build -o app .
```

如果当前目录是 `main` 包：

```bash
go build -o app .
```

会生成可执行文件：

```text
app
```

使用场景：

- 检查项目能不能编译。
- 生成最终可执行文件。
- 发布服务或命令行程序前构建产物。

例子：

```bash
go build -o server ./cmd/server
```

意思是：把 `./cmd/server` 这个 main 包编译成 `server` 可执行文件。

## gofmt

`gofmt` 用来格式化 Go 代码。

语法：

```bash
gofmt -w <文件或目录>
```

例子：

```bash
gofmt -w main.go
gofmt -w .
```

格式化前：

```go
func Add(a int,b int)int{return a+b}
```

格式化后：

```go
func Add(a int, b int) int {
    return a + b
}
```

使用场景：

- 保存文件时格式化。
- 提交代码前统一代码风格。

补充：

```bash
go fmt ./...
```

也可以格式化包，它底层也是基于 `gofmt`。

## go generate

`go generate` 用来执行代码里的 `//go:generate` 指令。

语法：

```bash
go generate <包路径>
```

而 `//go:generate` 的语法是：

```go
//go:generate <命令> <参数1> <参数2> ...
```

重点：

`//go:generate` 后面跟的就是一条普通命令行命令。

最简单例子：

```go
//go:generate echo hello
```

执行：

```bash
go generate .
```

Go 会执行：

```bash
echo hello
```

真实一点的例子：

```go
//go:generate stringer -type=Status
type Status int

const (
    Pending Status = iota
    Running
    Done
)
```

这里：

```go
//go:generate stringer -type=Status
```

意思就是让 `go generate` 执行：

```bash
stringer -type=Status
```

`stringer` 可以根据枚举生成 `String()` 方法。不过它是外部工具，需要先安装：

```bash
go install golang.org/x/tools/cmd/stringer@latest
```

再看 mock 例子：

```go
//go:generate mockgen -source=user.go -destination=user_mock.go
```

执行：

```bash
go generate .
```

Go 会执行：

```bash
mockgen -source=user.go -destination=user_mock.go
```

使用场景：

- 生成 mock 测试代码。
- 生成 protobuf 代码。
- 生成 enum 的 `String()` 方法。
- 生成 wire 依赖注入代码。
- 生成 sqlc 数据库访问代码。

注意：

```bash
go build
go test
```

不会自动执行 `go generate`。

如果项目依赖生成代码，通常需要手动执行：

```bash
go generate ./...
go test ./...
go build ./...
```

## 简单工作流

新项目：

```bash
go mod init github.com/xxycoder/demo
```

日常开发：

```bash
gofmt -w .
go test ./...
```

提交前：

```bash
gofmt -w .
go vet ./...
go test ./...
```

多模块本地联调：

```bash
go work init ./app ./sdk
go test ./...
```

需要代码生成：

```bash
go generate ./...
go test ./...
```

发布构建：

```bash
go build -o app .
```

## 1. docker pull 是什么

`docker pull` 用来从镜像仓库把镜像下载到本地。

```bash
docker pull nginx
docker pull redis:7
docker pull bitnami/redis
docker pull registry.example.com/team/app:1.0
```

执行 `docker pull` 时，Docker 下载的不是一个单独的大文件，而是一组镜像内容：

```text
manifest  镜像清单，说明这个镜像由哪些 layer 组成
config    镜像配置，包含环境变量、启动命令、history 等元数据
layers    文件系统层，真正的文件内容变化
```

简单理解：

```text
镜像 = manifest + config + layers
```

## 2. 镜像名字结构

完整镜像名可以理解为：

```text
registry/namespace/repository:tag
```

例如：

```text
docker.io/library/nginx:latest
```

拆开：

```text
docker.io   registry，镜像仓库服务地址
library     namespace，命名空间/组织/用户名
nginx       repository，镜像仓库名
latest      tag，标签
```

平时写：

```bash
docker pull nginx
```

等价于：

```bash
docker pull docker.io/library/nginx:latest
```

默认值：

```text
registry  默认 docker.io
namespace 默认 library，仅适用于 Docker Hub 官方短镜像名
tag        默认 latest
```

## 3. bitnami/redis 中的 bitnami 是什么

`bitnami/redis` 里的 `bitnami` 是 namespace，不是 registry。

```bash
docker pull bitnami/redis
```

等价于：

```bash
docker pull docker.io/bitnami/redis:latest
```

拆开：

```text
docker.io   registry，可省略
bitnami     namespace，不是 registry
redis       repository
latest      tag，可省略
```

Docker 判断第一段是不是 registry，有一个常见规则：

如果第一段包含 `.`、`:`，或者第一段是 `localhost`，Docker 才会把它当成 registry。

例如：

```text
bitnami/redis
```

第一段 `bitnami` 没有 `.`、没有 `:`，也不是 `localhost`，所以它是 namespace。

而：

```text
registry.example.com/team/app:1.0
```

第一段 `registry.example.com` 里有 `.`，所以它是 registry。

## 4. 私有 registry 怎么 pull

如果是 Docker Hub 上的私有仓库：

```bash
docker login
docker pull yourname/private-repo:1.0
```

等价于：

```bash
docker pull docker.io/yourname/private-repo:1.0
```

只写：

```bash
docker login
```

默认就是登录 Docker Hub。

如果是自己搭的或第三方 registry，比如 Harbor、GitLab Registry、阿里云 ACR、Nexus 等，一般要显式写 registry 地址：

```bash
docker login registry.example.com
docker pull registry.example.com/team/app:1.0
```

这里：

```text
registry.example.com   registry，基本必须写
team                   namespace/project，是否必须取决于平台和镜像路径
app                    repository
1.0                    tag
```

私有或第三方 registry 中，registry 基本必须写。否则：

```bash
docker pull team/app:1.0
```

Docker 会按 Docker Hub 来解析：

```text
docker.io/team/app:1.0
```

namespace 是否必须，取决于 registry 的组织方式。有些允许：

```bash
docker pull registry.example.com/app:1.0
```

有些平台通常要求项目或命名空间：

```bash
docker pull registry.example.com/team/app:1.0
docker pull registry.gitlab.com/group/project/app:1.0
docker pull registry.cn-hangzhou.aliyuncs.com/namespace/app:1.0
```

## 5. tag 和 label 不一样

Docker 里有两个容易混淆的“标签”。

第一种是 image tag，也就是镜像名冒号后面的部分：

```text
redis:7
myapp:1.0
myredis:test
```

设置 tag：

```bash
docker tag redis:7 myredis:test
```

查询：

```bash
docker images -f "reference=myredis:test"
```

第二种是 image label，是镜像元数据里的键值对：

```dockerfile
LABEL app=demo
LABEL env=dev
```

或者构建时写入：

```bash
docker build -t myapp:1.0 --label app=demo --label env=dev .
```

查询：

```bash
docker images -f "label=app=demo"
```

一句话：

```text
冒号后面的 tag 用 reference 过滤
镜像元数据 label 用 label 过滤
```

## 6. docker images -f

`docker images -f` 中的 `-f` 是 `--filter`，用于筛选本地镜像。

基本格式：

```bash
docker images -f "条件=值"
docker image ls -f "条件=值"
```

常用条件：

```text
reference
before
since
label
dangling
```

### 6.1 reference

按镜像引用过滤，也就是按镜像名和 tag 过滤。

```bash
docker images -f "reference=nginx"
docker images -f "reference=nginx:*"
docker images -f "reference=*:latest"
docker images -f "reference=myrepo/myapp:v1"
docker images -f "reference=registry.example.com/team/app:1.0"
```

如果给镜像设置了 tag：

```bash
docker tag redis:7 myredis:test
```

就可以这样查：

```bash
docker images -f "reference=myredis:test"
```

### 6.2 dangling

查悬空镜像。悬空镜像通常显示为：

```text
<none>   <none>
```

查询悬空镜像：

```bash
docker images -f "dangling=true"
```

查询非悬空镜像：

```bash
docker images -f "dangling=false"
```

清理悬空镜像：

```bash
docker image prune
```

### 6.3 label

按镜像 label 过滤。

查有某个 label key 的镜像：

```bash
docker images -f "label=app"
```

查 label 等于某个值的镜像：

```bash
docker images -f "label=app=demo"
```

### 6.4 before

查某个镜像之前创建的镜像：

```bash
docker images -f "before=nginx:latest"
docker images -f "before=IMAGE_ID"
```

### 6.5 since

查某个镜像之后创建的镜像：

```bash
docker images -f "since=nginx:latest"
docker images -f "since=IMAGE_ID"
```

### 6.6 多个过滤条件叠加

```bash
docker images -f "reference=*:latest" -f "dangling=false"
docker images -f "reference=myapp:*" -f "label=env=dev"
```

## 7. docker history

`docker history` 用来查看镜像的构建历史。

```bash
docker history nginx
docker history redis:7
docker history myapp:1.0
```

最常用的是显示完整命令：

```bash
docker history --no-trunc myapp:1.0
```

输出中常见列：

```text
IMAGE        这一条 history 对应的镜像 config ID，可能是 <missing>
CREATED      创建时间
CREATED BY   构建时记录的命令
SIZE         这一条历史对应的大小变化
COMMENT      注释，通常为空
```

`docker history` 不是直接查看 Dockerfile 文件。它查看的是镜像 config 里的 history 元数据。

也就是说：

```text
Dockerfile
   |
   | docker build
   v
image config + layer blobs
   |
   | docker push / docker pull
   v
本地 image config + 本地 layer blobs
   |
   | docker history
   v
读取 image config 里的 history 字段并展示
```

所以 `docker history` 能看到类似 Dockerfile 指令的内容：

```text
RUN apt-get update ...
COPY . /app
CMD ["node", "server.js"]
```

但它不是原始 Dockerfile，不能完整还原 Dockerfile。

## 8. layer、history 和 Dockerfile 的关系

镜像里有真实文件层，也有历史记录。

会产生文件系统层的常见指令：

```dockerfile
RUN
COPY
ADD
```

通常只修改元数据的指令：

```dockerfile
CMD
ENTRYPOINT
ENV
LABEL
WORKDIR
EXPOSE
USER
```

这些元数据指令也可能出现在 `docker history` 中，但大小经常是 `0B`。

所以：

```text
history 记录不一定和 layer 一一对应
有些 history 记录没有真实文件层
有些真实 layer 只是内部内容包，不是一个可单独运行的镜像
```

可以理解为：

```text
layer   = 文件内容变化
history = 构建过程记录
```

## 9. 为什么 docker history 里会出现 <missing>

`docker pull` 确实会把 layer 下载到本地。

但是 `docker history` 里的 `<missing>` 不是说 layer 没下载，而是说：

```text
这一条 history 没有可显示的本地镜像 config ID
```

更准确地说：

```text
layer 在本地
history 元数据在本地
但中间构建步骤对应的 image config 不一定在本地
```

构建镜像时，中间可能有很多状态：

```text
FROM 后的状态
RUN 后的状态
COPY 后的状态
最终镜像状态
```

但是 push/pull 通常分发的是：

```text
最终镜像 manifest
最终镜像 config
所有需要的 layer blobs
```

不会把每一步的中间镜像 config 都作为独立对象推送和拉取。

所以 pull 下来的镜像里，通常有：

```text
最终镜像 config
所有 layer blobs
history 构建记录
```

但不一定有：

```text
每个中间构建步骤的 image config
```

于是 `docker history` 在 IMAGE 列无法显示某个中间 image ID，就显示：

```text
<missing>
```

注意：

```text
<missing> 不是 layer 没下载
<missing> 不是镜像坏了
<missing> 只是 IMAGE 列没有可显示的中间镜像 ID
```

## 10. 为什么有的 history 记录有 ID，有的没有

常见原因：

```text
最终镜像本身有 ID，所以最上面的记录通常能显示 ID
中间构建步骤通常没有独立镜像对象，所以经常显示 <missing>
如果某个基础镜像本地刚好存在，相关历史记录可能能显示 ID
本地 build 的镜像可能保留更多构建缓存，因此可能显示更多 ID
pull 下来的镜像通常只有最终镜像和 layers，因此 <missing> 更多
Docker 版本、BuildKit、buildx、镜像格式也会影响 history 展示
```

判断方式：

```text
有 ID      本地找得到这一历史状态对应的镜像 config
<missing> 本地找不到这个中间镜像 config
```

## 11. layer 没有镜像名，Docker 怎么复用

layer 虽然没有镜像名，但它有自己的唯一编号，也就是 digest。

```text
镜像名       给人看的名字，例如 redis:7
layer digest 给 Docker 识别内容用的编号，例如 sha256:...
```

Docker 复用 layer 靠的不是镜像名，也不是 `docker history`，而是 layer digest。

假设镜像 A 需要：

```text
sha256:aaa
sha256:bbb
sha256:ccc
```

镜像 B 需要：

```text
sha256:aaa
sha256:bbb
sha256:ddd
```

如果本地已经有：

```text
sha256:aaa
sha256:bbb
```

再 pull 镜像 B 时，Docker 只需要下载：

```text
sha256:ddd
```

复用流程：

```text
docker pull 镜像名
        |
        v
获取 manifest
        |
        v
manifest 说明这个镜像需要哪些 layer digest
        |
        v
检查本地是否已有这些 digest
        |
        v
已有就复用，没有就下载
```

重点：

```text
复用靠 manifest 里的 layer digest
不是靠镜像名
不是靠 docker history
不是靠 Dockerfile
```

## 12. 查看镜像 layer 信息

查看镜像详细信息：

```bash
docker image inspect redis:7
```

重点看：

```text
RootFS.Layers
```

可以看到类似：

```json
"RootFS": {
  "Type": "layers",
  "Layers": [
    "sha256:...",
    "sha256:...",
    "sha256:..."
  ]
}
```

这些是本地文件系统层的 digest。实际 registry manifest 中的压缩 layer digest 可能和这里的 diffID 不完全一样，但核心思想一样：

```text
Docker 用内容哈希识别和复用层
```

## 13. 总结

```text
docker pull 下载的是 manifest、config 和 layers。
镜像名一般是 registry/namespace/repository:tag。
bitnami/redis 里的 bitnami 是 namespace，不是 registry。
docker login 默认登录 Docker Hub。
第三方/自建 registry pull 时通常必须写 registry 地址。
docker images -f 用来按 reference、label、dangling、before、since 过滤镜像。
docker history 看的是镜像 config 里的 history 元数据，不是原始 Dockerfile。
<missing> 不是 layer 缺失，而是没有可显示的中间镜像 config ID。
layer 复用靠 digest，Docker 根据 manifest 检查本地是否已有对应 layer。
```

## 14. docker rmi：删除镜像

`docker rmi` 删除的是本地镜像引用和镜像内容，不会删除远端 registry 里的镜像。

```bash
docker rmi nginx:1.25
docker rmi IMAGE_ID
```

镜像名和镜像 ID 的关系：

```text
repo:tag / repo@digest 只是引用
IMAGE ID 才是本地镜像对象
多个 repo:tag 可以指向同一个 IMAGE ID
```

区别：

```text
docker rmi repo:tag
= 删除指定 tag 引用；如果它是最后一个引用，才继续删除镜像对象和独占 layer。

docker rmi IMAGE_ID
= 尝试删除这个镜像对象；如果多个 tag 指向它，通常会报 conflict。

docker rmi -f IMAGE_ID
= 强制删除该 IMAGE ID 下的所有 tag 引用，再尝试删除镜像对象。
```

输出含义：

```text
Untagged: xxx
表示删除了 repo:tag 或 repo@digest 引用。

Deleted: sha256:xxx
表示删除了本地镜像对象、config 或独占 layer。
```

一个镜像删除时出现多个 `Deleted` 很正常，例如 Alpine 可能删掉：

```text
image config
rootfs layer
```

如果某个 layer 被其他镜像共享，不会被删除。

## 15. docker rmi 常用 options

强制删除：

```bash
docker rmi -f IMAGE
```

生产上慎用，尤其是 `-f IMAGE_ID`，因为它可能移除多个 tag。

不清理 dangling 父镜像：

```bash
docker rmi --no-prune IMAGE
```

默认删除目标镜像时，Docker 可能顺手清理已经没有引用的父镜像/中间镜像。`--no-prune` 表示只删目标镜像，不顺手清理这些无名父镜像。

这个选项主要用于保留构建缓存或调试中间层，日常清理很少用。

删除多平台镜像中的指定平台变体：

```bash
docker image rm --platform linux/amd64 --force IMAGE
```

多架构构建机上可能会用到。

## 16. docker image prune：批量清理镜像

`docker rmi` 是精确删除，`docker image prune` 是按规则批量清理。

默认只清 dangling images：

```bash
docker image prune
```

dangling image 通常长这样：

```text
<none>  <none>  IMAGE_ID
```

常见来源是反复构建同一个 tag：

```bash
docker build -t myapp:latest .
```

旧的 `myapp:latest` 失去 tag 后，就可能变成 `<none>:<none>`。

清理所有未被容器引用的镜像：

```bash
docker image prune -a
```

区别：

```text
dangling image
= 没有 repo:tag 的镜像。

unused image
= 没有任何容器引用的镜像，即使它还有 repo:tag。
```

所以：

```text
docker image prune
= 删除 dangling images，较保守。

docker image prune -a
= 删除所有 unused images，可能删掉有 tag 的旧版本，生产慎用。
```

生产更常用加时间过滤：

```bash
docker image prune -a --filter "until=168h"
```

表示删除 7 天前创建、且没有容器引用的镜像。

## 17. docker rm：删除容器

`docker rm` 删除的是容器，不是镜像。

```bash
docker rm CONTAINER
```

会删除：

```text
容器元数据
容器可写层
容器状态
容器日志
```

不会删除：

```text
镜像
named volume
bind mount 里的宿主机文件
远端 registry 镜像
```

运行中的容器默认删不掉：

```bash
docker stop app
docker rm app
```

强制删除运行容器：

```bash
docker rm -f app
```

`-f` 适合卡死或无状态容器，不适合数据库、队列、正在处理任务的 worker。

删除容器并删除匿名 volume：

```bash
docker rm -v app
```

注意：

```text
docker rm app
= 默认不删除 volume。

docker rm -v app
= 会删除匿名 volume。
```

如果数据在匿名 volume 里，`rm -v` 可能把数据一起删掉。生产数据库类容器慎用。

批量删除停止容器：

```bash
docker container prune
```

一次性容器可以运行时自动删除：

```bash
docker run --rm alpine echo hello
```

总结：

```text
docker rm  删除 container
docker rmi 删除 image

删镜像提示被容器占用时：
先 docker rm 容器
再 docker rmi 镜像
```

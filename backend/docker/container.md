## docker run 常用 options

基本格式：

```bash
docker run [OPTIONS] IMAGE[:TAG] [COMMAND] [ARG...]
```

注意：

- `OPTIONS` 必须写在镜像名前面。
- `IMAGE` 是镜像名，例如 `nginx`、`mysql:8`、`ubuntu:22.04`。
- `COMMAND [ARG...]` 写在镜像名后面，用来覆盖镜像默认的启动命令或作为入口命令的参数。

示例：

```bash
docker run -d --name nginx -p 8080:80 nginx
docker run --rm -it ubuntu bash
```

---

## --name：指定容器名

作用：给容器起一个固定名字，方便后续管理。

```bash
docker run --name my-nginx nginx
```

之后可以直接用名字操作容器：

```bash
docker stop my-nginx
docker start my-nginx
docker logs my-nginx
docker exec -it my-nginx sh
docker rm my-nginx
```

注意：

- 容器名必须唯一。
- 即使容器已经停止，只要没删除，名字仍然被占用。
- 如果提示 name already in use，需要先删除旧容器：

```bash
docker rm my-nginx
```

常见用法：

```bash
docker run -d --name nginx nginx
```

---

## -d：后台运行

`-d` 是 `--detach` 的缩写。

作用：让容器在后台运行，终端不会被容器进程占住。

```bash
docker run -d --name nginx nginx
```

适合运行服务类容器，例如：

- nginx
- mysql
- redis
- 后端服务

查看后台容器日志：

```bash
docker logs nginx
docker logs -f nginx
```

进入后台运行的容器：

```bash
docker exec -it nginx sh
```

注意：

- `-d` 只是后台运行，不代表容器一定会一直运行。
- 容器是否持续运行，取决于容器里的主进程是否还活着。
- 如果主进程结束，容器就会退出。

例如：

```bash
docker run -d ubuntu
```

这个容器通常会很快退出，因为 `ubuntu` 镜像默认没有一个持续运行的服务。

---

## -it：交互式终端

`-it` 通常一起使用，其实是两个参数：

```bash
-i    # keep STDIN open，保持标准输入打开
-t    # allocate a pseudo-TTY，分配一个伪终端
```

常用于进入一个临时 Linux 环境：

```bash
docker run -it ubuntu bash
docker run -it alpine sh
```

如果容器已经在后台运行，要进入已有容器，应使用：

```bash
docker exec -it 容器名 sh
docker exec -it 容器名 bash
```

注意：

- `docker run -it`：创建并启动一个新容器。
- `docker exec -it`：进入一个已经存在并且正在运行的容器。
- `alpine` 这类轻量镜像一般没有 `bash`，用 `sh`。

常见临时调试：

```bash
docker run --rm -it ubuntu bash
```

---

## --rm：退出后自动删除容器

作用：容器退出后自动删除容器本身。

```bash
docker run --rm alpine echo hello
```

适合：

- 临时测试命令
- 临时进入系统环境
- 一次性任务
- 不想留下 stopped container 的场景

示例：

```bash
docker run --rm -it ubuntu bash
```

退出 bash 后，这个容器会自动删除。

注意：

- `--rm` 删除的是容器，不一定删除 volume。
- 命名 volume 通常仍然保留。
- `--rm` 不能和 `--restart` 一起使用。

原因：

```text
--rm       表示容器退出就删除
--restart  表示容器退出后重启
```

这两个语义冲突。

---

## -p：端口映射

`-p` 是 `--publish` 的缩写。

作用：把容器里的端口映射到宿主机端口。

最常见格式：

```bash
docker run -d -p 8080:80 nginx
```

含义：

```text
宿主机端口:容器端口
```

所以：

```text
访问宿主机 localhost:8080
实际转发到容器里的 80 端口
```

常见写法：

```bash
-p 8080:80
-p 127.0.0.1:8080:80
-p 8080:80/tcp
-p 5353:53/udp
```

区别：

```bash
-p 8080:80
```

通常会绑定到宿主机所有网卡，外部机器可能也能访问。

```bash
-p 127.0.0.1:8080:80
```

只绑定本机回环地址，只能从宿主机本机访问，更安全。

需要注意：

- 前面是宿主机端口，后面是容器端口，不要写反。
- 宿主机端口不能被其他进程占用。
- 容器内服务一般要监听 `0.0.0.0`，不要只监听 `127.0.0.1`。
- 端口映射只负责把流量转进去，不负责启动容器内服务。

示例：

```bash
docker run -d --name nginx -p 8080:80 nginx
```

访问：

```bash
curl http://localhost:8080
```

---

## -e：设置环境变量

`-e` 是 `--env` 的缩写。

作用：给容器传环境变量。

```bash
docker run -e MYSQL_ROOT_PASSWORD=123456 mysql:8
```

格式：

```bash
-e KEY=VALUE
--env KEY=VALUE
```

多个环境变量写多个 `-e`：

```bash
docker run \
  -e MYSQL_ROOT_PASSWORD=123456 \
  -e MYSQL_DATABASE=test_db \
  mysql:8
```

也可以只写变量名，让 Docker 从宿主机当前环境变量中取值：

```bash
export TOKEN=abc
docker run -e TOKEN my-image
```

注意：

- 很多官方镜像通过环境变量做初始化配置，例如 MySQL、Postgres、Redis、应用服务等。
- 密码、token 直接写在命令里，可能会留在 shell history 中。
- 对敏感信息，生产环境更建议使用 secret 管理，不要直接裸写在命令里。

---

## --env-file：从文件读取环境变量

作用：从文件中批量读取环境变量。

```bash
docker run --env-file .env my-image
```

`.env` 示例：

```env
MYSQL_ROOT_PASSWORD=123456
MYSQL_DATABASE=test_db
APP_ENV=dev
```

可以和 `-e` 混用：

```bash
docker run --env-file .env -e APP_ENV=prod my-image
```

常见用途：

- 环境变量很多时，避免命令太长。
- 区分不同环境配置，例如 `.env.dev`、`.env.prod`。
- 本地开发时统一管理配置。

注意：

- `--env-file` 文件不是完整 shell 脚本。
- 建议只写简单的 `KEY=VALUE`。
- 不要依赖复杂 shell 展开。

不推荐这样写：

```env
A=$(date)
B=${HOME}/data
```

更稳的方式是提前在外部处理好值，再写入 env 文件。

---

## --restart：重启策略

作用：控制容器退出后 Docker 是否自动重启它。

常见值：

```bash
--restart no
--restart on-failure
--restart always
--restart unless-stopped
```

含义：

```text
no               默认值，不自动重启
on-failure       只有异常退出时才重启
always           只要退出就重启，Docker 启动后也会自动拉起
unless-stopped   类似 always，但手动 stop 后不会自动拉起
```

服务类容器常用：

```bash
docker run -d --name redis --restart unless-stopped redis
```

一般推荐：

```bash
--restart unless-stopped
```

注意：

- `--restart` 适合长期运行的服务。
- `--restart` 不能和 `--rm` 一起用。
- `--restart` 不是健康检查。
- 如果程序假死但主进程没有退出，Docker 不会因为 `--restart` 自动重启它。

示例：

```bash
docker run -d \
  --name nginx \
  --restart unless-stopped \
  -p 8080:80 \
  nginx
```

---

## --memory：限制内存

作用：限制容器最多能使用多少内存。

```bash
docker run --memory 512m nginx
docker run --memory 2g mysql:8
```

常见单位：

```text
128m
512m
1g
2g
```

适合：

- 防止某个容器吃光宿主机内存。
- 限制测试环境资源。
- 部署多个服务时做基础资源隔离。

示例：

```bash
docker run -d \
  --name app \
  --memory 512m \
  my-app
```

注意：

- 容器超过内存限制，可能会被 OOM kill。
- 数据库、Java 应用、构建任务不要限制得太小。
- `--memory` 是上限，不是预留内存。

---

## --cpus：限制 CPU

注意：常用参数是 `--cpus`，不是 `--cpu`。

作用：限制容器最多可以使用多少 CPU 计算资源。

```bash
docker run --cpus 1 nginx
docker run --cpus 0.5 nginx
docker run --cpus 2.5 my-app
```

含义：

```text
--cpus 1     最多约使用 1 个 CPU 核心
--cpus 0.5   最多约使用半个 CPU 核心
--cpus 2     最多约使用 2 个 CPU 核心
```

示例：

```bash
docker run -d \
  --name app \
  --cpus 1 \
  my-app
```

注意：

- `--cpus` 是限制可用 CPU 时间，不是保证独占这些 CPU。
- CPU 限制过小，服务可能响应变慢。
- 日常优先掌握 `--cpus` 即可。

相关但更底层的参数：

```bash
--cpu-shares
--cpu-quota
--cpuset-cpus
```

这些一般在需要更精细控制 CPU 调度时再看。

---

## -u / --user：指定容器内运行用户

作用：指定容器内主进程以哪个用户运行。

```bash
docker run -u 1000:1000 my-image
```

格式：

```bash
-u 用户
-u 用户:用户组
-u UID:GID
--user UID:GID
```

示例：

```bash
docker run --rm -u root ubuntu id
docker run --rm -u 1000:1000 ubuntu id
```

为什么重要：

- 很多镜像默认使用 root 运行。
- 使用普通用户运行更安全。
- 在挂载宿主机目录时，用户权限会直接影响文件读写。

挂载目录时尤其要注意：

```bash
docker run -u 1000:1000 -v /host/data:/data my-image
```

如果宿主机的 `/host/data` 不允许 UID `1000` 写入，容器里也写不了。

注意：

- `-u` 影响的是容器内进程用户。
- UID/GID 要和文件权限配合看。
- 用普通用户更安全，但也更容易遇到权限问题。
- 临时调试可以用 root，正式服务尽量不要无脑 root。

---

## --entrypoint：覆盖镜像入口命令

注意：参数名是 `--entrypoint`，不是 `--entrypoin`。

作用：覆盖镜像默认的 `ENTRYPOINT`。

常用于调试：

```bash
docker run --rm -it --entrypoint sh nginx
```

这条命令不会按 nginx 镜像原来的启动方式启动 nginx，而是直接进入 `sh`。

另一个例子：

```bash
docker run --rm --entrypoint echo alpine hello
```

这里：

```text
entrypoint = echo
参数 = hello
```

等价于在容器里执行：

```bash
echo hello
```

和 `COMMAND` 的关系：

```bash
docker run IMAGE COMMAND
```

通常是覆盖镜像默认的 `CMD`。

```bash
docker run --entrypoint xxx IMAGE COMMAND
```

表示覆盖镜像的 `ENTRYPOINT`，然后 `COMMAND` 会作为参数传给新的 entrypoint。

注意：

- `--entrypoint` 很适合调试。
- 正式部署时要谨慎使用。
- 很多镜像的 `ENTRYPOINT` 里会做初始化逻辑，例如生成配置、修正权限、准备环境。
- 覆盖 `ENTRYPOINT` 后，这些初始化逻辑可能不会执行。

常见调试用法：

```bash
docker run --rm -it --entrypoint sh nginx
docker run --rm -it --entrypoint bash ubuntu
```

---

## docker exec：在运行中的容器里启动新进程

作用：在一个已经运行的容器里，再执行一条新的命令。

基本格式：

```bash
docker exec [OPTIONS] CONTAINER COMMAND [ARG...]
```

常见用法：

```bash
docker exec nginx ls /usr/share/nginx/html
docker exec -it nginx sh
docker exec -it nginx bash
```

注意：

- `docker exec` 要求目标容器正在运行。
- `docker exec` 不会创建新容器。
- `docker exec` 不会替换容器原来的主进程。
- 如果容器主进程退出，容器停止，就不能再 `exec` 进去。

例如，一个容器里原本只有主进程：

```text
PID 1: nginx
```

执行：

```bash
docker exec -it nginx sh
```

之后可以理解为容器里多了一个新进程：

```text
PID 1: nginx
PID 23: sh
```

这个 `sh` 是新启动的进程，不是把 `nginx` 替换掉。

### docker exec 的原理

容器不是一个小虚拟机。容器里的程序，本质上还是宿主机上的普通进程，只是被放进了隔离环境里。

这个隔离环境主要包括：

```text
namespace  隔离进程、网络、挂载点、hostname 等视图
cgroup     限制 CPU、内存等资源
rootfs     容器看到的根文件系统
```

执行：

```bash
docker exec -it nginx sh
```

大致过程是：

```text
Docker CLI
  -> 把 exec 请求发给 dockerd
  -> dockerd/containerd 找到目标容器
  -> 在目标容器已有的 namespace、cgroup、rootfs 中启动新进程
  -> 执行 sh
```

所以，`docker exec` 的本质是：

```text
在目标容器已有的隔离环境里，启动一个新的宿主机进程。
```

这个新进程和容器原来的主进程共享同一套容器环境：

- 看到同一个容器文件系统。
- 处在同一个网络 namespace 里。
- 受到同一组 cgroup 资源限制。
- 在容器内部看到的是容器自己的进程视图。

### fd 0、1、2 怎么连接

执行交互式命令时：

```bash
docker exec -it nginx sh
```

可以粗略理解为：

```text
你的终端
  fd 0 / fd 1 / fd 2
    |
Docker CLI
    |
dockerd / containerd
    |
pipe 或 pty
    |
容器里的 exec 新进程
  fd 0 / fd 1 / fd 2
```

更准确地说，不是把宿主机终端的 `fd 0`、`fd 1`、`fd 2` 直接塞给容器进程，而是 Docker 在中间做了一层转接。

如果不使用 `-t`：

```bash
docker exec -i nginx cat
```

通常更像是通过 pipe 连接：

```text
你的 stdin  -> pipe -> 容器进程 fd 0
你的 stdout <- pipe <- 容器进程 fd 1
你的 stderr <- pipe <- 容器进程 fd 2
```

如果使用 `-t`：

```bash
docker exec -it nginx sh
```

Docker 会分配一个伪终端，也就是 pseudo-TTY：

```text
你的终端
  -> Docker CLI
  -> pty master
  -> pty slave
  -> 容器进程 fd 0 / fd 1 / fd 2
```

这时容器里的 shell 会认为自己运行在终端里，所以会启用：

- 提示符。
- 行编辑。
- 颜色输出。
- 交互式行为。

这就是为什么下面两个命令体验不一样：

```bash
docker exec nginx sh
docker exec -it nginx sh
```

前者没有交互式终端体验，后者才像真正进入了 shell。

### -i 和 -t 的区别

`-i` 表示保持标准输入打开：

```text
-i = keep STDIN open
```

`-t` 表示分配伪终端：

```text
-t = allocate a pseudo-TTY
```

常见组合：

```bash
docker exec -it 容器名 sh
docker exec -it 容器名 bash
```

注意：用了 `-t` 后，标准输出和标准错误通常会合并到同一个 tty 流里；不用 `-t` 时，Docker 可以分别处理 stdout 和 stderr。

### docker exec 和 docker run 的区别

`docker run` 是创建并启动一个新容器：

```bash
docker run ubuntu echo hello
```

`docker exec` 是在已有的、正在运行的容器里启动新进程：

```bash
docker exec nginx echo hello
```

对比：

```text
docker run   = 新建容器 + 启动容器里的进程
docker exec  = 在已有容器里启动一个新进程
```

### docker exec 和 docker attach 的区别

`docker exec` 会创建新进程：

```bash
docker exec -it nginx sh
```

可以理解为：

```text
容器原来的主进程还在运行
Docker 额外启动了一个 sh
```

`docker attach` 不会创建新进程：

```bash
docker attach nginx
```

它只是把当前终端接到容器主进程原本的输入输出上。

对比：

```text
docker exec    新开进程
docker attach  连接主进程的 fd 0、fd 1、fd 2
```

### shell 展开的坑

这个命令里的 `$HOME` 可能会先被宿主机 shell 展开：

```bash
docker exec nginx echo $HOME
```

如果想让 `$HOME` 在容器里展开，要让容器里的 shell 来解释：

```bash
docker exec nginx sh -c 'echo $HOME'
```

总结：

- `docker exec` 是在运行中的容器里启动新进程。
- 新进程会进入目标容器已有的 namespace、cgroup、rootfs。
- `exec` 不会替换容器主进程。
- `-i` 保持标准输入打开。
- `-t` 分配伪终端。
- `-it` 常用于进入容器调试。
- 交互式 `exec` 会把新进程的 `fd 0`、`fd 1`、`fd 2` 通过 pipe 或 pty 转接到当前终端。

---

## docker attach：连接到容器主进程

作用：把当前终端连接到一个正在运行的容器主进程上。

基本格式：

```bash
docker attach 容器名
docker attach 容器ID
```

注意：`attach` 不是进入容器，也不是新开一个 shell。

它连接的是容器启动时那个主程序的输入和输出。

可以先这样理解：

```text
docker attach = 把当前终端接到容器主程序的 fd 0、fd 1、fd 2
```

其中：

```text
fd 0 = 标准输入 stdin
fd 1 = 标准输出 stdout
fd 2 = 标准错误 stderr
```

也就是：

```text
你的键盘
  -> docker attach
  -> 容器主程序的 fd 0

容器主程序的 fd 1
  -> docker attach
  -> 你的屏幕

容器主程序的 fd 2
  -> docker attach
  -> 你的屏幕
```

例如：

```bash
docker run -di --name echoer busybox cat
```

这个容器的主程序是：

```bash
cat
```

`cat` 的特点是：输入什么，就输出什么。

连接到它：

```bash
docker attach echoer
```

这时你输入：

```text
hello
```

容器里的 `cat` 会收到这段输入，然后输出：

```text
hello
```

整个过程可以理解为：

```text
你的输入 -> docker attach -> 容器里的 cat
容器里的 cat 输出 -> docker attach -> 你的屏幕
```

再比如：

```bash
docker run -d --name demo busybox sh -c "while true; do echo hello; sleep 2; done"
```

这个容器的主程序会一直输出：

```text
hello
hello
hello
```

执行：

```bash
docker attach demo
```

你的终端就会接到这个主程序的输出上，于是能看到它继续打印。

### 多个程序时 attach 连接谁

一个容器里可以运行多个程序，但 `docker attach` 连接的仍然是容器的主进程。

如果主进程又启动了其他程序，可以这样理解：

```text
容器主进程
  - 程序 A
  - 程序 B
```

`attach` 主要接的是容器主进程那条输入输出线。

如果程序 A、程序 B 也把输出打印到这条线上，那么 `attach` 可能看到它们的输出混在一起：

```text
A: hello
B: running
A: hello
B: running
```

但如果某个程序把日志写到文件里，例如：

```text
/app/app.log
```

那 `docker attach` 看不到它，因为它没有输出到容器主进程这条标准输出线上。

输入也是类似的：

```text
你的键盘输入 -> 容器主进程的 fd 0
```

不是说容器里有多个程序，你输入一行内容，每个程序都能收到。

### 退出 attach

如果想退出 `attach`，但不停止容器，使用：

```text
Ctrl+P，然后 Ctrl+Q
```

如果直接按：

```text
Ctrl+C
```

可能会把停止信号发给容器主程序，导致容器退出。

总结：

- `docker attach` 连接的是容器主程序的 `fd 0`、`fd 1`、`fd 2`。
- `fd 0` 接收你的键盘输入。
- `fd 1` 和 `fd 2` 输出到你的屏幕。
- `attach` 不会创建新程序。
- `attach` 不等于进入容器。
- 多个程序时，关键看它们有没有把输出接到这条标准输出线上。

---

## 常见组合

### 临时进入 Ubuntu

```bash
docker run --rm -it ubuntu bash
```

含义：

- `--rm`：退出后自动删除容器。
- `-it`：交互式终端。
- `ubuntu`：使用 ubuntu 镜像。
- `bash`：启动 bash。

### 后台运行 nginx

```bash
docker run -d \
  --name nginx \
  -p 8080:80 \
  --restart unless-stopped \
  nginx
```

含义：

- `-d`：后台运行。
- `--name nginx`：容器名为 nginx。
- `-p 8080:80`：宿主机 8080 映射到容器 80。
- `--restart unless-stopped`：除非手动停止，否则自动重启。

### 运行 MySQL

```bash
docker run -d \
  --name mysql \
  -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=123456 \
  -e MYSQL_DATABASE=test_db \
  --restart unless-stopped \
  --memory 1g \
  --cpus 1 \
  mysql:8
```

注意：

- 真实使用 MySQL 通常还要挂载 volume 保存数据。
- 密码不要在生产环境中直接明文写在命令里。

### 调试镜像入口

```bash
docker run --rm -it --entrypoint sh nginx
```

含义：

- 不启动 nginx 默认服务。
- 直接进入容器 shell。
- 退出后自动删除容器。

---

## 重点易错总结

- `--name`：名字不能重复，停止的容器也占用名字。
- `-d`：后台运行不等于永远运行，主进程退出容器就退出。
- `-it`：`docker run -it` 是新建容器，`docker exec -it` 是进入已有容器。
- `--rm`：退出自动删除容器，不能和 `--restart` 一起用。
- `-p`：格式是 `宿主机端口:容器端口`，不要写反。
- `-p 8080:80`：可能暴露到所有网卡，公网机器要小心。
- `-e`：适合传配置，但敏感信息不要随便明文写命令里。
- `--env-file`：适合批量环境变量，但它不是 shell 脚本。
- `--restart`：只是重启退出的容器，不是健康检查。
- `--memory`：限制太小可能导致容器被 OOM kill。
- `--cpus`：常用参数是 `--cpus`，不是 `--cpu`。
- `-u`：更安全，但容易遇到挂载目录权限问题。
- `--entrypoint`：调试好用，部署时乱用可能跳过镜像初始化逻辑。
- `docker exec`：在运行中的容器里新启动一个进程，不会替换主进程。
- `docker exec -it`：通过伪终端进入容器调试，常用 `sh` 或 `bash`。
- `docker attach`：连接的是容器主进程的标准输入输出，不会新开进程。

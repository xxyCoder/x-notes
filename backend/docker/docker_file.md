## 1. Dockerfile 是什么

`Dockerfile` 是用来描述“如何构建镜像”的文件。

常见构建命令：

```bash
docker build -t my-app .
```

其中：

```text
docker build  根据 Dockerfile 构建镜像
-t my-app     给镜像打 tag
.             构建上下文，Dockerfile 中 COPY 的源文件通常来自这里
```

一个简单例子：

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
```

简单理解：

```text
FROM        选择基础镜像
WORKDIR     设置工作目录
COPY        复制文件到镜像
RUN         构建时执行命令，并把结果写入镜像层
CMD         容器启动时的默认命令
ENTRYPOINT  容器启动时的固定入口
ENV         设置环境变量
ARG         设置构建参数
EXPOSE      声明容器内服务端口
```

---

## 2. FROM：指定基础镜像，开启构建阶段

`FROM` 用来指定基础镜像，通常是 Dockerfile 的第一条有效指令。

```dockerfile
FROM nginx:alpine
FROM node:20
FROM python:3.12-slim
FROM alpine:3.20
```

意思是：当前镜像从哪个已有镜像开始构建。

例如：

```dockerfile
FROM alpine:3.20
RUN echo hello > /msg.txt
```

最终镜像基于 `alpine:3.20`，并额外包含 `/msg.txt`。

### 2.1 每个 FROM 都会开启一个新的构建阶段

一个 Dockerfile 中可以有多个 `FROM`。

每出现一个新的 `FROM`，就表示开启一个新的构建阶段。

```dockerfile
FROM alpine AS first
RUN echo first > /first.txt

FROM alpine AS second
RUN echo second > /second.txt
```

这里有两个阶段：

```text
first   第一个构建阶段
second  第二个构建阶段，也是最终镜像阶段
```

如果没有特别指定，最终产出的镜像来自最后一个阶段。

上面的最终镜像里有：

```text
/second.txt
```

但不会自动包含：

```text
/first.txt
```

因为第二个 `FROM alpine` 是一个全新的阶段。

### 2.2 多阶段构建的典型用途

多阶段构建常用于：

```text
构建阶段：使用较大的编译环境
运行阶段：只保留运行程序需要的文件
```

例如 Go 项目：

```dockerfile
FROM golang:1.22 AS builder

WORKDIR /src
COPY . .
RUN go build -o app main.go


FROM alpine:3.20

WORKDIR /app
COPY --from=builder /src/app ./app

CMD ["./app"]
```

这里：

```text
builder 阶段  用 golang 镜像编译程序
最终阶段      用 alpine 镜像运行程序
```

最终镜像只需要：

```text
/app/app
alpine 运行环境
```

不需要包含：

```text
Go 编译器
源码中间产物
构建缓存
```

这就是多阶段构建最常见的价值：构建环境和运行环境分离。

### 2.3 COPY --from：从其他阶段复制文件

跨阶段复制文件，主要使用：

```dockerfile
COPY --from=builder /src/app ./app
```

其中 `builder` 来自：

```dockerfile
FROM golang:1.22 AS builder
```

也可以用阶段序号：

```dockerfile
COPY --from=0 /src/app ./app
```

但更推荐使用阶段名：

```dockerfile
FROM golang:1.22 AS builder
```

这样更清楚，也不怕调整阶段顺序。

注意：

```dockerfile
RUN cp --from=builder /src/app /app/app
```

这是错的。

`RUN` 不能直接使用 `--from` 去另一个阶段拿文件。

跨阶段拿文件主要靠：

```dockerfile
COPY --from=...
```

### 2.4 多阶段构建不只用于 COPY

多阶段构建最常见的是配合 `COPY --from`，但不只是 `COPY` 能用到阶段。

`FROM` 本身也可以基于前面的阶段继续构建：

```dockerfile
FROM node:20 AS base
WORKDIR /app
COPY package*.json ./
RUN npm install

FROM base AS test
COPY . .
RUN npm test

FROM base AS prod
COPY . .
CMD ["node", "server.js"]
```

这里：

```text
test 阶段  基于 base 阶段继续构建
prod 阶段  也基于 base 阶段继续构建
```

`FROM base AS prod` 的意思是：把 `base` 阶段的结果当作新阶段的基础镜像。

还可以用 `--target` 只构建到某个阶段：

```bash
docker build --target test -t my-app-test .
```

适合只跑测试阶段、调试某个中间阶段。

### 2.5 FROM 会切断阶段作用域

这是 Dockerfile 里很重要的坑点。

每个 `FROM` 都会开启新阶段。前一个阶段里的很多内容，不会自动进入下一个阶段。

包括：

```text
ENV
ARG
WORKDIR
CMD
ENTRYPOINT
EXPOSE
文件系统变化
```

例如：

```dockerfile
FROM alpine AS build
ENV NAME=hello
WORKDIR /app
RUN echo data > data.txt

FROM alpine AS final
RUN echo $NAME
RUN pwd
```

第二个阶段是重新从 `alpine` 开始，所以：

```text
NAME 不存在
WORKDIR 不会继承 /app
data.txt 不会自动存在
```

`ARG` 也一样不会自动跨阶段：

```dockerfile
FROM alpine AS build
ARG NAME=hello
RUN echo $NAME

FROM alpine AS final
RUN echo $NAME
```

第二个阶段里 `$NAME` 是空的。

如果第二个阶段也要使用同一个构建参数，需要在第二个阶段重新声明：

```dockerfile
ARG NAME=hello

FROM alpine AS build
ARG NAME
RUN echo $NAME

FROM alpine AS final
ARG NAME
RUN echo $NAME
```

注意：写在第一个 `FROM` 前面的 `ARG` 可以用于 `FROM` 本身：

```dockerfile
ARG ALPINE_VERSION=3.20

FROM alpine:${ALPINE_VERSION}
```

但进入 `FROM` 阶段之后，如果还要在 `RUN`、`ENV`、`WORKDIR` 等指令中使用它，也要在阶段内重新声明：

```dockerfile
ARG ALPINE_VERSION=3.20

FROM alpine:${ALPINE_VERSION}

ARG ALPINE_VERSION
RUN echo $ALPINE_VERSION
```

如果想让第二阶段继承第一阶段，可以这样：

```dockerfile
FROM alpine AS base
ENV NAME=hello
WORKDIR /app
RUN echo data > data.txt

FROM base AS final
RUN echo $NAME
RUN pwd
RUN cat data.txt
```

因为 `final` 是 `FROM base`，所以它继承的是 `base` 阶段镜像。

如果只是想拿某个文件，用：

```dockerfile
FROM alpine AS build
RUN echo data > /data.txt

FROM alpine AS final
COPY --from=build /data.txt /data.txt
```

一句话记忆：

```text
FROM 新镜像名      新阶段从这个镜像重新开始
FROM 前一阶段名    新阶段基于前一阶段结果继续构建
COPY --from=阶段名 只复制指定文件
```

---

## 3. WORKDIR：设置工作目录

`WORKDIR` 用来设置后续指令的工作目录。

```dockerfile
WORKDIR /app
```

之后的很多指令都会以 `/app` 作为当前目录：

```dockerfile
WORKDIR /app
COPY package.json .
RUN npm install
CMD ["node", "server.js"]
```

这里：

```dockerfile
COPY package.json .
```

等价于把 `package.json` 复制到：

```text
/app/package.json
```

如果目录不存在，Docker 会自动创建。

### 3.1 WORKDIR 可以是相对路径

`WORKDIR` 后面不一定必须是绝对路径，也可以写相对路径。

但是相对路径是相对于上一个 `WORKDIR` 的。

例如：

```dockerfile
WORKDIR /app
WORKDIR logs
```

最终工作目录是：

```text
/app/logs
```

再比如：

```dockerfile
WORKDIR /app
WORKDIR ../data
```

最终工作目录大致是：

```text
/data
```

所以实际写 Dockerfile 时，通常推荐写绝对路径：

```dockerfile
WORKDIR /app
```

不是因为相对路径不能用，而是因为绝对路径更清楚，不容易被前面的 `WORKDIR` 影响。

---

## 4. COPY：复制文件到镜像

`COPY` 用来把构建上下文中的文件复制到镜像里。

```dockerfile
COPY package.json /app/package.json
COPY . /app
```

常见写法：

```dockerfile
WORKDIR /app
COPY . .
```

第一个 `.` 表示构建上下文中的当前目录。

第二个 `.` 表示容器里的当前工作目录，也就是 `/app`。

注意：

```text
COPY 的源文件通常只能来自构建上下文
```

例如：

```bash
docker build -t my-app .
```

最后的 `.` 就是构建上下文。

如果 Dockerfile 中写：

```dockerfile
COPY . .
```

复制的就是这个构建上下文里的内容。

### 4.1 COPY --from

在多阶段构建中，`COPY --from` 可以从其他阶段复制文件：

```dockerfile
FROM node:20 AS builder
WORKDIR /app
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
```

也可以从外部镜像复制文件：

```dockerfile
COPY --from=nginx:alpine /etc/nginx/nginx.conf /nginx.conf
```

不过最常见的还是从前面的构建阶段复制产物。

---

## 5. RUN：构建时执行命令，并写入镜像层

`RUN` 在 `docker build` 阶段执行。

```dockerfile
RUN apt-get update
RUN apt-get install -y curl
RUN npm install
```

准确地说：

```text
RUN = 构建时执行命令 + 把文件系统变化提交为新的镜像层
```

例如：

```dockerfile
RUN echo hello > /msg.txt
```

最终镜像里会包含：

```text
/msg.txt
```

但如果只是临时 shell 状态，不会作为运行时环境保留下来：

```dockerfile
RUN export NAME=hello
```

这个 `NAME` 只在当前这条 `RUN` 的 shell 进程中有效。

后续指令和容器运行时不会自动拿到它。

如果要持久化环境变量，应该使用：

```dockerfile
ENV NAME=hello
```

### 5.1 RUN 和镜像层

每条 `RUN` 通常会产生一个新的镜像层。

```dockerfile
RUN apt-get update
RUN apt-get install -y curl
RUN rm -rf /var/lib/apt/lists/*
```

这会产生多个层。

而且如果第一层已经写入了缓存文件，后面的删除只是形成新的删除记录，可能不能真正减少前面层的体积。

所以常写成：

```dockerfile
RUN apt-get update \
    && apt-get install -y curl \
    && rm -rf /var/lib/apt/lists/*
```

这样安装和清理发生在同一个镜像层中，更利于控制镜像体积。

---

## 6. CMD：容器启动时的默认命令

`CMD` 用来设置容器启动时默认执行的命令。

```dockerfile
CMD ["node", "server.js"]
```

它发生在：

```text
docker run 阶段
```

不是 `docker build` 阶段。

例如：

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
CMD ["node", "server.js"]
```

运行：

```bash
docker run my-app
```

默认执行：

```bash
node server.js
```

如果运行容器时手动指定命令，`CMD` 会被覆盖：

```bash
docker run my-app node test.js
```

这时执行的是：

```bash
node test.js
```

而不是：

```bash
node server.js
```

### 6.1 推荐 exec 形式

推荐使用 JSON 数组形式：

```dockerfile
CMD ["node", "server.js"]
```

这叫 exec 形式。

也可以写 shell 形式：

```dockerfile
CMD node server.js
```

但 exec 形式更明确，信号处理也更好。

---

## 7. ENTRYPOINT：容器启动时的固定入口

`ENTRYPOINT` 用来设置容器启动时固定执行的程序。

```dockerfile
ENTRYPOINT ["python", "app.py"]
```

它也发生在 `docker run` 阶段。

和 `CMD` 的区别：

```text
ENTRYPOINT  更像固定主程序
CMD         更像默认参数
```

例如：

```dockerfile
FROM alpine
ENTRYPOINT ["echo"]
CMD ["hello"]
```

运行：

```bash
docker run my-image
```

实际执行：

```bash
echo hello
```

运行：

```bash
docker run my-image world
```

实际执行：

```bash
echo world
```

也就是说，`CMD` 会作为 `ENTRYPOINT` 的默认参数。

### 7.1 ENTRYPOINT 和 CMD 同时写会不会冲突

一般不会因为 Dockerfile 写了两者就报错。

Docker 会把它们组合起来。

例如：

```dockerfile
ENTRYPOINT ["python"]
CMD ["app.py"]
```

实际默认执行：

```bash
python app.py
```

这是合理的。

但如果 `CMD` 也写成了另一个完整可执行命令，就可能语义错误。

例如：

```dockerfile
ENTRYPOINT ["python"]
CMD ["node", "server.js"]
```

实际会执行：

```bash
python node server.js
```

Docker 本身不一定报错，但容器里的程序大概率会报错，因为 `python` 会把 `node` 当成脚本文件或参数。

所以要记住：

```text
如果写了 ENTRYPOINT，CMD 通常写默认参数
如果 CMD 要写完整命令，通常不要再写 ENTRYPOINT
```

### 7.2 docker run 后面的参数和 ENTRYPOINT

当镜像有 `ENTRYPOINT` 时，`docker run IMAGE 后面的内容` 默认会替换 `CMD`，作为 `ENTRYPOINT` 的参数。

```dockerfile
ENTRYPOINT ["echo"]
CMD ["hello"]
```

运行：

```bash
docker run my-image abc
```

实际执行：

```bash
echo abc
```

如果确实要覆盖 `ENTRYPOINT`，可以用：

```bash
docker run --entrypoint sh my-image
```

---

## 8. ENV：设置环境变量

`ENV` 用来设置环境变量。

```dockerfile
ENV NODE_ENV=production
ENV PORT=3000
```

这些变量会进入镜像配置，并且容器运行时也能看到。

例如应用中可以读取：

```js
process.env.NODE_ENV
```

也可以一次设置多个：

```dockerfile
ENV NODE_ENV=production PORT=3000
```

运行容器时可以覆盖：

```bash
docker run -e PORT=8080 my-app
```

### 8.1 ENV 可以在后续 Dockerfile 指令中使用

`ENV` 声明后的变量，可以在后续 Dockerfile 指令中使用。

例如：

```dockerfile
ENV APP_HOME=/app

WORKDIR $APP_HOME
COPY . $APP_HOME
RUN echo $APP_HOME
```

这里 `$APP_HOME` 在后续指令中可用。

注意：必须是在声明之后。

```dockerfile
WORKDIR $APP_HOME
ENV APP_HOME=/app
```

这种写法里，前面的 `WORKDIR $APP_HOME` 用不到后面才声明的变量。

### 8.2 ENV 和 shell 展开

下面这种 shell 形式会展开变量：

```dockerfile
CMD echo $APP_HOME
```

或者：

```dockerfile
CMD ["sh", "-c", "echo $APP_HOME"]
```

但 exec JSON 形式不会由 shell 自动展开：

```dockerfile
CMD ["echo", "$APP_HOME"]
```

这会把字符串 `$APP_HOME` 原样传给 `echo`。

也就是输出：

```text
$APP_HOME
```

如果想展开变量，要显式经过 shell：

```dockerfile
CMD ["sh", "-c", "echo $APP_HOME"]
```

### 8.3 ENV 不会自动跨 FROM 阶段

这是重要坑点。

```dockerfile
FROM alpine AS build
ENV NAME=hello
RUN echo $NAME

FROM alpine AS final
RUN echo $NAME
```

第二阶段中 `$NAME` 是空的。

因为第二个 `FROM alpine` 开启了新的阶段，不继承前一阶段的 `ENV`。

如果想在第二阶段继续使用，需要重新声明：

```dockerfile
FROM alpine AS build
ENV NAME=hello

FROM alpine AS final
ENV NAME=hello
RUN echo $NAME
```

或者让第二阶段基于第一阶段：

```dockerfile
FROM alpine AS base
ENV NAME=hello

FROM base AS final
RUN echo $NAME
```

---

## 9. ARG：构建参数

`ARG` 用来声明构建参数。

它主要在 `docker build` 阶段使用。

```dockerfile
ARG VERSION=1.0.0
RUN echo $VERSION
```

构建时可以传入：

```bash
docker build --build-arg VERSION=2.0.0 -t my-app .
```

### 9.1 ARG 和 ENV 的区别

简单区别：

```text
ARG  构建时参数，主要给 docker build 用
ENV  环境变量，会保存在镜像和容器运行环境中
```

例如：

```dockerfile
ARG APP_VERSION=1.0.0
ENV APP_VERSION=$APP_VERSION
```

这里：

```text
ARG APP_VERSION  接收构建时传入的值
ENV APP_VERSION  把这个值保存到镜像和容器环境中
```

### 9.2 FROM 前的 ARG 可以用于 FROM

`ARG` 有一个特殊规则：可以写在第一个 `FROM` 前面，用来给 `FROM` 使用。

```dockerfile
ARG ALPINE_VERSION=3.20

FROM alpine:${ALPINE_VERSION}
```

构建时：

```bash
docker build --build-arg ALPINE_VERSION=3.19 -t my-app .
```

实际基础镜像就是：

```text
alpine:3.19
```

### 9.3 FROM 前的 ARG 进入阶段后要重新声明

这是 Dockerfile 中非常容易踩的坑。

```dockerfile
ARG ALPINE_VERSION=3.20

FROM alpine:${ALPINE_VERSION}

RUN echo $ALPINE_VERSION
```

这里 `FROM alpine:${ALPINE_VERSION}` 可以用到 `ALPINE_VERSION`。

但进入构建阶段后，`RUN echo $ALPINE_VERSION` 不一定能按你预期使用它。

如果要在阶段内部继续使用，需要重新声明：

```dockerfile
ARG ALPINE_VERSION=3.20

FROM alpine:${ALPINE_VERSION}

ARG ALPINE_VERSION
RUN echo $ALPINE_VERSION
```

记住：

```text
FROM 前的 ARG 可以给 FROM 用
进入每个 FROM 阶段后，要重新 ARG 声明，RUN/ENV/WORKDIR 等后续指令才能使用
```

### 9.4 每个阶段都要重新声明 ARG

阶段内声明的 `ARG` 不会自动跨到下一个阶段。

```dockerfile
FROM alpine AS build
ARG NAME=hello
RUN echo $NAME

FROM alpine AS final
RUN echo $NAME
```

第二阶段中 `$NAME` 是空的。

如果多个阶段都要用同一个构建参数，可以这样：

```dockerfile
ARG NAME=hello

FROM alpine AS build
ARG NAME
RUN echo $NAME

FROM alpine AS final
ARG NAME
RUN echo $NAME
```

构建时：

```bash
docker build --build-arg NAME=world .
```

两个阶段都可以拿到 `world`，前提是每个阶段内部都写了：

```dockerfile
ARG NAME
```

### 9.5 ARG 转 ENV

如果希望构建参数最终也进入容器运行环境，需要显式转成 `ENV`：

```dockerfile
ARG APP_VERSION=1.0.0
ENV APP_VERSION=$APP_VERSION
```

这样容器运行时可以看到：

```bash
docker run my-app env
```

里面会有：

```text
APP_VERSION=1.0.0
```

---

## 10. EXPOSE：声明容器内服务端口

`EXPOSE` 用来声明容器里的服务监听哪个端口。

```dockerfile
EXPOSE 3000
```

注意：`EXPOSE` 只是声明，是镜像元数据。

它不会真的把端口发布到宿主机。

真正发布端口要用：

```bash
docker run -p 8080:3000 my-app
```

含义：

```text
宿主机 8080  ->  容器 3000
```

访问：

```bash
curl http://localhost:8080
```

实际进入容器里的 `3000` 端口。

### 10.1 没写 EXPOSE，也可以用 -p

如果 Dockerfile 没有写：

```dockerfile
EXPOSE 3000
```

但运行时写：

```bash
docker run -p 8080:3000 my-app
```

照样可以映射端口。

前提是容器里的程序真的监听了 `3000`。

也就是说：

```text
EXPOSE 不决定 -p 能不能用
-p 才是真正发布端口
```

常见误区：

```text
写了 EXPOSE 3000，但没写 -p
```

宿主机通常仍然访问不到容器端口。

反过来：

```text
没写 EXPOSE，但写了 -p 8080:3000
```

只要容器内服务监听 `3000`，宿主机就可以通过 `8080` 访问。

---

## 11. 常见组合示例

### 11.1 Node.js 普通镜像

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
```

说明：

```text
FROM      基于 node:20-alpine
WORKDIR   后续操作默认在 /app
COPY      先复制依赖文件，再复制业务代码
RUN       构建时安装依赖，依赖会进入镜像层
ENV       设置运行时环境变量
EXPOSE    声明容器服务端口
CMD       默认启动 node server.js
```

### 11.2 Go 多阶段构建

```dockerfile
FROM golang:1.22 AS builder

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN go build -o app ./cmd/app


FROM alpine:3.20

WORKDIR /app
COPY --from=builder /src/app ./app

EXPOSE 8080

CMD ["./app"]
```

说明：

```text
builder 阶段  负责下载依赖和编译
最终阶段      只复制编译后的二进制文件
```

最终镜像不会自动包含 `builder` 阶段里的 Go 编译器和源码。

### 11.3 ENTRYPOINT + CMD

```dockerfile
FROM alpine

ENTRYPOINT ["echo"]
CMD ["hello"]
```

运行：

```bash
docker run my-image
```

实际执行：

```bash
echo hello
```

运行：

```bash
docker run my-image world
```

实际执行：

```bash
echo world
```

---

## 12. 重点坑点总结

### 12.1 FROM 会开启新阶段

```text
每个 FROM 都是一个新阶段。
前一阶段的 ENV、WORKDIR、文件系统变化、CMD、ENTRYPOINT、EXPOSE 等不会自动进入下一阶段。
```

除非：

```dockerfile
FROM base AS final
```

或者显式复制：

```dockerfile
COPY --from=base /some/file /some/file
```

### 12.2 WORKDIR 相对路径依赖上一个 WORKDIR

```dockerfile
WORKDIR /app
WORKDIR logs
```

最终是：

```text
/app/logs
```

推荐写绝对路径：

```dockerfile
WORKDIR /app
```

### 12.3 RUN 写入的是文件系统结果

```dockerfile
RUN echo hello > /msg.txt
```

会把 `/msg.txt` 写入镜像层。

但：

```dockerfile
RUN export NAME=hello
```

不会把 `NAME` 作为运行时环境变量保留下来。

### 12.4 ENTRYPOINT 和 CMD 不冲突，但会组合

```dockerfile
ENTRYPOINT ["python"]
CMD ["app.py"]
```

实际是：

```bash
python app.py
```

如果写成：

```dockerfile
ENTRYPOINT ["python"]
CMD ["node", "server.js"]
```

实际是：

```bash
python node server.js
```

Dockerfile 本身不一定报错，但很可能不是想要的行为。

### 12.5 EXPOSE 不等于发布端口

```dockerfile
EXPOSE 3000
```

只是声明。

真正发布端口：

```bash
docker run -p 8080:3000 my-app
```

没写 `EXPOSE`，只要写了 `-p`，也可以映射。

### 12.6 ENV 能在后续指令中使用，但不能自动跨新 FROM

```dockerfile
ENV APP_HOME=/app
WORKDIR $APP_HOME
```

这是可以的。

但：

```dockerfile
FROM alpine AS build
ENV NAME=hello

FROM alpine AS final
RUN echo $NAME
```

第二阶段拿不到 `$NAME`。

### 12.7 ARG 的作用域最容易踩坑

```dockerfile
ARG VERSION=3.20

FROM alpine:${VERSION}

ARG VERSION
RUN echo $VERSION
```

规则：

```text
FROM 前的 ARG 可以用于 FROM
进入 FROM 阶段后，如果还想用，要重新 ARG 声明
每个 FROM 阶段内部都要各自声明 ARG
ARG 不会自动成为容器运行时环境变量
要进入运行环境，需要 ARG 转 ENV
```

例如：

```dockerfile
ARG APP_VERSION=1.0.0
ENV APP_VERSION=$APP_VERSION
```

---

## 13. 一句话总览

```text
FROM        指定基础镜像；每个 FROM 都开启一个新构建阶段
WORKDIR     设置工作目录；相对路径基于上一个 WORKDIR，推荐写绝对路径
COPY        从构建上下文复制文件；COPY --from 可从其他阶段复制文件
RUN         构建时执行命令，并把文件系统变化写入镜像层
CMD         容器启动时的默认命令，可被 docker run 后面的命令覆盖
ENTRYPOINT  容器启动时的固定入口，CMD 通常作为它的默认参数
ENV         设置环境变量，后续指令可用，也会进入容器运行环境
ARG         构建参数；FROM 前可用于 FROM，阶段内要重新声明才能继续用
EXPOSE      声明容器内端口，不等于发布端口；-p 才是真正端口映射
```

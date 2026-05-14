## 1. 核心理解

`docker compose` 不是一种新的容器类型，它是根据 `compose.yaml` 把一组 Docker 对象统一管理起来：

```text
image      镜像，容器运行模板
container  真正运行的进程隔离环境
network    容器之间通信的网络
volume     容器外部的持久化数据
```

普通 Docker 命令通常直接操作某个对象：

```bash
docker image pull postgres:16
docker container start my-db
docker network create backend
docker volume create db-data
```

Compose 是按项目和服务来操作一组对象：

```bash
docker compose up -d
docker compose logs api
docker compose exec db psql -U postgres
docker compose down
```

可以简单理解为：

```text
docker container/image/network/volume
= 直接操作 Docker 对象

docker compose
= 根据 compose.yaml，批量创建、启动、停止、查看这些对象
```

## 2. 完整示例

假设有一个 `shop` 项目，包含 5 个服务：

```text
web      前端入口，使用 nginx 镜像
api      后端 API，本地 Dockerfile 构建
worker   后台任务，复用 api 镜像
db       PostgreSQL 数据库
redis    Redis 缓存
```

示例 `compose.yaml`：

```yaml
name: shop

services:
  web:
    image: nginx:1.27
    ports:
      - "8080:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - api
    networks:
      - frontend

  api:
    build:
      context: ./api
      dockerfile: Dockerfile
    image: ghcr.io/acme/shop-api:dev
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://postgres:secret@db:5432/shop
      REDIS_URL: redis://redis:6379
    depends_on:
      - db
      - redis
    volumes:
      - ./api:/app
    networks:
      - frontend
      - backend

  worker:
    image: ghcr.io/acme/shop-api:dev
    command: ["node", "worker.js"]
    environment:
      DATABASE_URL: postgres://postgres:secret@db:5432/shop
      REDIS_URL: redis://redis:6379
    depends_on:
      - db
      - redis
    networks:
      - backend

  db:
    image: postgres:16
    environment:
      POSTGRES_DB: shop
      POSTGRES_PASSWORD: secret
    volumes:
      - db-data:/var/lib/postgresql/data
    networks:
      - backend

  redis:
    image: redis:7
    volumes:
      - redis-data:/data
    networks:
      - backend

volumes:
  db-data:
  redis-data:

networks:
  frontend:
  backend:
```

执行：

```bash
docker compose up -d --build
```

最终会产生这些 Docker 对象：

```text
images:
  nginx:1.27
  ghcr.io/acme/shop-api:dev
  postgres:16
  redis:7

containers:
  shop-web-1
  shop-api-1
  shop-worker-1
  shop-db-1
  shop-redis-1

networks:
  shop_frontend
  shop_backend

volumes:
  shop_db-data
  shop_redis-data
```

## 3. Compose 里的名字分别是什么

### `name`

```yaml
name: shop
```

这是 Compose 项目名。

项目名会影响容器、网络、volume 的名字：

```text
shop-api-1
shop-db-1
shop_frontend
shop_backend
shop_db-data
```

也可以用 `-p` 指定项目名：

```bash
docker compose -p shop-dev up -d
```

这样资源名会变成：

```text
shop-dev-api-1
shop-dev-db-1
shop-dev_backend
shop-dev_db-data
```

同一份 `compose.yaml`，用不同项目名可以启动多套环境。

### `services`

```yaml
services:
  api:
  db:
  redis:
```

`api`、`db`、`redis` 是 Compose 服务名，不是容器名。

服务名用于 Compose 命令：

```bash
docker compose logs api
docker compose exec db psql -U postgres
docker compose restart redis
```

Compose 会根据服务创建容器：

```text
api   -> shop-api-1
db    -> shop-db-1
redis -> shop-redis-1
```

如果扩容：

```bash
docker compose up -d --scale worker=3
```

会创建：

```text
shop-worker-1
shop-worker-2
shop-worker-3
```

### `image`

```yaml
image: postgres:16
image: redis:7
image: ghcr.io/acme/shop-api:dev
```

`image` 是镜像名。镜像是容器运行的模板。

`docker compose pull` 拉的就是这些 `image`。

`docker compose push` 推的也是这些 `image`。

### `build`

```yaml
build:
  context: ./api
  dockerfile: Dockerfile
image: ghcr.io/acme/shop-api:dev
```

`build` 表示这个服务的镜像可以从本地 Dockerfile 构建出来。

它大致等价于：

```bash
docker build -f ./api/Dockerfile -t ghcr.io/acme/shop-api:dev ./api
```

其中：

```text
context: ./api
```

表示构建上下文是 `./api`。

Dockerfile 里的：

```dockerfile
COPY . /app
```

这里的 `.` 指的是 `./api` 目录，而不是整个项目根目录。

```text
dockerfile: Dockerfile
```

表示使用：

```text
./api/Dockerfile
```

如果同时写了：

```yaml
image: ghcr.io/acme/shop-api:dev
```

那么构建出来的镜像会被命名为：

```text
ghcr.io/acme/shop-api:dev
```

### `container`

Compose 文件里通常不手动指定容器名。

Compose 会自动生成：

```text
项目名-服务名-序号
```

比如：

```text
shop-api-1
shop-db-1
shop-redis-1
```

日常不要直接依赖容器名，优先用服务名：

```bash
docker compose exec api sh
```

而不是：

```bash
docker exec -it shop-api-1 sh
```

### `networks`

```yaml
networks:
  frontend:
  backend:
```

Compose 会创建 Docker network：

```text
shop_frontend
shop_backend
```

服务加入哪个网络，就能和同网络里的服务通信。

本例中：

```text
web     -> frontend
api     -> frontend + backend
worker  -> backend
db      -> backend
redis   -> backend
```

所以：

```text
web 可以访问 api
api 可以访问 db 和 redis
worker 可以访问 db 和 redis
web 不能直接访问 db 和 redis
```

同一个 Compose 网络里的容器可以用服务名互相访问：

```text
db:5432
redis:6379
api:3000
```

例如：

```yaml
DATABASE_URL: postgres://postgres:secret@db:5432/shop
```

这里的 `db` 是服务名，也是 Docker 网络里的 DNS 名。

### `volumes`

```yaml
volumes:
  db-data:
  redis-data:
```

Compose 会创建 Docker volume：

```text
shop_db-data
shop_redis-data
```

再挂载进容器：

```yaml
db:
  volumes:
    - db-data:/var/lib/postgresql/data
```

意思是：

```text
把 volume shop_db-data 挂到 db 容器的 /var/lib/postgresql/data
```

容器删除后，volume 默认还在，所以数据库数据还在。

如果执行：

```bash
docker compose down -v
```

volume 也会被删除，数据就会丢失。

### bind mount

```yaml
volumes:
  - ./api:/app
```

这种不是 named volume，而是 bind mount。

意思是：

```text
把宿主机当前项目下的 ./api 目录挂进容器的 /app
```

常用于开发环境，让容器能看到宿主机上的代码改动。

### `ports`

```yaml
ports:
  - "8080:80"
```

格式是：

```text
宿主机端口:容器端口
```

意思是：

```text
访问宿主机 localhost:8080
会转发到 web 容器的 80 端口
```

如果服务没有写 `ports`，宿主机不能直接通过 `localhost` 访问它，但同网络里的其他容器仍然可以用服务名访问它。

例如 `db` 没有暴露 `5432` 到宿主机，但是 `api` 可以访问：

```text
db:5432
```

### `environment`

```yaml
environment:
  POSTGRES_DB: shop
  POSTGRES_PASSWORD: secret
```

这些会变成容器里的环境变量。

等价理解为 `docker run` 的：

```bash
-e POSTGRES_DB=shop
-e POSTGRES_PASSWORD=secret
```

### `depends_on`

```yaml
depends_on:
  - db
  - redis
```

表示启动顺序依赖。

`api` 依赖 `db` 和 `redis`，所以 `docker compose up` 会先处理 `db`、`redis`，再处理 `api`。

注意：默认 `depends_on` 主要保证启动顺序，不保证数据库已经完全可用。

也就是说，`db` 容器 started 不代表 Postgres 已经 ready。

严谨项目通常会配合 `healthcheck`。

### `command`

```yaml
command: ["node", "worker.js"]
```

覆盖镜像里的默认启动命令。

例如 `api` 和 `worker` 使用同一个镜像：

```text
ghcr.io/acme/shop-api:dev
```

但是：

```text
api    启动 node server.js
worker 启动 node worker.js
```

`worker` 就可以通过 `command` 覆盖默认命令。

## 4. `docker compose build` 的具体流程

执行：

```bash
docker compose build api
```

Compose 会找 `api` 服务里的 `build:`：

```yaml
api:
  build:
    context: ./api
    dockerfile: Dockerfile
  image: ghcr.io/acme/shop-api:dev
```

然后做这些事：

```text
1. 找到构建目录 ./api
2. 找到 Dockerfile ./api/Dockerfile
3. 把 ./api 作为 build context 发给 Docker 构建器
4. 执行 Dockerfile 里的 FROM、WORKDIR、COPY、RUN、CMD 等指令
5. 生成一个 image
6. 给这个 image 打 tag: ghcr.io/acme/shop-api:dev
```

假设 Dockerfile 是：

```dockerfile
FROM node:22
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
CMD ["node", "server.js"]
```

构建时的动作是：

```text
FROM node:22
  准备基础镜像 node:22，本地没有就拉取

WORKDIR /app
  设置镜像里的工作目录

COPY package.json package-lock.json ./
  从宿主机 ./api 目录复制文件进镜像

RUN npm ci
  在构建阶段安装依赖，结果成为镜像的一层

COPY . .
  把 ./api 目录里的代码复制进镜像

CMD ["node", "server.js"]
  设置容器启动时默认执行的命令
```

最终得到：

```text
image: ghcr.io/acme/shop-api:dev
```

重点：

```text
docker compose build 只生成或更新 image
它不创建 container
它不启动服务
它不创建 network
它不创建 volume
```

## 5. `docker compose up` 的具体流程

执行：

```bash
docker compose up -d --build
```

完整流程可以理解为：

```text
1. 读取 compose.yaml
2. 读取 .env 和当前 shell 环境变量
3. 合并 -f 指定的多个 compose 文件
4. 确定项目名 shop
5. 创建缺失的 network
6. 创建缺失的 volume
7. 准备服务需要的 image
8. 按依赖关系创建 container
9. 给 container 设置环境变量、端口、挂载、网络
10. 启动 container
11. 因为 -d，启动后在后台运行并返回
```

具体到上面的 `shop` 项目：

### 第 1 步：解析配置

Compose 读取：

```text
compose.yaml
.env
命令行 -f 指定的 compose 文件
当前 shell 环境变量
```

然后得到最终配置。

可以用下面命令预览：

```bash
docker compose config
```

### 第 2 步：确定项目名

```yaml
name: shop
```

所以项目名是：

```text
shop
```

### 第 3 步：创建 network

配置里有：

```yaml
networks:
  frontend:
  backend:
```

Compose 会检查有没有：

```text
shop_frontend
shop_backend
```

没有就创建，类似：

```bash
docker network create shop_frontend
docker network create shop_backend
```

### 第 4 步：创建 volume

配置里有：

```yaml
volumes:
  db-data:
  redis-data:
```

Compose 会检查有没有：

```text
shop_db-data
shop_redis-data
```

没有就创建，类似：

```bash
docker volume create shop_db-data
docker volume create shop_redis-data
```

### 第 5 步：准备 image

对 `web`：

```yaml
image: nginx:1.27
```

本地没有就拉：

```bash
docker pull nginx:1.27
```

对 `db`：

```yaml
image: postgres:16
```

本地没有就拉：

```bash
docker pull postgres:16
```

对 `redis`：

```yaml
image: redis:7
```

本地没有就拉：

```bash
docker pull redis:7
```

对 `api`：

```yaml
build:
  context: ./api
  dockerfile: Dockerfile
image: ghcr.io/acme/shop-api:dev
```

因为用了 `--build`，Compose 会先构建：

```bash
docker build -f ./api/Dockerfile -t ghcr.io/acme/shop-api:dev ./api
```

`worker` 使用同一个镜像：

```yaml
image: ghcr.io/acme/shop-api:dev
```

所以它会复用 `api` 构建出来的镜像。

### 第 6 步：创建 db 容器

Compose 根据 `db` 服务创建容器：

```text
container: shop-db-1
image: postgres:16
network: shop_backend
volume: shop_db-data -> /var/lib/postgresql/data
environment:
  POSTGRES_DB=shop
  POSTGRES_PASSWORD=secret
```

等价理解：

```bash
docker create \
  --name shop-db-1 \
  --network shop_backend \
  -e POSTGRES_DB=shop \
  -e POSTGRES_PASSWORD=secret \
  -v shop_db-data:/var/lib/postgresql/data \
  postgres:16
```

### 第 7 步：启动 db 容器

```bash
docker start shop-db-1
```

Postgres 主进程开始运行。

### 第 8 步：创建 redis 容器

```text
container: shop-redis-1
image: redis:7
network: shop_backend
volume: shop_redis-data -> /data
```

等价理解：

```bash
docker create \
  --name shop-redis-1 \
  --network shop_backend \
  -v shop_redis-data:/data \
  redis:7
```

### 第 9 步：启动 redis 容器

```bash
docker start shop-redis-1
```

### 第 10 步：创建 api 容器

```text
container: shop-api-1
image: ghcr.io/acme/shop-api:dev
networks:
  shop_frontend
  shop_backend
ports:
  host 3000 -> container 3000
bind mount:
  ./api -> /app
environment:
  DATABASE_URL=postgres://postgres:secret@db:5432/shop
  REDIS_URL=redis://redis:6379
```

等价理解：

```bash
docker create \
  --name shop-api-1 \
  --network shop_backend \
  -p 3000:3000 \
  -e DATABASE_URL=postgres://postgres:secret@db:5432/shop \
  -e REDIS_URL=redis://redis:6379 \
  -v ./api:/app \
  ghcr.io/acme/shop-api:dev
```

因为 `api` 同时属于 `frontend` 和 `backend`，Compose 还会把它连接到另一个网络。

等价理解：

```bash
docker network connect shop_frontend shop-api-1
```

### 第 11 步：启动 api 容器

```bash
docker start shop-api-1
```

容器启动后，会执行镜像默认命令，比如：

```text
node server.js
```

### 第 12 步：创建 worker 容器

```text
container: shop-worker-1
image: ghcr.io/acme/shop-api:dev
network: shop_backend
command: node worker.js
environment:
  DATABASE_URL=postgres://postgres:secret@db:5432/shop
  REDIS_URL=redis://redis:6379
```

它和 `api` 用同一个 image，但是启动命令不同。

### 第 13 步：启动 worker 容器

```bash
docker start shop-worker-1
```

启动后执行：

```bash
node worker.js
```

### 第 14 步：创建 web 容器

```text
container: shop-web-1
image: nginx:1.27
network: shop_frontend
ports:
  host 8080 -> container 80
bind mount:
  ./nginx.conf -> /etc/nginx/conf.d/default.conf
```

等价理解：

```bash
docker create \
  --name shop-web-1 \
  --network shop_frontend \
  -p 8080:80 \
  -v ./nginx.conf:/etc/nginx/conf.d/default.conf:ro \
  nginx:1.27
```

### 第 15 步：启动 web 容器

```bash
docker start shop-web-1
```

此时访问：

```text
http://localhost:8080
```

会进入：

```text
shop-web-1:80
```

### `up` 完成后的结果

```text
images:
  nginx:1.27
  ghcr.io/acme/shop-api:dev
  postgres:16
  redis:7

containers:
  shop-web-1      running
  shop-api-1      running
  shop-worker-1   running
  shop-db-1       running
  shop-redis-1    running

networks:
  shop_frontend
  shop_backend

volumes:
  shop_db-data
  shop_redis-data
```

## 6. 常用重要命令详解

### `docker compose config`

```bash
docker compose config
```

作用：查看 Compose 解析后的最终配置。

它会做：

```text
读取 compose.yaml
读取 .env
合并多个 -f 文件
替换环境变量
解析默认值
规范化配置结构
输出最终配置
```

它不会创建 image、container、network、volume。

常用于排查：

```bash
docker compose config
docker compose config --quiet
docker compose -f compose.yaml -f compose.prod.yaml config
```

### `docker compose pull`

```bash
docker compose pull
```

作用：拉取服务声明的镜像。

它看的是 `services.*.image`。

在本例中会拉：

```text
nginx:1.27
ghcr.io/acme/shop-api:dev
postgres:16
redis:7
```

等价理解：

```bash
docker pull nginx:1.27
docker pull ghcr.io/acme/shop-api:dev
docker pull postgres:16
docker pull redis:7
```

它只处理 image。

它不创建 container，不启动服务，不创建 network，不创建 volume。

拉某个服务：

```bash
docker compose pull db
```

就是拉：

```text
postgres:16
```

### `docker compose build`

```bash
docker compose build
```

作用：构建带 `build:` 的服务镜像。

本例中主要构建：

```text
api -> ghcr.io/acme/shop-api:dev
```

它会：

```text
读取 build.context
读取 build.dockerfile
执行 Dockerfile
生成 image
给 image 打 tag
```

常用：

```bash
docker compose build api
docker compose build --no-cache api
docker compose build --pull api
```

其中：

```text
--no-cache  不使用构建缓存
--pull      构建时尝试更新基础镜像
```

它只生成或更新 image，不启动 container。

### `docker compose push`

```bash
docker compose push
```

作用：把服务声明的镜像推送到远程镜像仓库。

它推的是 `services.*.image`。

例如：

```yaml
api:
  build: ./api
  image: ghcr.io/acme/shop-api:dev
```

执行：

```bash
docker compose build api
docker compose push api
```

等价理解：

```bash
docker build -t ghcr.io/acme/shop-api:dev ./api
docker push ghcr.io/acme/shop-api:dev
```

它推的是 image，不是 container，不是 volume，不是 compose 文件。

如果服务没有明确的 `image:`，通常不适合 `push`，因为不知道要推到哪个远程仓库名。

### `docker compose up`

```bash
docker compose up -d
```

作用：创建、更新并启动整个 Compose 项目。

它会：

```text
读取配置
创建缺失的 network
创建缺失的 volume
准备 image
创建 container
连接 network
挂载 volume 或 bind mount
设置环境变量
设置端口映射
启动 container
```

常用：

```bash
docker compose up -d
docker compose up -d --build
docker compose up -d --force-recreate
docker compose up -d --remove-orphans
```

含义：

```text
-d
  后台运行

--build
  启动前先构建带 build: 的服务镜像

--force-recreate
  即使配置没变，也强制删除旧容器并创建新容器

--remove-orphans
  删除以前属于这个项目、但现在 compose.yaml 里已经不存在的服务容器
```

如果容器已经存在：

```text
配置没变，容器已运行
  通常保持运行

配置没变，容器已停止
  启动它

配置变了
  删除旧容器，按新配置创建新容器

镜像变了
  用新镜像重新创建对应容器
```

### `docker compose create`

```bash
docker compose create
```

作用：创建容器但不启动。

它会：

```text
创建缺失 network
创建缺失 volume
准备 image
创建 container
```

但不会：

```text
启动 container
```

执行后容器状态类似：

```text
shop-web-1      created
shop-api-1      created
shop-db-1       created
```

之后可以执行：

```bash
docker compose start
```

日常不如 `up` 常用。

### `docker compose start`

```bash
docker compose start
```

作用：启动已经存在的 stopped 容器。

它类似：

```bash
docker start shop-web-1
docker start shop-api-1
docker start shop-db-1
```

它不会：

```text
重新 build image
重新 pull image
重新创建 container
应用 compose.yaml 的新配置
创建新的 network 或 volume
```

如果修改了 `compose.yaml`，不要只用 `start`，应该用：

```bash
docker compose up -d
```

### `docker compose stop`

```bash
docker compose stop
```

作用：停止容器，但不删除。

它会停止：

```text
shop-web-1
shop-api-1
shop-worker-1
shop-db-1
shop-redis-1
```

停止后：

```text
container 还在，只是 stopped
image 还在
network 还在
volume 还在
```

所以可以继续：

```bash
docker compose start
```

### `docker compose restart`

```bash
docker compose restart api
```

作用：重启已有服务容器。

等价理解：

```bash
docker restart shop-api-1
```

它做的是：

```text
stop api container
start api container
```

它不会：

```text
build 新镜像
pull 新镜像
重建容器
应用 compose.yaml 的新配置
```

如果改了 Dockerfile 或需要应用新配置，应使用：

```bash
docker compose up -d --build api
```

### `docker compose down`

```bash
docker compose down
```

作用：拆掉这个 Compose 项目。

默认会：

```text
停止 containers
删除 containers
删除 Compose 创建的 networks
```

例如删除：

```text
containers:
  shop-web-1
  shop-api-1
  shop-worker-1
  shop-db-1
  shop-redis-1

networks:
  shop_frontend
  shop_backend
```

默认保留：

```text
images:
  nginx:1.27
  ghcr.io/acme/shop-api:dev
  postgres:16
  redis:7

volumes:
  shop_db-data
  shop_redis-data
```

所以数据库数据通常还在。

删除 volume：

```bash
docker compose down -v
```

会额外删除：

```text
shop_db-data
shop_redis-data
```

这会清掉数据库和 Redis 持久化数据。

删除本地构建镜像：

```bash
docker compose down --rmi local
```

可能会删除 Compose 本地构建出来的镜像。

### `docker compose rm`

```bash
docker compose rm
```

作用：删除已经停止的服务容器。

它会：

```text
找到当前项目中 stopped 的 container
删除这些 container
```

它不会删除：

```text
running container
image
network
volume
```

常见组合：

```bash
docker compose stop
docker compose rm
```

但日常更多直接用：

```bash
docker compose down
```

### `docker compose ps`

```bash
docker compose ps
```

作用：查看当前 Compose 项目的容器状态。

它会查当前项目的容器，例如：

```text
shop-web-1
shop-api-1
shop-worker-1
shop-db-1
shop-redis-1
```

显示：

```text
服务名
容器名
状态
端口映射
```

它只看当前 Compose 项目，不是查看全局所有容器。

查看全局所有容器用：

```bash
docker ps -a
```

### `docker compose logs`

```bash
docker compose logs -f api
```

作用：查看服务容器的 stdout/stderr 日志。

等价理解：

```bash
docker logs -f shop-api-1
```

查看所有服务：

```bash
docker compose logs -f
```

查看最近 100 行：

```bash
docker compose logs --tail=100 -f api
```

它不进入容器，不执行命令，只读取容器日志。

### `docker compose exec`

```bash
docker compose exec api sh
```

作用：在已经运行的服务容器里执行命令。

等价理解：

```bash
docker exec -it shop-api-1 sh
```

常见：

```bash
docker compose exec api sh
docker compose exec db psql -U postgres
docker compose exec redis redis-cli
docker compose exec api npm test
```

重点：

```text
exec 不创建新容器
exec 不启动新服务
exec 只是在已有 running container 里额外执行一个进程
```

目标容器必须已经运行。

### `docker compose run`

```bash
docker compose run --rm api npm run migrate
```

作用：基于某个服务的配置，新建一个一次性容器执行命令。

它会：

```text
读取 api 服务配置
使用 api 的 image
加入 api 配置的 network
带上 api 的 environment
带上 api 的 volumes
覆盖默认 command 为 npm run migrate
创建一个临时 container
运行命令
命令结束后，因为 --rm，删除临时 container
```

它不是进入：

```text
shop-api-1
```

而是创建类似：

```text
shop-api-run-xxxx
```

的临时容器。

`exec` 和 `run` 的区别：

```text
exec
  在已有容器 shop-api-1 里执行命令

run
  新建一个临时 api 容器执行命令
```

常用：

```bash
docker compose run --rm api npm test
docker compose run --rm api npm run migrate
docker compose run --rm api node scripts/seed.js
```

注意：`run` 默认通常不会发布 `ports:`，因为它主要用于一次性任务。

如果需要带上服务端口：

```bash
docker compose run --service-ports api
```

### `docker compose cp`

```bash
docker compose cp api:/app/logs/app.log ./app.log
```

作用：在宿主机和服务容器之间复制文件。

从容器复制到宿主机：

```bash
docker compose cp api:/app/logs/app.log ./app.log
```

等价理解：

```bash
docker cp shop-api-1:/app/logs/app.log ./app.log
```

从宿主机复制到容器：

```bash
docker compose cp ./config.json api:/app/config.json
```

它不处理 image、network、volume，只复制文件。

### `docker compose top`

```bash
docker compose top
```

作用：查看项目容器里的进程。

类似：

```bash
docker top shop-api-1
docker top shop-db-1
```

可以看到容器里正在运行的命令，例如：

```text
shop-api-1:
  node server.js

shop-db-1:
  postgres
```

### `docker compose stats`

```bash
docker compose stats
```

作用：查看当前项目容器的资源占用。

包括：

```text
CPU
内存
网络 IO
磁盘 IO
```

类似限定范围的：

```bash
docker stats
```

只看当前 Compose 项目的容器。

### `docker compose images`

```bash
docker compose images
```

作用：显示当前 Compose 项目容器使用的镜像。

例如：

```text
shop-web-1    nginx                     1.27
shop-api-1    ghcr.io/acme/shop-api     dev
shop-db-1     postgres                  16
shop-redis-1  redis                     7
```

它只查看信息，不拉取、不构建、不删除镜像。

### `docker compose port`

```bash
docker compose port web 80
```

作用：查看服务的容器端口映射到宿主机哪个端口。

如果配置是：

```yaml
ports:
  - "8080:80"
```

那么：

```bash
docker compose port web 80
```

可能输出：

```text
0.0.0.0:8080
```

它只是查询端口映射，不修改任何对象。

### `docker compose kill`

```bash
docker compose kill api
```

作用：强制杀掉服务容器里的主进程。

`stop` 是优雅停止：

```text
发送 SIGTERM
等待一段时间
还不退出再强制
```

`kill` 是直接发送信号，默认更粗暴。

结果：

```text
shop-api-1 停止
container 还在
image 还在
network 还在
volume 还在
```

### `docker compose pause` / `unpause`

```bash
docker compose pause api
docker compose unpause api
```

作用：冻结或恢复容器里的进程。

`pause` 不是停止，也不是删除。

它会让容器进程暂停执行，但状态和内存仍然保留。

日常不如 `stop/start` 常用，更多用于特殊调试。

### `docker compose ls`

```bash
docker compose ls
```

作用：列出当前 Docker 上的 Compose 项目。

例如：

```text
NAME    STATUS
shop    running(5)
blog    exited(2)
```

它看的是项目级别，不是单个容器级别。

### `docker compose watch`

```bash
docker compose watch
```

作用：开发环境监听文件变化，并自动同步、重建或重启服务。

通常需要配置：

```yaml
develop:
  watch:
    - action: sync
      path: ./api
      target: /app
```

它会：

```text
监听宿主机文件变化
变化后同步到容器
或者 rebuild
或者 restart
```

它是偏开发体验的命令，不是传统部署必需命令。

## 7. 重要选项

### `-f`

```bash
docker compose -f compose.yaml -f compose.prod.yaml up -d
```

指定并合并多个 Compose 文件。

流程：

```text
先读 compose.yaml
再读 compose.prod.yaml
后者覆盖或补充前者
得到最终配置
再执行命令
```

建议先看最终配置：

```bash
docker compose -f compose.yaml -f compose.prod.yaml config
```

### `-p`

```bash
docker compose -p shop-dev up -d
```

指定项目名。

项目名决定 Compose 管的是哪一组资源。

同一份 `compose.yaml`，不同项目名会创建不同容器、网络、volume。

### `--scale`

```bash
docker compose up -d --scale worker=3
```

把 `worker` 服务扩成 3 个容器：

```text
shop-worker-1
shop-worker-2
shop-worker-3
```

这些容器：

```text
使用同一个 image
加入同一个 network
使用同样的 environment
执行同样的 command
```

注意：有固定宿主机端口映射的服务不能随便扩容。

例如：

```yaml
ports:
  - "3000:3000"
```

如果扩成 3 个容器，它们都会抢宿主机的 3000 端口，导致冲突。

## 8. 按对象总结命令

只处理 image：

```bash
docker compose pull
docker compose build
docker compose push
docker compose images
```

创建或拆除 container、network、volume：

```bash
docker compose up
docker compose create
docker compose down
```

只控制已有 container：

```bash
docker compose start
docker compose stop
docker compose restart
docker compose kill
docker compose pause
docker compose unpause
docker compose rm
```

在容器里执行命令：

```bash
docker compose exec
docker compose run
```

只查看信息：

```bash
docker compose config
docker compose ps
docker compose logs
docker compose top
docker compose stats
docker compose port
docker compose ls
```

## 9. 最常用工作流

本地开发启动：

```bash
docker compose up -d --build
docker compose logs -f api
docker compose exec api sh
```

停止但保留容器：

```bash
docker compose stop
docker compose start
```

删除容器和网络，但保留数据：

```bash
docker compose down
```

重置开发环境数据：

```bash
docker compose down -v
docker compose up -d --build
```

更新远程镜像并重建容器：

```bash
docker compose pull
docker compose up -d
```

构建并推送自己的镜像：

```bash
docker compose build api
docker compose push api
```

运行一次性任务：

```bash
docker compose run --rm api npm run migrate
docker compose run --rm api npm test
```

## 10. 最关键的区别

```text
build
  Dockerfile + 代码目录 -> image
  只生成镜像，不启动容器

pull
  registry -> 本地 image
  拉取服务声明的镜像

push
  本地 image -> registry
  推送服务声明的镜像

up
  image + network + volume + 配置 -> container 并启动
  是 Compose 最核心的创建和启动命令

start
  启动已经存在的 stopped container
  不应用新配置

stop
  停止 container
  不删除 container

restart
  stop + start 已有 container
  不 build，不重建

down
  停止并删除 container 和 network
  默认保留 image 和 volume

down -v
  额外删除 volume
  数据会丢

exec
  在已有 running container 里执行命令

run
  新建一次性 container 执行命令

config
  只看最终配置
  不创建任何 Docker 对象
```

一句话总结：

```text
Compose 的核心价值不是命令名字，而是用 compose.yaml 记住一组容器如何一起工作。

service 是 Compose 里的逻辑名字。
image 是 container 的模板。
container 是真正运行的服务实例。
network 让 container 互相通信。
volume 让 container 删除后数据仍然保留。
project name 把这些对象绑定成同一个项目。
```

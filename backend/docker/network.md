1. **网络驱动 driver**：`bridge`、`host`、`null/none`、`overlay`、`macvlan`。
2. **网络作用域 scope**：`local`、`swarm`。
3. **容器通信方式**：容器到容器、容器到宿主机、宿主机/外部到容器。


## 一、Docker 网络的底层组件

### 1. network namespace

每个普通容器都有自己的网络命名空间。

可以理解成：容器有自己独立的一套网络视角：

```text
网卡
IP
路由表
端口监听
iptables 视角
localhost
```

所以在普通 `bridge` 模式下：

```text
容器里的 localhost = 容器自己
宿主机里的 localhost = 宿主机自己
```

### 2. veth pair

`veth pair` 是一对虚拟网卡，像一根虚拟网线。

一端放进容器里，通常叫：

```text
eth0
```

另一端留在宿主机上，通常长得像：

```text
vethxxxx
```

结构类似：

```text
container eth0 <---- veth pair ----> host vethxxxx
```

### 3. Linux bridge

Linux bridge 可以理解为宿主机上的一个虚拟交换机。

默认 bridge 网络使用：

```text
docker0
```

自定义 bridge 网络通常使用：

```text
br-xxxxxxxxxxxx
```

容器的 `veth` 会挂到这个 bridge 上。

### 4. iptables / nftables

Docker 会通过 `iptables` 或 `nftables` 做两类事情：

```text
容器访问外网：SNAT / MASQUERADE
外部访问容器：DNAT / 端口映射
```

简单说：

```text
出去：容器 IP 伪装成宿主机 IP
进来：宿主机端口转发到容器端口
```

### 5. Docker DNS

自定义 bridge 网络里，Docker 会给容器提供内置 DNS。

容器里常见的 DNS 地址是：

```text
127.0.0.11
```

它负责把服务名、容器名、网络别名解析成容器 IP。

例如：

```text
mysql -> 172.18.0.3
redis -> 172.18.0.4
```

---

## 二、local scope 和 none 网络

### 1. local scope 是什么

`local` 是 Docker 网络的作用域，表示网络只属于当前 Docker 宿主机。

例如默认的：

```text
bridge / host / none
```

它们的 scope 都是：

```text
local
```

这意味着：

```text
这台机器上的容器可以使用这些网络
另一台机器上的 Docker 看不到这个网络
```

如果要跨主机容器通信，通常不是靠 `local` 网络，而是用：

```text
overlay
Kubernetes CNI
直接暴露宿主机端口
```

### 2. none 网络是什么

如果说“本地隔离网络”或者“无网络”，通常对应 Docker 的：

```bash
docker run --network none alpine
```

它的特点是：

```text
容器有自己的 network namespace
但 Docker 不给它接 veth
不接 bridge
不分配普通容器 IP
不配置默认路由
```

容器里一般只有：

```text
lo
127.0.0.1
```

### 3. none 网络怎么通信

容器内部：

```text
只能访问自己容器内的 localhost
```

容器到容器：

```text
不能直接通信
```

容器到外网：

```text
不能直接访问
```

外部到容器：

```text
不能通过普通 Docker 网络访问
```

即使写端口映射也没有正常意义，因为容器没有被接入 Docker 网络。

### 4. none 网络的底层原理

`none` 网络仍然会创建网络命名空间，但不会创建常规的网络连接：

```text
container network namespace
  |
  |-- lo: 127.0.0.1
```

没有：

```text
veth pair
Linux bridge
Docker NAT
Docker DNS
```

适合需要强网络隔离，或者你想手动配置网络命名空间的场景。

---

## 三、host 网络

`host` 网络的核心是：

```text
容器不再使用独立的网络 namespace，而是直接共享宿主机的网络 namespace。
```

启动方式：

```bash
docker run --network host nginx
```

Compose 写法：

```yaml
services:
  api:
    image: my-api
    network_mode: host
```

注意这里是：

```yaml
network_mode: host
```

不是：

```yaml
networks:
  - host
```

### 1. host 网络里的容器怎么互相通信

因为 host 网络容器共享宿主机网络，所以它们不像 bridge 网络那样通过容器 IP 通信。

它们更像宿主机上的普通进程：

```text
宿主机网络 namespace
  |-- 宿主机进程
  |-- api 容器进程
  |-- worker 容器进程
```

假设 `api` 容器监听：

```text
0.0.0.0:8080
```

那么另一个 host 网络容器可以访问：

```text
http://127.0.0.1:8080
http://localhost:8080
```

因为它们看到的是同一套网络空间。

### 2. host 网络和宿主机怎么通信

宿主机访问 host 网络容器：

```text
localhost:容器监听端口
```

容器访问宿主机服务：

```text
localhost:宿主机服务端口
```

这是 host 网络最特殊的地方。

在普通 bridge 网络中：

```text
容器里的 localhost = 容器自己
```

而在 host 网络中：

```text
容器和宿主机共享网络 namespace
```

所以 `localhost` 指向的是同一个网络空间。

### 3. 外部怎么访问 host 网络容器

假设宿主机 IP 是：

```text
192.168.1.10
```

容器监听：

```text
0.0.0.0:8080
```

外部机器访问：

```text
http://192.168.1.10:8080
```

不需要：

```bash
-p 8080:8080
```

因为 host 网络没有 Docker 端口映射这一层。

### 4. host 网络的端口冲突

host 网络里，所有服务抢同一套宿主机端口。

如果宿主机已经占用：

```text
8080
```

另一个 host 网络容器也想监听：

```text
8080
```

就会报：

```text
address already in use
```

bridge 模式下可以靠端口映射错开：

```bash
docker run -p 8081:8080 app
docker run -p 8082:8080 app
```

host 模式不行，因为容器进程是真的在使用宿主机的端口。

### 5. host 网络的底层原理

host 网络没有这些东西：

```text
独立容器网络 namespace
veth pair
Linux bridge
Docker 端口 DNAT
```

它的结构是：

```text
container process
  -> host network namespace
  -> host routes
  -> host network interface
```

所以：

```text
容器访问外网：直接走宿主机路由和网卡
外部访问容器：直接访问宿主机 IP + 容器监听端口
容器之间通信：localhost / 宿主机 IP + 端口
```

### 6. host 网络适合什么

适合：

```text
需要低网络开销
需要监听大量端口
需要使用广播/多播
需要直接感知宿主机网络
Linux 上运行网络基础设施组件
```

不太适合：

```text
普通 Web 项目
多容器业务服务
需要清晰网络隔离的系统
容易端口冲突的本地开发
```

---

## 四、默认 bridge 网络

默认 bridge 是 Docker 单机上最经典的网络模式。

如果启动容器时不指定网络：

```bash
docker run -d --name web nginx
```

容器默认加入：

```text
bridge
```

在 Linux 上，它通常对应宿主机上的：

```text
docker0
```

### 1. 默认 bridge 的结构

通常结构如下：

```text
宿主机
  |
  |-- docker0: 172.17.0.1
        |
        |-- vethA <----> container A eth0: 172.17.0.2
        |
        |-- vethB <----> container B eth0: 172.17.0.3
```

`docker0` 就像一个虚拟交换机。

容器通过 `veth pair` 接到 `docker0` 上。

### 2. 默认 bridge 里容器怎么互相通信

同一个默认 bridge 里的容器，可以通过 IP 通信。

例如：

```text
c1: 172.17.0.2
c2: 172.17.0.3
```

在 `c1` 里访问：

```text
172.17.0.3:端口
```

通信路径是：

```text
c1 eth0
  -> c1 的 veth pair
  -> docker0
  -> c2 的 veth pair
  -> c2 eth0
```

底层是二层转发。

如果 `c1` 不知道 `c2` 的 MAC 地址，会先发 ARP：

```text
谁是 172.17.0.3？
```

`c2` 回答后，网桥根据 MAC 地址表转发数据帧。

### 3. 默认 bridge 的名字解析

默认 bridge 最大的问题是：

```text
容器名解析不好用
```

也就是说，不应该依赖：

```text
http://mysql:3306
```

默认 bridge 更偏向：

```text
http://172.17.0.3:3306
```

这就是为什么实际项目更推荐 user-defined bridge。

### 4. 默认 bridge 里容器访问外网

容器访问外网：

```text
container
  -> eth0
  -> veth
  -> docker0
  -> 宿主机路由
  -> 宿主机物理网卡
  -> 外网
```

因为容器 IP 一般是私有地址，例如：

```text
172.17.0.2
```

外网不认识这个地址。

所以 Docker 会做 NAT：

```text
172.17.0.2 -> 宿主机 IP
```

这通常由 `iptables` / `nftables` 的 `MASQUERADE` 规则实现。

### 5. 外部怎么访问默认 bridge 容器

如果只启动：

```bash
docker run -d --name web nginx
```

容器内部可能监听：

```text
80
```

但外部不能直接访问这个容器服务。

要暴露出来，需要端口映射：

```bash
docker run -d --name web -p 8080:80 nginx
```

含义：

```text
宿主机 8080 -> 容器 80
```

访问路径：

```text
外部 / 宿主机
  -> 宿主机 IP:8080
  -> Docker DNAT
  -> 172.17.0.2:80
```

如果只想本机访问，可以绑定到本机回环地址：

```bash
docker run -d -p 127.0.0.1:8080:80 nginx
```

这样外部机器通常不能访问：

```text
192.168.1.10:8080
```

只能宿主机自己访问：

```text
127.0.0.1:8080
```

### 6. 默认 bridge 的底层原理

默认 bridge 依赖：

```text
network namespace
veth pair
docker0 Linux bridge
Docker IPAM
iptables/nftables NAT
```

它的核心路径是：

```text
容器到容器：
container eth0 -> veth -> docker0 -> veth -> target eth0

容器到外网：
container eth0 -> veth -> docker0 -> SNAT -> host NIC -> internet

外部到容器：
host port -> DNAT -> docker0 -> veth -> container port
```

---

## 五、user-defined bridge 网络

user-defined bridge 就是用户自己创建的 bridge 网络。

创建：

```bash
docker network create app-net
```

启动容器加入这个网络：

```bash
docker run -d \
  --name mysql \
  --network app-net \
  -e MYSQL_ROOT_PASSWORD=123456 \
  mysql:8
```

```bash
docker run -d \
  --name api \
  --network app-net \
  -p 8080:8080 \
  my-api
```

### 1. user-defined bridge 的结构

它和默认 bridge 的底层结构很像，只是不用 `docker0`，而是创建一个独立网桥：

```text
宿主机
  |
  |-- br-xxxxxxxxxxxx: 172.18.0.1
        |
        |-- vethA <----> api eth0:   172.18.0.2
        |
        |-- vethB <----> mysql eth0: 172.18.0.3
```

每个 user-defined bridge 通常对应一个独立的：

```text
br-xxxx
```

### 2. user-defined bridge 里容器怎么互相通信

同一个 user-defined bridge 里的容器可以直接用名字通信。

例如 `api` 访问 `mysql`：

```text
mysql:3306
```

流程是：

```text
api 查询 DNS：mysql 是谁？
Docker DNS 返回：172.18.0.3
api 访问：172.18.0.3:3306
数据经过：api eth0 -> veth -> br-xxxx -> veth -> mysql eth0
```

这里的名字解析由 Docker 内置 DNS 完成。

容器里的 DNS 通常是：

```text
127.0.0.11
```

### 3. user-defined bridge 的别名

容器可以有网络别名：

```bash
docker run -d \
  --name mysql-prod \
  --network app-net \
  --network-alias db \
  mysql:8
```

同网络内其他容器可以访问：

```text
mysql-prod:3306
db:3306
```

这适合统一配置：

```text
DB_HOST=db
```

### 4. user-defined bridge 的外部通信

容器访问外网：

```text
container
  -> eth0
  -> veth
  -> br-xxxx
  -> 宿主机路由
  -> NAT
  -> 外网
```

外部访问容器仍然要靠端口映射：

```bash
docker run -d \
  --name api \
  --network app-net \
  -p 8080:8080 \
  my-api
```

访问：

```text
http://宿主机IP:8080
http://localhost:8080
```

内部服务一般不需要暴露端口。

例如：

```text
外部
  |
宿主机 8080
  |
api 容器
  |
mysql:3306
redis:6379
```

这里通常只暴露 `api`：

```yaml
ports:
  - "8080:8080"
```

而 `mysql`、`redis` 不暴露给宿主机，只在 Docker 网络内部使用。

### 5. 不同 user-defined bridge 之间怎么通信

默认情况下，不同 Docker 网络是隔离的。

例如：

```text
app-net
  |-- api
  |-- mysql

monitor-net
  |-- prometheus
```

`api` 不能直接通过容器名访问：

```text
prometheus
```

因为它们不在同一个网络。

如果确实要通信，有几种方式：

第一，让某个容器加入两个网络：

```bash
docker network connect monitor-net api
```

这样 `api` 同时在：

```text
app-net
monitor-net
```

它就可以访问两个网络里的服务。

第二，通过宿主机端口暴露：

```text
prometheus 容器 -> -p 9090:9090
api 容器 -> 访问宿主机IP:9090
```

第三，重新设计网络，把需要互通的服务放到同一个网络里。

### 6. user-defined bridge 指定 IP 网段

创建网络时可以指定网段：

```bash
docker network create \
  --driver bridge \
  --subnet 172.30.10.0/24 \
  --gateway 172.30.10.1 \
  app-net
```

含义：

```text
网络地址：172.30.10.0/24
网关地址：172.30.10.1
容器地址：172.30.10.2 ~ 172.30.10.254
广播地址：172.30.10.255
```

选择网段时遵守：

```text
私有地址
合法 CIDR
不和宿主机、VPN、公司内网、Kubernetes、其他 Docker 网络冲突
```

私有地址段只有：

```text
10.0.0.0/8
172.16.0.0/12
192.168.0.0/16
```

注意：

```text
172.16.0.0 ~ 172.31.255.255 是私有地址
不是所有 172.x.x.x 都是私有地址
```

### 7. Compose 里的 user-defined bridge

Docker Compose 默认会给一个项目创建自定义 bridge 网络。

简单示例：

```yaml
services:
  api:
    image: my-api
    ports:
      - "8080:8080"
    environment:
      DB_HOST: mysql
      DB_PORT: 3306

  mysql:
    image: mysql:8
    environment:
      MYSQL_ROOT_PASSWORD: 123456
```

这里 `api` 可以直接访问：

```text
mysql:3306
```

显式声明网络：

```yaml
services:
  api:
    image: my-api
    ports:
      - "8080:8080"
    networks:
      - app-net

  mysql:
    image: mysql:8
    networks:
      - app-net
    environment:
      MYSQL_ROOT_PASSWORD: 123456

networks:
  app-net:
    driver: bridge
```

指定网段：

```yaml
networks:
  app-net:
    driver: bridge
    ipam:
      config:
        - subnet: 172.30.10.0/24
          gateway: 172.30.10.1
```

### 8. user-defined bridge 的底层原理

user-defined bridge 依赖：

```text
network namespace
veth pair
独立 Linux bridge：br-xxxx
Docker IPAM
Docker embedded DNS
iptables/nftables NAT
Docker 网络隔离规则
```

它和默认 bridge 的核心转发路径一样：

```text
container eth0 -> veth -> Linux bridge -> veth -> target container eth0
```

但它比默认 bridge 多了更实用的能力：

```text
容器名解析
网络别名
更清晰的网络隔离
更灵活的 IPAM 配置
可动态 connect / disconnect
```

---

## 六、几种网络的通信对比

| 网络 | 容器之间怎么通信 | 外部怎么访问容器 | 容器怎么访问外网 | 底层核心 |
| --- | --- | --- | --- | --- |
| `none` / `null` | 不能直接通信，只能容器内部访问自己的 `localhost` | 通常不能访问 | 通常不能访问 | 独立 network namespace + loopback，无 veth/bridge |
| `host` | 共享宿主机网络，用 `localhost:端口` 或宿主机 IP 通信 | 直接访问 `宿主机IP:容器监听端口`，不需要 `-p` | 直接走宿主机路由和网卡 | 共享 host network namespace，无 veth/bridge |
| 默认 `bridge` | 同一 bridge 内用容器 IP 通信，容器名解析不推荐依赖 | 通过 `-p 宿主机端口:容器端口` | 通过 docker0 出去，Docker 做 NAT | network namespace + veth + docker0 + NAT |
| user-defined `bridge` | 同一网络内用容器名/别名通信，例如 `mysql:3306` | 通过 `-p` 暴露入口服务 | 通过 br-xxxx 出去，Docker 做 NAT | network namespace + veth + br-xxxx + DNS + NAT |

---

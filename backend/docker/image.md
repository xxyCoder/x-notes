## docker pull image[:tag]

tag 默认为 latest

### 并发下载

- 并发拉取： 镜像是由多层组成的，只要你的网络带宽允许，Docker 引擎会同时开启多个线程，并行下载不同的层。可以在终端里会看到好几行进度条同时在推进。

- 智能复用（极度节省空间和时间）： 假设昨天已经拉取过一个基于 alpine 系统的 Nginx 镜像。今天又要拉取一个同样基于 alpine 系统的 Redis 镜像。Docker 会在下载前比对哈希值，发现底层的 alpine 系统层你本地已经有了。此时它会直接跳过这部分（终端显示为 Already exists），仅仅只下载 Redis 特有的那几兆增量文件。

## docker rm [容器ID 或 容器名]

一般情况下，你不能删除一个正在运行（Up）的容器。Docker 为了安全会直接报错阻止你（需要先 docker stop 停止容器）

## docker rmi [镜像ID 或 镜像名:标签]

只要本地还有任何一个容器（哪怕是已经停止运行的废弃容器）是基于这个镜像创建的，就无法删除这个镜像

删除镜像优先做的其实是“撕标签”的动作。只有当指向某个 Image ID 的所有标签都被撕光时，Docker 才会真正触发 Deleted，把底层几十上百兆的只读层数据从硬盘上彻底抹除

## docker commit [OPTIONS] CONTAINER [REPOSITORY[:TAG]]

可以把它想象成给容器拍了一张“快照”。

## docker pull [仓库地址]/[命名空间或用户名]/[镜像名]:[版本号(Tag)]

将本地的镜像上传到 Docker Registry 中，不传递仓库地址默认推送到官方的 Docker Hub

- 只传增量： 当执行 push 时，Docker 会对比云端仓库和本地镜像的层级哈希值。如果只是修改了代码（最顶层的一层），而底层的 Ubuntu 系统层、Nginx 依赖层在仓库里已经存在了，Docker 就只会上传修改的那几兆代码层

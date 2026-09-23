# Git 引用

## 1. 引用与存储

Git 用对象 ID 找到 commit、tree、blob 等对象。**引用（reference，简称 ref）为对象 ID 提供一个名字，可以理解为有名字的指针。**

例如，分支 main 指向提交 C：

```text
main → 提交 C → 提交 B → 提交 A
         │      parent 关系
         ↓
       根 tree → 子 tree / blob → 文件内容
```

main 保存的是 C 的对象 ID。执行 `git log main` 时，Git 先找到 C，再沿 commit 中的 parent 找到 B、A；执行 `git show main` 时，也会先把 main 解析为 C。

**对象的内容决定对象 ID；引用的名字由人或 Git 指定。**main 可以从指向 C 改为指向新提交 D，C 本身及其 ID 保持不变。这种可移动的指针构成了分支。

### 引用放在哪里

普通仓库使用文件式引用存储时，常见布局如下：

```text
.git/
├── HEAD
└── refs/
    ├── heads/
    │   ├── main             本地 main 分支
    │   └── dev              本地 dev 分支
    ├── tags/
    │   └── v1.0             v1.0 标签
    └── remotes/
        └── origin/
            └── main         本地记录的远程 main 分支位置
```

| 平时使用的名字 | 完整引用名 | 保存的目标 |
|---|---|---|
| `main` | `refs/heads/main` | 本地 main 最新提交的 ID |
| `dev` | `refs/heads/dev` | 本地 dev 最新提交的 ID |
| `v1.0` | `refs/tags/v1.0` | 标签所标记的对象 ID，或 tag 对象 ID |
| `origin/main` | `refs/remotes/origin/main` | 最近一次相关同步获知的远程 main 提交 ID |
| `HEAD` | `HEAD` | 通常保存当前分支的引用名；分离时保存提交 ID |

直接保存对象 ID 的称为**直接引用**；保存另一个引用名的称为**符号引用**。HEAD 是最常见的符号引用：

```text
HEAD 保存：ref: refs/heads/main
main 保存：提交 C 的对象 ID

HEAD → main → C
```

引用也可能合并存储在 `.git/packed-refs` 等存储结构中，上表中的完整名称仍用于定位引用。日常通过 Git 命令查询，不依赖具体文件是否存在：

```bash
# 列出引用及其对象 ID
git show-ref

# 查看 main 对应的对象 ID
git rev-parse refs/heads/main

# 查看 HEAD 指向的分支引用名，例如 refs/heads/main
git symbolic-ref HEAD
```

参考：[Pro Git：Git 引用](https://git-scm.com/book/zh/v2/Git-%E5%86%85%E9%83%A8%E5%8E%9F%E7%90%86-Git-%E5%BC%95%E7%94%A8)、[仓库布局](https://git-scm.com/docs/gitrepository-layout)。

## 2. 分支与 HEAD：创建和移动指针

本节使用同一个初始状态：当前在 main 分支，main 指向 C，dev 指向 B，C 的父提交是 B。

```text
HEAD → main → C → B → A
                 ↑
                dev
```

**分支记录最新提交的位置，HEAD 记录当前正在使用哪个分支。**在 main 上正常提交一次后：

```text
HEAD → main → D → C → B → A
                     ↑
                    dev
```

Git 创建 D，将 D 的 parent 设为 C，再把 main 移到 D。HEAD 仍指向 main，dev 也仍指向 B。各分支是独立的引用。

### git update-ref：让引用指向一个对象

基本语法：

```text
git update-ref <引用名> <新对象ID> [<预期旧对象ID>]
```

新对象 ID 也可以用 `main`、`dev`、`HEAD` 等能解析到对象的名字表示。尖括号表示语法参数，下面是具体例子。

从本节初始状态执行：

```bash
git update-ref refs/heads/dev main
```

Git 读取此刻 main 保存的 C 的 ID，再把这个 ID 写入 dev：

```text
执行前：main → C，dev → B
执行后：main → C，dev → C
```

这时 main、dev 保存相同 ID，但仍是独立引用。以后 main 前进，dev 会留在 C。引用原先不存在时，`update-ref` 会创建它。

可选的旧 ID 用于校验：“只有引用仍在预期位置，才执行更新。”例如，下面先记住 dev 的当前 ID，再以它作为更新条件：

```bash
old_id=$(git rev-parse refs/heads/dev)
git update-ref refs/heads/dev main "$old_id"
```

如果两条命令之间，其他操作已经把 dev 移到不同提交，第二条会失败，保留别人更新后的值。创建时用空旧值 `''` 可以要求名字尚不存在，例如 `git update-ref refs/heads/demo main ''`。

### 操作 HEAD 时，区分两根箭头

```text
HEAD ──①──→ main ──②──→ C

① 来自 HEAD 保存的分支名
② 来自 main 保存的提交 ID
```

以下三个例子都独立从本节初始状态开始：`HEAD → main → C`，`dev → B`。

**`git update-ref HEAD dev`：沿着 HEAD，修改 main 的提交 ID。**

Git 先把 dev 解析为 B，再查看 HEAD。HEAD 指向 main，于是把 main 的目标改为 B：

```text
执行前：HEAD → main → C；dev → B
执行后：HEAD → main → B；dev → B
```

改的是箭头 ②。HEAD 保存的 `ref: refs/heads/main` 保持不变。这种“沿符号引用找到目标再修改”的行为叫解引用（dereference）。

**`git symbolic-ref HEAD refs/heads/dev`：让 HEAD 改为指向 dev。**

Git 把 HEAD 保存的值改为 `ref: refs/heads/dev`：

```text
执行前：HEAD → main → C；       dev → B
执行后：       main → C；HEAD → dev → B
```

改的是箭头 ①。两个分支所指向的提交都保持不变。

**`git update-ref --no-deref HEAD dev`：让 HEAD 直接指向 B。**

`--no-deref` 表示直接修改 HEAD 自身。Git 把 HEAD 原来保存的分支名替换为 B 的对象 ID：

```text
执行前：HEAD → main → C；dev → B
执行后：       main → C；dev → B；HEAD → B
```

HEAD 直接指向提交的状态叫**分离 HEAD**。此时创建新提交会推进 HEAD，不会推进 main 或 dev；普通 `git update-ref HEAD ...` 也直接更新 HEAD 中的 ID。`git symbolic-ref HEAD` 此时返回非零状态，因为 HEAD 已不再指向分支名。

`update-ref` 和 `symbolic-ref` 只处理引用，工作目录和暂存区不会随之同步。日常切换分支使用 `git switch dev`，由它处理 HEAD 与文件状态。

参考：[git-update-ref](https://git-scm.com/docs/git-update-ref)、[git-symbolic-ref](https://git-scm.com/docs/git-symbolic-ref)。

## 3. 标签：为一个版本保留名字

标签通常用于标记一个确定的版本，例如 v1.0。假设它标记 C，之后 main 前进到 D：

```text
main → D → C → B → A
           ↑
          v1.0
```

分支随开发推进，标签仍标记 C。标签的这种稳定性是日常使用约定；技术上仍可显式强制更新或删除标签引用。

| 类型 | 对象关系 | 额外保存的信息 |
|---|---|---|
| 轻量标签 | 标签引用 → commit | 只有名字与目标的对应关系 |
| 附注标签 | 标签引用 → tag 对象 → commit | tag 对象记录标签创建者、时间、说明等 |

在已有提交的仓库中创建标签，默认配置下：

```bash
# 轻量标签：直接标记当前提交
git tag v1.0 HEAD

# 附注标签：创建 tag 对象，再用标签引用指向它
git tag -a v1.1 HEAD -m '发布 v1.1'
```

附注标签中的 **tag 对象**也保存在对象库中，有自己的哈希 ID；`refs/tags/v1.1` 保存的是这个 tag ID。读取 tag 对象内部的目标字段，才得到被标记的 commit ID。

```bash
# 输出 commit：轻量标签直接指向提交
git cat-file -t v1.0

# 输出 tag，并查看这个 tag 对象的内容
git cat-file -t v1.1
git cat-file -p v1.1

# 分别取得 tag 对象 ID，以及它最终指向的 commit ID
git rev-parse v1.1
git rev-parse 'v1.1^{commit}'
```

`^{commit}` 表示沿标签找到提交，并要求结果确实是 commit。标签也可以标记 blob、tree 等其他对象；上面讨论的是最常见的提交标签。

参考：[git-tag](https://git-scm.com/docs/git-tag)。

## 4. 远程跟踪引用：本地记录的远程分支位置

远程仓库通常命名为 origin。远程服务器上的 main、本地 main，以及本地的 origin/main，是三个不同位置的引用：

| 引用 | 所在仓库 | 作用 |
|---|---|---|
| `refs/heads/main` | 远程仓库 | 服务器上的 main 分支 |
| `refs/remotes/origin/main` | 本地仓库 | 本地最近同步获知的远程 main 位置，简写为 `origin/main` |
| `refs/heads/main` | 本地仓库 | 本地工作的 main 分支 |

例如，最初三者都指向 C。其他人把远程 main 推进到 D，但本地还没有 fetch：

```text
远程：main → D
本地：origin/main → C，main → C
```

在常见远程配置下，执行 `git fetch origin` 后：

```text
远程：main → D
本地：origin/main → D，main → C
```

fetch 下载所需对象并更新远程跟踪引用。本地 main 仍留在 C，后续通过合并、变基等操作整合远程变化。本地 main 上产生新提交时，也不会自动移动 origin/main。

因此，origin/main 表示本地保存的同步结果。查询它不需要连接服务器；查询服务器当前状态则需要联网：

```bash
# 获取 origin 的更新
git fetch origin

# 查看本地记录的远程 main ID
git rev-parse refs/remotes/origin/main

# 连接 origin，查询服务器上的 main ID
git ls-remote origin refs/heads/main
```

fetch 配置决定“远程哪个分支，更新到本地哪个引用”。通常远程 `refs/heads/main` 对应本地 `refs/remotes/origin/main`。成功 push 后，Git 也可能根据匹配的配置更新本地跟踪引用。

参考：[git-fetch](https://git-scm.com/docs/git-fetch)。

## 5. 删除引用、保留对象与恢复

### 删除的是哪一个名字

删除引用会解除“名字 → 对象 ID”的关联。假设 main 和 dev 同时指向 C，删除 dev 后：

```text
删除前：main → C ← dev
删除后：main → C
```

C 仍存在，其 parent 指向的历史也仍然能从 main 找到。

底层删除语法为 `git update-ref -d <引用名> [<预期旧对象ID>]`，例如 `git update-ref -d refs/heads/dev`。提供旧 ID 时会先验证当前目标，匹配才删除；它不执行日常分支删除命令的合并检查。

常用删除命令及其作用范围：

| 目标 | 命令 | 说明 |
|---|---|---|
| 本地 dev 分支 | `git branch -d dev` | 检查合并情况后删除；`-D` 跳过合并检查，仍不能删除已检出的分支 |
| 本地 v1.0 标签 | `git tag -d v1.0` | 删除本地标签引用 |
| 本地 origin/dev 跟踪引用 | `git branch -dr origin/dev` | 删除本地记录，服务器上的 dev 保留 |
| 远程 dev 分支 | `git push origin --delete refs/heads/dev` | 请求服务器删除 dev |
| 远程 v1.0 标签 | `git push origin :refs/tags/v1.0` | 请求服务器删除标签 |

本地与远程引用各自维护。只删本地 origin/dev，远程 dev 仍存在时，下次相应 fetch 可以重新创建这条记录。远程分支已经删除时，常见配置下使用 `git fetch --prune origin` 清理失效的本地跟踪引用；prune 的具体范围取决于引用映射。

### 对象什么时候会被回收

**可达**表示能从一个入口沿对象关系找到目标。例如：

```text
main → C → B → A
```

从 main 能沿 parent 找到 C、B、A，三个提交都是可达历史。它们不需要各自有一个分支直接指向。

再假设 dev 上有独立的新提交 E：

```text
main → C → B → A
           ↑
dev  → E ──┘
```

删除 dev 后，main 能找到 B、A，但无法沿 parent 反向走到 E。若没有其他当前引用指向 E 或其后续提交，E 就无法从当前引用到达。

Git 还用 **reflog（引用变动日志）**记录本地引用过去指向哪里。例如分支从 E 移回 B 后，日志可能仍保存旧位置 E。有效的 reflog 记录也能让垃圾回收保留相关对象。删除分支时，该分支自己的 reflog 会一并删除；HEAD 或其他引用的 reflog 中仍可能留有相关记录。

对象最终被清理，需要没有其他保留入口，并且满足清理的年龄条件，还要实际运行垃圾回收。常见默认值如下：

| 配置 | 默认值 | 含义 |
|---|---|---|
| `gc.reflogExpire` | 90 天 | reflog 记录的一般过期阈值 |
| `gc.reflogExpireUnreachable` | 30 天 | 从相关引用当前提交无法到达的旧提交，其 reflog 记录采用的过期阈值 |
| `gc.pruneExpire` | 两周前 | 清理不可达对象时采用的对象年龄截止时间 |

前两项计算日志记录的年龄，第三项关注对象修改时间等年龄信息。它们分别生效，不能相加作为恢复期限，也不是从删除引用那天统一开始计时。实际保留时长还取决于配置、其他保留入口和垃圾回收何时运行。

### 对象还在时恢复引用

先查本地保留的引用变动日志：

```bash
git reflog --all
```

也可扫描对象库，查找忽略 reflog 后不可达的对象：

```bash
git fsck --no-reflogs --unreachable
```

这条检查命令不会删除对象或 reflog。找到需要保留的 commit ID 后，检查其内容，再创建分支指向它。下面的 `<提交ID>` 替换为找到的实际 ID：

```text
git show <提交ID>
git branch recovered <提交ID>
```

新分支让该提交及其祖先重新成为可达历史。恢复的前提是对象仍在本地；已经被清理的对象，需要从其他仍保存它的仓库或备份中取得。

参考：[git-branch](https://git-scm.com/docs/git-branch)、[git-push](https://git-scm.com/docs/git-push)、[git-reflog](https://git-scm.com/docs/git-reflog)、[git-gc](https://git-scm.com/docs/git-gc)、[git-fsck](https://git-scm.com/docs/git-fsck)。

# Git 对象：从内容寻址到提交历史

## 1. 为什么叫“内容寻址”

“寻址”就是用一个标识找到数据。内容寻址的关键是：**这个标识由内容计算出来。**

普通键值存储可以自己指定 key：

```text
"my-file" → "hello"
```

同一个 key 可以改为对应 `world`。内容寻址则根据 value 生成 key：

```text
内容 hello → 计算对象哈希 → ID₁ → 保存内容 hello
内容 world → 计算对象哈希 → ID₂ → 保存内容 world
```

所以，“把 value 计算成 key，然后通过 key 保存、读取 value”，就是这里的内容寻址。这里的“地址”指对象 ID，不是内存地址，也不是磁盘扇区位置。

同一仓库中，相同类型、相同内容的对象具有相同 ID，可以复用；修改内容会得到新对象，而不是在原 ID 下覆盖旧内容。

## 2. Git 怎么计算对象 ID

### 2.1 默认使用 SHA-1

没有配置或环境变量覆盖默认选择时，新建仓库默认使用 SHA-1，显示为 40 个十六进制字符。Git 也支持创建 SHA-256 仓库，其对象 ID 显示为 64 个十六进制字符。

查看当前仓库实际使用的对象格式：

```bash
git rev-parse --show-object-format
```

创建时可以通过 `git init --object-format=sha256` 选择 SHA-256。已有仓库不能仅通过修改配置完成算法转换，因为 tree、commit 内部引用的对象 ID 也需要一起转换。两种格式的直接互操作仍有限制。

### 2.2 不是只计算文件内容

所有对象都按照下面的结构计算 ID：

```text
对象头部 = 对象类型 + 空格 + 内容字节数 + \0
对象 ID = SHA-1(对象头部 + 内容)
```

`\0` 表示一个值为 0 的字节；长度是内容的**字节数**，不是字符个数，也不包含头部长度。

例如 `hello` 没有末尾换行，共 5 个字节：

```text
内容：hello
头部：blob 5\0
参与哈希的数据：blob 5\0hello
结果：b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0
```

换行也是内容，因此 `hello` 与 `hello\n` 的 ID 不同。blob 的哈希不包含文件名、路径。

松散对象会将“头部 + 内容”用 zlib 压缩后保存，文件路径由 ID 拆分而来：

```text
.git/objects/b6/fc4c620b67d95f953a5c1c1230aaab5db5a1b0
             ↑  ↑
          前 2 位 剩余 38 位
```

哈希计算发生在压缩前。后续对象也可能存入 pack 文件；对象 ID 和逻辑内容不因此改变。

## 3. blob：保存文件内容这个 value

```text
key：blob 的哈希 ID
value：blob 保存的文件内容
```

blob 不记录文件名、目录、作者、提交时间，也不记录“自己属于哪个版本”。例如两个文件存入 Git 的内容都是 `hello`，就可以指向同一个 blob。

blob 在逻辑上表示完整内容，不是修改指令。pack 中可以采用差量压缩来节省空间，这是物理存储方式，不改变 blob 的含义。

### 3.1 git hash-object：计算 ID，可选择写入对象库

假设 `hello.txt` 的内容已经是没有换行的 `hello`：

```bash
# 只计算 ID，不写入对象库
git hash-object hello.txt

# 计算 ID，并把对象写入对象库
git hash-object -w hello.txt

# 从标准输入读取内容，再计算并保存对象
printf 'hello' | git hash-object -w --stdin
```

以上命令会输出同一个 blob ID：

```text
b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0
```

| 参数 | 含义 |
|---|---|
| `hello.txt` | 从这个文件读取内容 |
| `--stdin` | 从标准输入读取内容；示例中是管道左侧的输出 |
| `-w` | write：实际写入对象库 |

`hash-object` 默认对象类型是 blob；严格来说，`-w` 只负责“写入”，不是“选择 blob 类型”。同一个对象已经存在时会复用。

### 3.2 git cat-file：通过 ID 查看已保存的对象

在上面的 `-w` 写入完成后：

```bash
# 查看内容：输出 hello
git cat-file -p b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0

# 查看对象类型：输出 blob
git cat-file -t b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0

# 查看对象内容的字节数：输出 5
git cat-file -s b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0
```

`cat-file` 读取对象库里的对象，不读取工作目录中的 `hello.txt`。`-p` 根据类型展示内容，因此也能用于查看 tree 和 commit；`-s` 不是压缩后对象文件的磁盘大小。

## 4. 为什么 -w 不等于 git add

**对象库和暂存区是两回事。**

| 位置 | 主要作用 |
|---|---|
| 工作目录 | 放置可以直接编辑的文件 |
| 对象库，普通仓库通常为 `.git/objects` | 保存 blob、tree、commit 等对象 |
| 暂存区，普通仓库通常为 `.git/index` | 记录准备进入下一次提交的路径、模式、blob ID 等信息 |

```text
git hash-object -w hello.txt
    └── 保存 blob

git add hello.txt
    ├── 保存或复用 blob
    └── 更新暂存区：hello.txt → 这个 blob 的 ID
```

只执行 `hash-object -w`，Git 对象库虽然有内容，但暂存区还没有记录要把它以 `hello.txt` 的路径放进下一次提交。

## 5. tree：把名称和对象关联起来

### 5.1 可以理解为一组 key-value

tree 表示一个目录，可以把其条目理解成：

```text
key：当前目录下的文件名或子目录名
value：对应 blob 或子 tree 的 ID
```

每个条目还带有模式，例如 `100644` 表示普通文件、`100755` 表示可执行文件，目录显示为 `040000`。这是一种理解模型，tree 的实际存储格式不是 JSON。

例如 `src/main.js` 并不是在根 tree 里用完整路径记录，而是分两层：

```text
根 tree
├── hello.txt → blob A
└── src       → 子 tree
                └── main.js → blob B
```

上面讲的是普通文件和目录。子模块有特殊的 gitlink 条目，模式为 `160000`，记录子模块的 commit ID。

**tree 本身也有自己的 ID**。不要混淆两层关系：

```text
对象库这一层：tree ID → 整个 tree 对象
tree 内容这一层：名称 → 对象 ID，以及模式
```

因此，只改文件名会改变所在 tree，而 blob 可以不变；修改文件内容会改变 blob ID，引用它的 tree 及上层 tree 也随之改变。无关子目录的 tree 可以复用。

### 5.2 git write-tree 到底做什么

**读取当前暂存区，把它表示的目录结构保存成 tree 对象，并输出根 tree 的 ID。**

```text
暂存区
hello.txt   → blob A
src/main.js → blob B
    ↓ git write-tree
生成或复用 src 子 tree
生成或复用根 tree
    ↓
输出根 tree ID
```

它不需要另加 `-w`，也不会清空暂存区或创建 commit。暂存区存在未解决的合并冲突时，不能正常写出 tree。

它读取的是**暂存状态**，不是工作目录当前内容：

```text
hello.txt 写入 hello
    ↓ git add hello.txt
暂存区指向 hello 的 blob
    ↓ 工作目录把 hello.txt 改成 world，但不再次 add
    ↓ git write-tree
得到的 tree 仍然指向 hello 的 blob
```

也可以用底层命令 `git update-index --add --cacheinfo` 将已有 blob 与路径关联后写入暂存区，再执行 `write-tree`。日常使用 `git add` 更直接。

## 6. commit：给快照加上提交信息和历史关系

一个普通 commit 的内容结构如下，中文 ID 为示意：

```text
tree 根树ID
parent 父提交ID
author 作者姓名 <邮箱> Unix时间戳 时区偏移
committer 提交者姓名 <邮箱> Unix时间戳 时区偏移

提交说明
```

`tree` 确定快照，`parent` 连接历史。首次提交没有 parent，普通提交有一个，合并提交可以有多个。author 表示原始作者，committer 表示创建此次提交对象的人；例如 cherry-pick 时，两者可能不同。

```text
commit B ──parent──→ commit A
   │                   │
   tree                tree
   ↓                   ↓
根 tree B           根 tree A
   │                   │
hello.txt           hello.txt
   ↓                   ↓
blob：world         blob：hello
```

commit 的 ID 也由“对象头部 + 内容”计算，所以即使 tree 相同，提交说明、父提交、作者或时间等变化也可能产生不同 commit ID。commit 通过 tree 引用完整快照；常见的 diff 是通过比较快照计算出来的。

`git commit-tree` 根据已有 tree 创建 commit，输出 commit ID；`-p` 指定父提交，`-m` 指定提交说明。它**不会自动移动分支引用**。

普通 `git commit -m '说明'` 的核心效果可以这样理解：

```text
当前暂存区 → 保存 tree → 创建 commit → 更新当前分支指向
```

这是概念上的流程，不表示 Git 必须逐个调用这些命令行程序。分离 HEAD 状态下更新的是 HEAD，而不是某个分支。
## 1. Slice

### 1.1 slice 是什么

slice 不是数组本身，而是一个指向底层数组的“窗口”。

可以把 slice 的底层结构理解成：

```go
type slice struct {
    array unsafe.Pointer // 指向底层数组
    len   int            // 当前可见元素数量
    cap   int            // 从 array 开始到底层数组末尾的容量
}
```

例如：

```go
a := []int{1, 2, 3, 4, 5}
b := a[1:3]
```

此时：

```text
a 底层数组: [1, 2, 3, 4, 5]
             ^
             a.array

b 看到的是:    [2, 3]
                ^
                b.array
```

所以 `b` 不是复制出来的新数组，它和 `a` 共享同一个底层数组。

### 1.2 len 和 cap

```go
s := make([]int, 2, 5)
```

表示：

```text
len(s) = 2
cap(s) = 5
```

`len` 是当前可以直接访问的元素数量。

`cap` 是从 slice 起点到底层数组末尾还能容纳多少元素。

```go
s := []int{1, 2, 3, 4, 5}
t := s[1:3]

fmt.Println(len(t)) // 2
fmt.Println(cap(t)) // 4
```

因为 `t` 从底层数组下标 1 开始，到数组末尾还有 4 个位置。

### 1.3 常用操作

创建：

```go
var s []int
s1 := []int{1, 2, 3}
s2 := make([]int, 0, 10)
s3 := make([]int, 5)
```

追加：

```go
s = append(s, 1)
s = append(s, 2, 3, 4)
s = append(s, other...)
```

截取：

```go
s[a:b]   // 从 a 到 b，不包括 b
s[:b]    // 从 0 到 b
s[a:]    // 从 a 到 len(s)
s[a:b:c] // len = b-a，cap = c-a
```

复制：

```go
dst := make([]int, len(src))
copy(dst, src)
```

### 1.4 append 与扩容

如果 `append` 后的新长度没有超过原来的 `cap`，会直接复用原来的底层数组。

```go
s := make([]int, 0, 4)
s = append(s, 1, 2)

// len = 2, cap = 4
// 继续 append，不一定分配新数组
s = append(s, 3)
```

如果超过 `cap`，runtime 会分配一个更大的底层数组，把旧数据复制过去，然后返回新的 slice。

```go
s := make([]int, 0, 2)
s = append(s, 1, 2)
s = append(s, 3) // 超过 cap，触发扩容
```

Go 当前的 slice 扩容核心策略大致是：

```text
如果需要的新长度 > 旧容量 * 2：
    直接扩到至少新长度

如果旧容量 < 256：
    大约 2 倍扩容

如果旧容量 >= 256：
    逐渐过渡到大约 1.25 倍扩容
```

源码里的核心逻辑可以简化为：

```go
if newLen > oldCap*2 {
    return newLen
}

if oldCap < 256 {
    return oldCap * 2
}

for newCap < newLen {
    newCap += (newCap + 3*256) >> 2
}
```

注意：这只是目标容量。最终实际容量还会根据元素大小和 Go 内存分配器的规格向上取整，所以实际看到的 `cap` 不一定严格等于公式结果。

### 1.5 slice 需要注意的点

#### 1.5.1 子 slice 共享底层数组

```go
a := []int{1, 2, 3}
b := a[:2]

b[0] = 100

fmt.Println(a) // [100 2 3]
```

因为 `a` 和 `b` 指向同一个底层数组。

#### 1.5.2 append 可能影响原 slice

```go
a := []int{1, 2, 3, 4}
b := a[:2]

b = append(b, 100)

fmt.Println(a) // [1 2 100 4]
```

因为 `b` 的容量还够，所以 `append` 复用了原来的底层数组。

如果希望避免影响原 slice，可以先复制：

```go
b := append([]int(nil), a[:2]...)
b = append(b, 100)
```

#### 1.5.3 子 slice 可能导致大数组无法释放

```go
func readSmall() []byte {
    big := make([]byte, 1024*1024)
    return big[:10]
}
```

返回的 slice 只有 10 字节，但它仍然引用着整个 1MB 的底层数组，GC 无法回收这块大数组。

更好的写法：

```go
func readSmall() []byte {
    big := make([]byte, 1024*1024)
    small := make([]byte, 10)
    copy(small, big[:10])
    return small
}
```

#### 1.5.4 nil slice 和空 slice

```go
var a []int        // nil slice
b := []int{}      // empty slice
c := make([]int, 0)
```

它们的 `len` 都是 0，也都可以 `append`。

区别：

```go
fmt.Println(a == nil) // true
fmt.Println(b == nil) // false
fmt.Println(c == nil) // false
```

JSON 编码时也可能不同：

```go
nil slice   -> null
empty slice -> []
```

#### 1.5.5 range 中的值是副本

```go
for _, v := range s {
    v = v * 2 // 不会修改 s 里的元素
}
```

要修改原 slice：

```go
for i := range s {
    s[i] = s[i] * 2
}
```

## 2. Map

### 2.1 map 是什么

map 是 Go 内置的哈希表，用来保存 key-value。

常用写法：

```go
m := map[string]int{
    "a": 1,
    "b": 2,
}

m["c"] = 3
v := m["a"]
delete(m, "b")
```

判断 key 是否存在：

```go
v, ok := m["x"]
if ok {
    fmt.Println(v)
}
```

为什么需要 `ok`？

因为 key 不存在时，map 会返回 value 类型的零值。

```go
m := map[string]int{}

fmt.Println(m["x"]) // 0
```

无法只靠返回值判断 `"x"` 是不存在，还是存在但值就是 `0`。

### 2.2 map 的 key 要求

map 的 key 必须是可比较类型。

可以作为 key：

```go
int
string
bool
pointer
array
struct // 前提是字段都可比较
```

不能作为 key：

```go
slice
map
function
```

例如：

```go
// 错误
map[[]int]string{}
```

因为 slice 不能用 `==` 比较。

### 2.3 nil map

map 的零值是 nil。

```go
var m map[string]int
```

nil map 可以读：

```go
fmt.Println(m["x"]) // 0
```

但不能写：

```go
m["x"] = 1 // panic
```

正确写法：

```go
m := make(map[string]int)
m["x"] = 1
```

### 2.4 map 遍历无序

```go
for k, v := range m {
    fmt.Println(k, v)
}
```

map 的遍历顺序不稳定，不要依赖遍历顺序。

如果需要稳定顺序，先取出 key 排序：

```go
keys := make([]string, 0, len(m))
for k := range m {
    keys = append(keys, k)
}
sort.Strings(keys)

for _, k := range keys {
    fmt.Println(k, m[k])
}
```

### 2.5 map 并发安全问题

普通 map 不是并发安全的。

多个 goroutine 同时读写 map，可能 panic，也可能产生数据竞争。

错误示例：

```go
go func() {
    m["a"] = 1
}()

go func() {
    fmt.Println(m["a"])
}()
```

常见解决方式：

```go
var mu sync.RWMutex
m := make(map[string]int)

mu.Lock()
m["a"] = 1
mu.Unlock()

mu.RLock()
v := m["a"]
mu.RUnlock()
```

或者使用 `sync.Map`。

`sync.Map` 适合读多写少、key 相对稳定的场景，不是所有 map 都应该替换成 `sync.Map`。

### 2.6 新版本 Go map 的底层结构

Go 1.24 开始，内置 map 使用 Swiss Table 风格实现。

可以先把它理解成四层：

```text
Map
  -> directory
      -> table
          -> group
              -> slot
```

#### 2.6.1 slot

一个 slot 存一对 key/value。

```text
slot = key + value
```

#### 2.6.2 group

一个 group 里有 8 个 slot。

每个 slot 有一个对应的 control byte。

```text
group
├── ctrl[8]
└── slot[8]
```

control byte 记录这个 slot 的状态：

```text
empty   // 空位置
deleted // 删除后留下的墓碑
full    // 正在使用
```

如果是 full，control byte 里还会保存 hash 的低 7 位，也就是 H2。

为什么是 8 个 slot？

因为 8 个 control byte 可以一起参与快速匹配。查找时先看 control byte，而不是马上比较 key。

这样可以减少真正比较 key 的次数，尤其是 string、interface、struct 这类比较成本可能较高的 key。

#### 2.6.3 table

table 是一张 Swiss Table。

它内部有多个 group：

```text
table
├── used        // 当前有效元素数量
├── capacity    // slot 总数
├── growthLeft  // 还能插多少新元素才需要整理或扩容
├── localDepth  // 这个 table 使用了多少 hash 高位前缀
└── groups
    ├── group
    ├── group
    └── ...
```

#### 2.6.4 directory

directory 是一个 table 指针数组。

它根据 hash 的高位选择某个 table。

```text
directory
├── table A
├── table A
├── table B
└── table C
```

注意：多个 directory 位置可以指向同一个 table。

这是因为某些 table 还没有分裂得那么细。

### 2.7 hash 在新版 map 中怎么用

对 key 计算 hash 后，可以粗略拆成：

```text
hash 高位:
    用来在 directory 里选择 table

hash 去掉低 7 位后的部分:
    用来在 table 内选择起始 group，并参与探测

hash 低 7 位:
    H2，存进 control byte，用来快速筛选 slot
```

假设：

```text
H2 = hash & 0x7f
H1 = hash >> 7
```

查找时：

```text
1. 用 hash 高位从 directory 找 table
2. 用 H1 在 table 内找起始 group
3. 在 group 的 8 个 control byte 里匹配 H2
4. H2 匹配后，再真正比较 key
```

H2 只是一个快速过滤器，不是最终判断。

即使 H2 相同，也必须继续比较 key。

### 2.8 map 查找流程

```go
v := m[k]
```

大致流程：

```text
1. 计算 key 的 hash
2. 如果是小 map，直接在唯一 group 中查找
3. 如果是普通 map：
   3.1 用 hash 高位选择 directory 下标
   3.2 得到 table
   3.3 在 table 内选择起始 group
   3.4 检查这个 group 的 8 个 control byte
   3.5 找到 H2 匹配的位置
   3.6 对候选 slot 比较 key
   3.7 如果找到，返回 value
   3.8 如果没找到，并且遇到 empty，说明 key 不存在
   3.9 如果没遇到 empty，继续按探测序列找下一个 group
```

为什么遇到 empty 可以停止？

因为插入时会把元素放到探测路径上的第一个可用位置。如果查找路径上出现了真正的 empty，说明这个 key 当初不可能越过这个 empty 被放到后面。

### 2.9 map 插入流程

```go
m[k] = v
```

如果 key 已存在：

```text
1. 找到 key 对应的 slot
2. 直接覆盖 value
3. map 元素数量不变
```

如果 key 不存在：

```text
1. 计算 hash
2. 找到 table
3. 找到起始 group
4. 沿探测序列查找
5. 记住第一个 deleted 位置
6. 直到确认 key 不存在
7. 优先复用 deleted，否则使用 empty
8. 写入 key
9. 写入 value
10. control byte 写入 H2
11. used++
12. growthLeft 根据情况减少
```

为什么遇到 deleted 不马上插入？

因为后面可能还有相同 key。如果马上插入，可能导致一个 key 出现两份。

所以插入时会继续查找，直到确认 key 不存在，才使用之前记住的 deleted 或 empty 位置。

### 2.10 map 删除流程

```go
delete(m, k)
```

大致流程：

```text
1. 如果 map 为空，直接返回
2. 计算 hash
3. 找到 table 和 group
4. 找到 key 对应的 slot
5. 清理 key/value
6. used--
7. 修改 control byte
```

删除时 control byte 可能变成：

```text
empty
deleted
```

能安全变成 empty，就变成 empty。

如果直接变成 empty 会破坏查找路径，就变成 deleted。

deleted 又叫 tombstone，意思是“这里以前有元素，现在删了，但查找不能在这里停止”。

### 2.11 map 扩容和整理

新版 map 的扩容不是整个 map 一起搬迁，而是以 table 为单位处理。

每个 table 有一个 `growthLeft`：

```text
growthLeft = 还能插多少新元素，才需要整理或扩容
```

负载目标大约是：

```text
7 / 8
```

也就是平均 8 个 slot 最多放约 7 个有效占用。

为什么不能填满？

因为 open addressing 哈希表需要 empty slot 作为查找失败的停止标志。如果完全填满，查找一个不存在的 key 时可能无法停下来。

当插入新 key 时，如果 `growthLeft == 0`：

```text
1. 先尝试清理 tombstone
2. 如果清理后有空间，继续插入
3. 如果还是不够，就 rehash
```

rehash 有两种方式：

```text
1. grow
2. split
```

#### 2.11.1 grow

如果 table 还没到最大限制，就把这个 table 扩成 2 倍。

```text
capacity: 16 -> 32 -> 64 -> 128 -> 256 -> 512 -> 1024
```

grow 时会：

```text
1. 创建一个更大的新 table
2. 遍历旧 table
3. 跳过 empty 和 deleted
4. 把 full slot 重新插入新 table
5. 用新 table 替换旧 table
```

grow 会顺便清掉 tombstone，因为 deleted 不会被搬到新 table。

#### 2.11.2 split

当前实现里，单个 table 最大容量是 1024 个 slot。

如果 table 已经是 1024，再需要扩容，就不继续变大，而是 split：

```text
old table
  -> left table
  -> right table
```

split 时，会多看一位 hash 高位，把旧 table 负责的数据分成两半。

```text
hash 某一位是 0 -> left table
hash 某一位是 1 -> right table
```

如果 directory 当前不够表达新的分裂结果，directory 自己也会翻倍。

这样做的好处是：大 map 扩容时不用一次性搬整个 map，只处理某个 table。

### 2.12 map 重点注意

1. key 必须可比较。
2. nil map 可以读，不能写。
3. 访问不存在的 key 会返回零值。
4. 判断 key 是否存在要用 `v, ok := m[k]`。
5. 遍历顺序不稳定。
6. 普通 map 不是并发安全的。
7. 删除不存在的 key 是安全的。
8. map 不能取元素地址。

例如：

```go
// 错误
p := &m["a"]
```

因为 map 扩容、重排时，元素位置可能变化。

## 3. Channel

### 3.1 channel 是什么

channel 用于 goroutine 之间通信和同步。

创建：

```go
ch := make(chan int)      // 无缓冲 channel
ch2 := make(chan int, 10) // 有缓冲 channel
```

发送：

```go
ch <- 1
```

接收：

```go
v := <-ch
```

关闭：

```go
close(ch)
```

### 3.2 channel 的底层结构

可以把 channel 的底层结构理解成：

```go
type hchan struct {
    qcount   uint           // 当前缓冲区中有多少元素
    dataqsiz uint           // 缓冲区大小
    buf      unsafe.Pointer // 环形队列
    elemsize uint16         // 元素大小
    closed   uint32         // 是否关闭
    sendx    uint           // 下一个发送位置
    recvx    uint           // 下一个接收位置
    recvq    waitq          // 等待接收的 goroutine 队列
    sendq    waitq          // 等待发送的 goroutine 队列
    lock     mutex          // 保护 channel 内部状态
}
```

可以画成：

```text
channel
├── lock
├── buffer ring
├── sendq
└── recvq
```

### 3.3 无缓冲 channel

```go
ch := make(chan int)
```

无缓冲 channel 没有存放数据的队列。

发送方和接收方必须同时准备好。

```go
go func() {
    ch <- 1 // 等待接收方
}()

v := <-ch
```

无缓冲 channel 常用于同步。

```text
发送完成，通常意味着接收方已经拿到了数据
```

### 3.4 有缓冲 channel

```go
ch := make(chan int, 2)
```

有缓冲 channel 内部有一个环形队列。

```go
ch <- 1
ch <- 2
```

此时缓冲区满了。

如果继续发送：

```go
ch <- 3
```

会阻塞，直到有接收方取走数据。

接收时：

```go
v := <-ch
```

会从缓冲区取出一个元素。

### 3.5 发送和接收的规则

#### 3.5.1 发送

发送时大致流程：

```text
1. 如果 channel 是 nil，永久阻塞
2. 如果 channel 已关闭，panic
3. 如果有等待接收的 goroutine，直接把数据交给它
4. 如果有缓冲区且没满，把数据放入缓冲区
5. 否则当前 goroutine 进入 sendq 阻塞等待
```

#### 3.5.2 接收

接收时大致流程：

```text
1. 如果 channel 是 nil，永久阻塞
2. 如果有等待发送的 goroutine，并且无缓冲或可配合移动数据，接收数据
3. 如果缓冲区有数据，从缓冲区取出
4. 如果 channel 已关闭且缓冲区为空，返回零值
5. 否则当前 goroutine 进入 recvq 阻塞等待
```

### 3.6 close 的语义

`close(ch)` 表示：

```text
不会再向这个 channel 发送数据
```

不是清空 channel。

关闭 channel 后：

```text
继续发送       -> panic
继续接收       -> 可以
缓冲区有数据   -> 先读完缓冲区数据
缓冲区读完之后 -> 返回零值，ok=false
```

判断 channel 是否关闭：

```go
v, ok := <-ch
if !ok {
    fmt.Println("channel closed")
}
```

遍历 channel：

```go
for v := range ch {
    fmt.Println(v)
}
```

`range` 会一直读，直到 channel 被关闭并且缓冲区数据读完。

### 3.7 nil channel

```go
var ch chan int
```

nil channel 的发送和接收都会永久阻塞。

```go
ch <- 1 // 永久阻塞
<-ch    // 永久阻塞
```

nil channel 在 `select` 中很有用，可以动态禁用某个 case。

```go
var ch chan int

select {
case v := <-ch:
    fmt.Println(v) // 不会触发
default:
    fmt.Println("default")
}
```

### 3.8 select

`select` 用来同时等待多个 channel 操作。

```go
select {
case v := <-ch1:
    fmt.Println("ch1:", v)
case ch2 <- 10:
    fmt.Println("sent")
case <-time.After(time.Second):
    fmt.Println("timeout")
}
```

规则：

```text
1. 如果多个 case 同时就绪，随机选择一个
2. 如果没有 case 就绪，有 default 就执行 default
3. 如果没有 case 就绪，也没有 default，就阻塞
4. nil channel 对应的 case 永远不会就绪
```

### 3.9 channel 使用注意

1. 不要向已关闭的 channel 发送数据。
2. 不要重复 close 同一个 channel。
3. 通常由发送方关闭 channel。
4. 接收方不要随便关闭 channel，因为它不知道是否还有发送方。
5. close 不是广播取消的唯一方式，复杂场景更推荐 `context.Context`。
6. channel 适合表达数据流和同步，不适合替代所有锁。

错误示例：

```go
ch := make(chan int)
ch <- 1 // 没有接收者，死锁
```

正确示例：

```go
ch := make(chan int)

go func() {
    ch <- 1
}()

fmt.Println(<-ch)
```

### 3.10 用 channel 做 worker pool

```go
jobs := make(chan int)
results := make(chan int)

for i := 0; i < 3; i++ {
    go func() {
        for job := range jobs {
            results <- job * 2
        }
    }()
}

go func() {
    for i := 0; i < 10; i++ {
        jobs <- i
    }
    close(jobs)
}()

for i := 0; i < 10; i++ {
    fmt.Println(<-results)
}
```

这里：

```text
jobs    用来分发任务
results 用来收集结果
close(jobs) 通知 worker 没有新任务了
```

## 4. 三者对比

| 类型 | 核心本质 | 零值表现 | 是否并发安全 | 常见用途 |
| --- | --- | --- | --- | --- |
| slice | 底层数组的视图 | nil slice 可 append | 否 | 动态序列 |
| map | 哈希表 | nil map 可读不可写 | 否 | key-value 查找 |
| channel | 同步队列 | nil channel 收发阻塞 | 是 | goroutine 通信 |

## 5. 重点总结

### slice

```text
slice = 指针 + len + cap
append 可能复用底层数组，也可能分配新数组
子 slice 会共享底层数组
小容量大约 2 倍扩容，大容量逐渐接近 1.25 倍扩容
```

### map

```text
map = 哈希表
Go 1.24+ 使用 Swiss Table 风格实现
directory 选 table
table 里有 groups
group 里有 8 个 slot 和 8 个 control byte
H2 用于快速筛选，key 比较才是最终判断
删除可能留下 tombstone
空间不够时先清 tombstone，再 grow 或 split
```

### channel

```text
channel = 环形缓冲区 + sendq + recvq + lock
无缓冲 channel 用于同步
有缓冲 channel 可以暂存数据
nil channel 收发都会永久阻塞
close 表示不再发送，不是清空
发送到已关闭 channel 会 panic
```

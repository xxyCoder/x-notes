## 前置定义：非缓冲 IO

非缓冲 IO 指：**用户态无缓冲区**，每次读写直接发起系统调用。
**但是内核一定有 PageCache 页缓存**。

核心区别：
- stdio(fread/fwrite)：用户层缓冲，减少系统调用
- 系统调用(read/write)：无用户缓冲，**write 成功只写到页缓存，不保证落盘**，掉电丢失，持久化必须 fsync/fdatasync

---

## 一、open / openat / openat2 / creat 完整机制

### 1. open 核心标志

必须三选一：`O_RDONLY` / `O_WRONLY` / `O_RDWR`

常用标志：
- `O_CREAT`：不存在则创建
- `O_TRUNC`：打开清空文件
- `O_EXCL`：必须配合 O_CREAT，**原子排他创建**
- `O_APPEND`：write 强制尾部追加，忽略 lseek
- `O_NONBLOCK`：只对管道/套接字有效，**磁盘文件无效**
- `O_DIRECTORY`：只能打开目录

### 2. creat 本质

```
creat = O_WRONLY | O_CREAT | O_TRUNC
```
遗留接口：只能写、强制清空、不能读、无独占创建能力。

### 3. openat 本质

解决多线程下不能使用`chdir`的问题，基于**目录 fd** 解析相对路径。

缺陷：
**openat 不拦截 ../，可路径逃逸，存在 TOCTOU 风险**

### 4. openat2 安全机制

- `RESOLVE_BENEATH`：路径出现 `..` 直接报错，禁止向上跳转
- `RESOLVE_IN_ROOT`：允许写 `..`，但**不能跳出 dirfd 目录**，模拟虚拟根
- `RESOLVE_NO_SYMLINKS`：禁止跟随符号链接，防御符号链接逃逸

---

## 二、TOCTOU

### 1. TOCTOU全称

Time Of Check Time Of Use
> 检查操作 和 使用操作不是原子，中间存在可被篡改的时间窗口。

### 2. 产生原因
用户态做合法性校验，再调用内核系统调用；两步之间攻击者可以替换符号链接、修改目录项，让内核操作的对象和用户态检查时不一致。

错误示例：
```c
if(access(path, F_OK) == 0){
    // 时间窗口：攻击者修改符号链接/目录
    fd = open(path, O_RDONLY);
}
```

### 3. O_CREAT | O_EXCL 的能力边界

✅**新建文件场景**：`O_CREAT|O_EXCL`，内核原子完成「检查是否存在+创建文件」，消除时间窗口，解决新建场景TOCTOU。

❌**打开已有文件场景无效**：O_EXCL会要求文件必须不存在，不能用来打开已经存在的文件，该场景下TOCTOU风险依旧存在。

### 4. 解决方案
1. 新建文件：使用 `O_CREAT | O_EXCL`。
2. 打开不可信的已有路径：
   - Linux5.6+：`openat2 + RESOLVE_BENEATH`，内核内部原子校验路径。
   - 旧内核：信任fd，不信任传入的路径字符串；拿到fd后用`fstat`比对inode。

---

## 三、close

1. fd槽位同步释放，fd立即作废，该数字可被后续open/dup复用。
2. 递减`struct file`引用计数。
3. 引用计数归0：
   - 用户进程：task_work延迟释放内核对象；
   - 中断上下文：同步释放。
4. close返回‑1（EINTR/EBADF），**禁止重试close，fd已经失效**。
5. close**不保证数据落盘**。
6. fork、dup会增加引用计数；全部fd都close，才会释放struct file。
7. openat拿到的目录fd也必须close，否则发生fd泄漏。常驻进程耗尽fd上限会返回EMFILE。

---

## 四、lseek

1. 文件偏移保存在`struct file`，不在inode；dup/fork共享同一个struct file，因此共享偏移。
2. pipe、socket、FIFO不支持lseek，返回‑1，errno=ESPIPE。
3. lseek只修改偏移，**不会修改文件大小**。
4. lseek偏移跳到超出文件大小，后续write产生**文件空洞**，空洞不占用磁盘块，读返回`\0`。
5. O_APPEND只影响write；lseek可以修改内存中的偏移，但write执行时会强制切到文件末尾。

---

## 五、read

1. 在当前文件偏移读取，读完自动推进偏移。
2. 返回>0：读到字节数；返回0：EOF；返回‑1出错。
3. read不保证读完count，管道、socket、信号中断、文件末尾剩余数据不足，都会返回小于count的值，代码需要循环读取。
4. O_NONBLOCK：
   - pipe/socket：无数据返回‑1，EAGAIN。
   - 普通磁盘文件：O_NONBLOCK无效，page cache miss依然会阻塞磁盘IO。
5. pread(fd, buf, count, offset)：指定偏移读取，**不修改struct file内部偏移**。

---

## 六、write
```c
ssize_t write(int fd, const void *buf, size_t count);
```
> write的语义：**请求最多写入count字节，不是保证一定写入count字节**。

### 为什么write会返回小于count（写不完）
1. **管道、socket**：内核缓冲区已满，内核能接收多少就返回多少，不会继续拷贝，阻塞模式下线程会睡眠等待缓冲区；O_NONBLOCK直接返回EAGAIN。
2. **被信号中断(EINTR)**：write已经拷贝了一部分数据到内核缓冲区，此时被信号打断，直接返回已经写入的字节，不会继续写完剩余部分。
3. **普通磁盘文件极少出现写不完**：页缓存空间充足的情况下write一般全部写完。但不能假设一定写完：当内存紧张、遇到信号中断、`O_DIRECT`直接IO场景，依然会出现部分写入。

> 所以业务代码必须写循环，处理部分写入，不能忽略返回值。

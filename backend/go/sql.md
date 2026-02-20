## DB

```go
type connRequestSet struct {
    // s are the elements in the set.
    s []connRequestAndIndex
}

type DB struct {
    // 1. 原子操作状态 (无锁高频访问)
    waitDuration atomic.Int64 // Total time waited for new connections.
    connector driver.Connector
    numClosed atomic.Uint64 // 记录一共关闭了多少个物理连接

    // 2. 核心状态机 (由 Mutex 保护)
    mu           sync.Mutex
    freeConn     []*driverConn  // free connections ordered by returnedAt oldest to newest
    connRequests connRequestSet // 等待队列
    numOpen      int // number of opened and pending open connections

    // 3. 异步任务与生命周期控制
    openerCh          chan struct{}
    closed            bool
    dep               map[finalCloser]depSet
    lastPut           map[*driverConn]string 
    cleanerCh         chan struct{}
    stop func() 

    // 4. 连接池配置参数
    maxIdleCount      int                    
    maxOpen           int                    
    maxLifetime       time.Duration          
    maxIdleTime       time.Duration          

    // 5. 统计信息
    waitCount         int64 
    maxIdleClosed     int64 
    maxIdleTimeClosed int64 
    maxLifetimeClosed int64 
}
```

1. `openerCh` 是一个带有缓冲区的通道（大小为 1000000）。当池子空了且还没达到最大连接数时，主业务不会自己去建立连接（因为建连涉及网络 I/O，非常慢），而是往这个 Channel 塞一个空结构体 struct{}{}
2. 在 DB 初始化 (OpenDB 函数) 时，会启动一个名为 `connectionOpener` 的常驻后台 Goroutine。它死循环监听这个 Channel，一旦收到信号，它就在后台慢慢去建立新连接。`stop` 是一个 Context Cancel 函数，用于在调用 `db.Close()` 时优雅地关闭这个后台 Goroutine
3. `cleanerCh chan struct{}` 控制后台清理过期连接的 Goroutine (connectionCleaner)。当配置的超时时间发生改变时，通过这个通道唤醒清理器

## OpenDB

```go
func Open(driverName, dataSourceName string) (*DB, error) {
    // 1. 查表：通过驱动名寻找注册好的驱动
    driversMu.RLock()
    driveri, ok := drivers[driverName]
    driversMu.RUnlock()
    if !ok {
       return nil, fmt.Errorf("sql: unknown driver %q (forgotten import?)", driverName)
    }

    // 2. 现代驱动处理分支 (Go 1.10+)
    if driverCtx, ok := driveri.(driver.DriverContext); ok {
       connector, err := driverCtx.OpenConnector(dataSourceName)
       if err != nil {
          return nil, err
       }
       return OpenDB(connector), nil
    }

    // 3. 传统驱动处理分支 (兼容 Go 1.10 之前)
    return OpenDB(dsnConnector{dsn: dataSourceName, driver: driveri}), nil
}

var connectionRequestQueueSize = 1000000
func OpenDB(c driver.Connector) *DB {
    ctx, cancel := context.WithCancel(context.Background())
    db := &DB{
        connector: c,
        openerCh:  make(chan struct{}, connectionRequestQueueSize),
        lastPut:   make(map[*driverConn]string),
        stop:      cancel,
    }

    go db.connectionOpener(ctx)

    return db
}

func (db *DB) connectionOpener(ctx context.Context) {
    for {
        select {
            case <-ctx.Done(): return
            case <-db.openerCh: db.openNewConnection(ctx)
		}
    }
}
```

1. `OpenDB` 里面根本没有执行任何网络 IO 或连接数据库的代码，它仅仅是在内存里把 DB 结构体的壳子搭建好，把用于传递信号的 Channel 准备好，然后就立刻返回了
2. `openNewConnection` 远端数据库进行 TCP 握手并建立物理连接

## OpenNewConnectin

```go
// Open one new connection (打开一个新的物理连接)
func (db *DB) openNewConnection(ctx context.Context) {
    // 【前置知识/原理】：乐观计数
    // 在调用此方法前，触发器 maybeOpenNewConnections 已经“乐观”地执行了 db.numOpen++。
    // 也就是说，系统先占了一个“名额”。如果在这个函数里建连失败，必须负责把 db.numOpen 减回去。

    // 1. 核心网络 I/O：真正去建立连接 (注意：此时没有加锁！)
    ci, err := db.connector.Connect(ctx)
    
    // 2. 加锁：准备修改 DB 的内部核心状态
    db.mu.Lock()
    defer db.mu.Unlock()

    // 3. 边界条件：如果在建连的漫长过程中，用户突然调用了 db.Close() 怎么办？
    if db.closed {
       if err == nil {
          ci.Close() // 刚建好的物理连接，直接销毁，因为数据库句柄已经关了
       }
       db.numOpen--  // 扣除前面乐观占用的名额
       return
    }

    // 4. 异常处理：如果由于网络原因、密码错误等导致建连失败
    if err != nil {
       db.numOpen-- // 扣除名额
       // 把错误广播给正在排队等连接的业务协程，让他们别等了，直接返回 error
       db.putConnDBLocked(nil, err) 
       // 既然失败了，可能还有其他请求在排队，再次评估是否需要重新触发新建连接流程
       db.maybeOpenNewConnections()
       return
    }

    // 5. 包装器模式 (Wrapper Pattern)：封装底层驱动连接
    dc := &driverConn{
       db:         db,          // 记录所属的连接池
       createdAt:  nowFunc(),   // 记录连接的出生时间 (用于 maxLifetime 淘汰)
       returnedAt: nowFunc(),   // 记录连接归还的时间 (用于 maxIdleTime 淘汰)
       ci:         ci,          // 保存真正的底层物理连接实例
    }

    // 6. 资源交付与依赖追踪
    if db.putConnDBLocked(dc, err) {
       // 如果成功交付给了排队的人，或者成功放进了空闲池
       db.addDepLocked(dc, dc) // 将这个连接加入依赖管理树 (垃圾回收体系)
    } else {
       // 极端情况：比如放回池子时发现池子满了（超过 maxIdleConns），直接丢弃
       db.numOpen--
       ci.Close()
    }
}
```

1. 主程序一看请求来了，先给 numOpen 加 1（变成 91），然后发信号给后台。后面的请求依次把 numOpen 加到 100。第 11 个以后的请求发现 numOpen 已经是 100 了，就不会再发信号去建新连接了，而是乖乖去 connRequests 队列里排队。如果后台实际建连失败，再把坑位退出来 (numOpen--)。这是一种极其优雅的限流自保机制

## Begin

```go
func (db *DB) BeginTx(ctx context.Context, opts *TxOptions) (*Tx, error) {
	var tx *Tx
	var err error

	err = db.retry(func(strategy connReuseStrategy) error {
		tx, err = db.begin(ctx, opts, strategy)
		return err
	})

	return tx, err
}

func (db *DB) retry(fn func(strategy connReuseStrategy) error) error {
    for i := int64(0); i < maxBadConnRetries; i++ {
        err := fn(cachedOrNewConn)
        // retry if err is driver.ErrBadConn
        if err == nil || !errors.Is(err, driver.ErrBadConn) {
            return err
        }
    }

    return fn(alwaysNewConn)
}

func (db *DB) begin(ctx context.Context, opts *TxOptions, strategy connReuseStrategy) (tx *Tx, err error) {
    // 1. 获取一个物理连接 (driverConn)
    dc, err := db.conn(ctx, strategy)
    if err != nil {
        return nil, err
    }
    // 2. 在这个物理连接上执行具体的 Begin 操作
    return db.beginDC(ctx, dc, dc.releaseConn, opts)
}

func (db *DB) beginDC(ctx context.Context, dc *driverConn, release func(error), opts *TxOptions) (tx *Tx, err error) {
    var txi driver.Tx
    keepConnOnRollback := false
    
    // 必须加锁，因为要直接操作底层驱动
    withLock(dc, func() {
        // 接口断言：探测驱动能力
        _, hasSessionResetter := dc.ci.(driver.SessionResetter)
        _, hasConnectionValidator := dc.ci.(driver.Validator)
        
        keepConnOnRollback = hasSessionResetter && hasConnectionValidator
        
        // 真正通知底层数据库开启事务 (例如发送 "START TRANSACTION" 或 "BEGIN")
        txi, err = ctxDriverBegin(ctx, opts, dc.ci)
    })
    
    if err != nil {
        release(err) // 如果 Begin 失败，立刻释放物理连接
        return nil, err
    }
    
    // Schedule the transaction to rollback when the context is canceled.
    ctx, cancel := context.WithCancel(ctx)
    tx = &Tx{
        db:                 db,
        dc:                 dc,          // 物理连接被封印在 Tx 里了！
        releaseConn:        release,     // 记住如何释放它
        txi:                txi,         // 驱动层返回的事务句柄
        cancel:             cancel,
        keepConnOnRollback: keepConnOnRollback,
        ctx:                ctx,
    }
    
    // 启动异步守护协程
    go tx.awaitDone()
    return tx, nil
}

func (tx *Tx) awaitDone() {
    <-tx.ctx.Done()
	
    discardConnection := !tx.keepConnOnRollback
    tx.rollback(discardConnection)
}
```

1. 这里调用了 `db.retry`，这是一个高阶函数，它接收一个闭包。闭包内部调用真实的 `db.begin` 方法。为什么开启事务需要重试？因为从连接池中拿到的“缓存连接”（cachedOrNewConn 策略）有可能在你拿到的一瞬间，对端的数据库服务器刚好把它干掉了（比如 MySQL 的 wait_timeout 到期）。如果底层驱动返回了 driver.ErrBadConn，retry 机制会捕获这个特定错误，并自动使用 alwaysNewConn 策略强制发起一次全新的 TCP 连接请求。这种设计极大降低了网络闪断导致的业务层报错
2. `awaitDone` 会在后台死等这个 `ctx.Done()`。一旦外部传入的 Context 超时了（比如 HTTP 请求超时取消），或者用户触发了某种 Cancel，这个守护协程会立刻醒来，强制执行 `tx.rollback(discardConnection)`，并在数据库端中断这笔失控的事务，释放连接。

## Ping

```go
func (db *DB) PingContext(ctx context.Context) error {
	var dc *driverConn
	var err error

	err = db.retry(func(strategy connReuseStrategy) error {
		dc, err = db.conn(ctx, strategy)
		return err
	})

	if err != nil {
		return err
	}

	return db.pingDC(ctx, dc, dc.releaseConn)
}

func (dc *driverConn) releaseConn(err error) {
    dc.db.putConn(dc, err, true)
}

func (db *DB) pingDC(ctx context.Context, dc *driverConn, release func(error)) error {
    var err error
    if pinger, ok := dc.ci.(driver.Pinger); ok {
        withLock(dc, func() {
            err = pinger.Ping(ctx)
        })
    }
    release(err)
    return err
}
```

1. `Ping` 真正调用底层驱动的探活逻辑
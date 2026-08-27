## 浏览器和服务端的Fetch区别

浏览器的fetch依赖引擎底层的网络栈

nodejs在v18中将fetch改为非实验特性了，由undici实现，无cors限制、可配置代理

还可以使用undici中提供的request，更高效 [官方数据](https://undici.nodejs.org/#/?id=benchmarks)

## 开启连接池

HTTP/1.1 默认支持长连接，但是服务端不像浏览器会内建连接池帮忙管理http请求，所以导致每个http请求都会创建新的TCP连接

```JavaScript
const http = require("http");
const options = {
  host: "example.com",
  agent: false, // 显式禁用连接池
};

// 连续请求将创建独立连接
http.get(options, (res) => {
  console.log(`连接1使用端口: ${res.socket.localPort}`);
});

http.get(options, (res) => {
  console.log(`连接2使用端口: ${res.socket.localPort}`);
});
```

### 浏览器中的连接池

为每个域名维护独立连接池（默认6-8个TCP连接），超出连接数时进入排队等待，高优先级优先使用连接，当连接空闲时进行维护一段时间

### 服务端中的连接池

#### HTTP.Agent

```JavaScript
const http = require('http')
const agent = new http.Agent({
  keepAlive: true,           // 保持连接活跃
  keepAliveMsecs: 5000,      // 保持连接的时间（毫秒）
  maxFreeSockets: 3,         // 空闲连接池最大连接数
  maxTotalSockets: 5,        // 总连接池最大连接数
  maxSockets: 3,             // 每个主机最大连接数
  scheduling: 'fifo'         // 调度策略：先进先出
});

http.request({
  agent
})
```

#### Undici.Agent

```JavaScript
const undici = require('undici')
const { Agent } = undici
const apiAgent = new Agent({
   keepAliveTimeout: 30_000,   // 保持连接 30 秒
   connections: 100,           // 连接池大小
 });

const response = await fetch("", {
  dispatcher: apiAgent,
});
```

## 开启DNS缓存

在undici中DNS缓存默认开启，但是也可以自定义配置

```JavaScript
const undici = require("undici");
const { Agent } = undici;
const dns = require('dns');

// 简单的DNS缓存实现
class DNSCache {
  constructor(ttl = 5 * 60 * 1000) { // 默认5分钟TTL
    this.cache = new Map();
    this.ttl = ttl;
  }

  get(hostname) {
    const entry = this.cache.get(hostname);
    if (entry && Date.now() - entry.timestamp < this.ttl) {
      return entry.address;
    }
    return null;
  }

  set(hostname, address) {
    this.cache.set(hostname, {
      address,
      timestamp: Date.now()
    });
  }

  clear() {
    this.cache.clear();
  }
}

const dnsCache = new DNSCache();

const apiAgent = new Agent({
  keepAliveTimeout: 30_000, // 保持连接 30 秒
  connections: 100, // 连接池大小
  // DNS缓存配置
  connect: {
    lookup: (hostname, options, callback) => {
      // 首先检查缓存
      const cachedAddress = dnsCache.get(hostname);
      if (cachedAddress) {
        console.log(`DNS缓存命中: ${hostname} -> ${cachedAddress}`);
        return callback(null, cachedAddress, 4); // 4表示IPv4
      }

      // 缓存未命中，进行DNS查询
      dns.lookup(hostname, options, (err, address, family) => {
        if (!err && address) {
          console.log(`DNS查询: ${hostname} -> ${address}`);
          dnsCache.set(hostname, address);
        }
        callback(err, address, family);
      });
    }
  }
});

const response = await fetch("", {
  dispatcher: apiAgent,
});
```

## response.json阻塞事件

一次性读取整个响应体，完全加载到内存后解析为JSON对象

流式处理无需等待完整响应

```JavaScript
try {
  const response = await fetch("http://localhost:3000");

  if (!response.body) {
    throw new Error("响应体不可用");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    // 解码接收到的数据
    const chunk = decoder.decode(value, { stream: true });
    buffer += chunk;

    // 按行分割数据
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // 保留未完成的行

    // 处理完整的行
    for (const line of lines) {
      if (line.trim() === "") continue;

      try {
        const data = JSON.parse(line);
        processData(data);
      } catch (error) {}
    }
  }
} catch (error) {}
```

## 流式上传大数据

和await response.json() 道理一样

```JavaScript
const streamPayload = async (largeData) => {
  const encoder = new TextEncoder();
  const stream = Readable.from(
    largeData.map((item) => encoder.encode(JSON.stringify(item) + "\n"))
  );
  await fetch("http://localhost:3000", {
    method: "POST",
    body: stream,
    duplex: "half",
  });
};
```

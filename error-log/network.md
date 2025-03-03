## ETIMEOUT

- 属于TCP握手或者DNS解析超时问题，可通过telnet检查目标IP和端口是否可达

```js
// 请求一个不开放端口的 IP
axios.get("http://192.0.2.0:12345").catch((error) => {
  if (error.code === "ECONNREFUSED") {
    console.log("连接被拒绝");
  } else if (error.code === "ETIMEDOUT") {
    // 可能抛出
    console.log("连接超时");
  }
});

/**
{
  errno: -60,
  code: 'ETIMEDOUT',
  syscall: 'connect',
  address: '192.0.2.0',
  port: 12345
}
*/
```

## ENOTFOUND

- DNS解析错误，可以通过nslookup检查域名结果

```js
axios.get('http://localhostt:1337')

/** {
  errno: -3008,
  code: 'ENOTFOUND',
  syscall: 'getaddrinfo',
  hostname: 'localhostt'
}
*/
```

## UND_ERR_SOCKET

```js
{
  code: 'UND_ERR_SOCKET',
  socket: {
    localAddress: '::1',
    localPort: 52642,
    remoteAddress: '::1',
    remotePort: 1337,
    remoteFamily: 'IPv6',
    timeout: undefined,
    bytesWritten: 169,
    bytesRead: 0
  }
}
```

1. 无法建立Socket连接（目标服务器不可达）
2. scoket资源耗尽（文件描述符不足或者http客户端连接池已满）
3. socket写入或读取超时
4. SSL/TLS握手失败（证书有问题或者客户端和服务端TLS支持版本不一致）
5. socket被意外关闭

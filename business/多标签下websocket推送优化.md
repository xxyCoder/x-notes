## storage + storage event实现主从模式

仅允许一个“主”标签页维护Websocket连接，其他“从”页面通过监听storage event事件接收消息

当然也可以通过BroadcastChannel替代storage event

```js
const clientId = Math.random().toString(36).substring(2, 8) + Date.now();

const MASTER_KEY = "ws-master";
const HEARTBEAT_KEY = "ws-heartbeat";
const MESSAGE_KEY = "ws-message";

const HEARTBEAT_INTERVAL = 5000;
const HEARTBEAT_TIMEOUT = 10000;

function electMaster() {
  const currentMaster = localStorage.getItem(MASTER_KEY);
  const lastHeartBeat = localStorage.getItem(HEARTBEAT_KEY);

  const now = Date.now();
  if (
    !currentMaster ||
    !lastHeartBeat ||
    lastHeartBeat + HEARTBEAT_TIMEOUT < now
  ) {
    localStorage.setItem(MASTER_KEY, clientId);
    localStorage.setItem(HEARTBEAT_KEY, now);
    return true;
  }

  return false;
}

let ws = null;
let heartBeatTimer = null;

function closeMaster() {
  if (localStorage.getItem(MASTER_KEY) === clientId) {
    localStorage.removeItem(MASTER_KEY);
    localStorage.removeItem(HEARTBEAT_KEY);
  }
  clearInterval(heartBeatTimer);
  ws?.close();
}

function startMaster() {
  ws = new WebSocket("wss://localhost:3000");
  ws.onmessage = (event) => {
    const now = Date.now();
    const message = {
      id: now + Math.random().toString(36).substr(2, 4),
      data: event.data,
      timestamp: now,
    };

    localStorage.setItem(MESSAGE_KEY, JSON.stringify(message));
  };

  heartBeatTimer = setInterval(() => {
    localStorage.setItem(HEARTBEAT_KEY, Date.now());
  }, HEARTBEAT_INTERVAL);

  window.addEventListener("beforeunload", () => {
    closeMaster();
  });
  window.addEventListener("visibilitychange", (event) => {
    if (document.hidden) {
      closeMaster();
    } else {
      electMaster();
    }
  });
  window.addEventListener("pagehide", () => {
    closeMaster();
  });
  window.addEventListener("pageshow", () => {
    electMaster();
  });
}

function startSlave() {
  window.addEventListener("storage", (event) => {
    if (event.key === HEARTBEAT_KEY) {
      // 心跳更新
    } else if (event.key === MESSAGE_KEY) {
      const message = JSON.parse(event.newValue);
      // 进行处理
    }
  });
}

let checkMasterTimer;
function startMasterCheck() {
  checkMasterTimer = setInterval(() => {
    const lastHeartBeat = localStorage.getItem(HEARTBEAT_KEY);
    const now = Date.now();

    if (!lastHeartBeat || now - lastHeartBeat > HEARTBEAT_TIMEOUT) {
      if (electMaster()) {
        clearInterval(checkMasterTimer);
        startMaster();
      }
    }
  }, HEARTBEAT_INTERVAL);
}

if (electMaster()) {
  startMaster();
} else {
  startMasterCheck();
}
```

## shared worker

所有同源标签共享一个shared worker

```js
const worker = new SharedWorker("shared-worker.js");
worker.port.start();

// 接收Worker消息
worker.port.onmessage = (e) => {
  console.log("收到推送:", e.data);
};

// shared-worker.js
let ws = null;
const ports = []; // 存储所有标签页的端口

// 处理新页面连接
onconnect = (e) => {
  const port = e.ports[0];
  ports.push(port);

  // 首次连接时初始化WebSocket
  if (!ws) {
    ws = new WebSocket("wss://your-server");
    ws.onmessage = (event) => {
      // 向所有标签页广播消息
      ports.forEach((p) => p.postMessage(event.data));
    };
  }

  // 处理页面发送的指令
  port.onmessage = (e) => {
    if (e.data.type === "close") ws.close();
  };
};

```

3. 后端维护

如果页面一多，内存爆炸

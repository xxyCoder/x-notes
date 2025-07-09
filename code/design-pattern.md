## 单例模式

### 定义

* 单例即单一的实例，确切地讲就是指在某个系统中只存在一个实例，同时提供集中、统一的访问接口，以使系统行为保持协调一致。

### 类型

* 饿汉模式：在初始化阶段就主动进行实例化，避免获取实例时进行等待
* 懒汉模式：在调用阶段才进行实例化，避免浪费资源

### 使用场景

1. 全局状态管理（如Redux、Pinia）

```JavaScript
export const createStore = (reducer) => {
  if (!storeInstance) {
    storeInstance = Redux.createStore(reducer);
  }
  return storeInstance;
};

export const store = createStore(rootReducer);
```

2. 弹出层

```JavaScript
class ModalManager {
  constructor() {
    if (ModalManager.instance) return ModalManager.instance;
    this.modals = {};
    ModalManager.instance = this;
  }

  open(id) {
    this.modals[id]?.show();
  }

  register(modal) {
    this.modals[modal.id] = modal;
  }
}

export const modalManager = new ModalManager();

// 其他文件 
modalManager.register({ id: "login", show: () => {} });
modalManager.open("login"); // 全局统一管理弹窗
```

3. 缓存等资源管理模块

```JavaScript
class Cache {}

export default new Cache()
```

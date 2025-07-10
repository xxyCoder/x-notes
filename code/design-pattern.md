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

## 原型模式

### 定义

用对象创建对象，而不是用类创建对象。

### 目的

从原型实例克隆出新的实例，对于那些有非常复杂的初始化过程的对象或者是需要耗费大量资源的情况，原型模式是更好的选择。

### 类型

1. 浅拷贝，可节约内存
2. 深拷贝

### 使用场景

1. 当需要重复创建相似的复杂DOM元素时，使用克隆代替创建

```JavaScript
// 原型：模板元素
const cardPrototype = document.getElementById("card-template").content;

// 克隆创建新元素
function createCard(data) {
  const clone = document.importNode(cardPrototype, true);
  clone.querySelector(".title").textContent = data.title;
  clone.querySelector(".desc").textContent = data.desc;
  return clone;
}

// 使用
const newCard = createCard({ title: "Demo", desc: "Prototype Pattern" });
document.body.appendChild(newCard);
```

2. 配置对象复用

```JavaScript
// 基础配置原型
const baseConfig = {
  apiUrl: "https://api.example.com",
  timeout: 3000,
  headers: { "Content-Type": "application/json" }
};

// 扩展配置
const userConfig = Object.assign({}, baseConfig, {
  endpoint: "/users",
  auth: true
});

// 或使用解构
const postConfig = { ...baseConfig, endpoint: "/posts" };
```

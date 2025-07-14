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

## 工厂方法

### 什么是工厂方法

将创建过程封装成一个函数，由入参决定创建什么对象

### 类型

1. 简单工厂：一个全能工厂类负责所有产品的创建，适合类型固定、扩展需求少的场景
2. 工厂：每个具体工厂只负责一种产品的创建，适合类型多变
3. 抽象工厂

### 目的

针对在创建对象前需要执行复杂或大量初始化逻辑情况下，将这部分逻辑+创建对象抽离为一个工厂类，从而对业务逻辑和创建逻辑进行解耦合，可统一管理、方便扩展

### 使用场景

1. 动态组件创建（根据权限、类型或者系统类型渲染不同的UI组件、跨平台UI适配）

```JavaScript
interface ComponentFactory {
  createButton(): React.FC
}

class PrimaryButtonFactory implements ComponentFactory {
  createButton() {
    return () => <button className="primary">Submit</button>;
  }
}

class DisabledButtonFactory implements ComponentFactory {
  createButton() {
    return () => <button disabled>Disabled</button>;
  }
}

const Admin = 1
const useComponentFactory = () => {
  const { userInfo } = useUserStore()
  const isAdmin = userInfo?.flag === Admin ?? false
  
  const btnComp = isAdmin ? new PrimaryButtonFactory() : new DisabledButtonFactory()
  
  return {
    btnComp
  }
}
```

```JavaScript
class ComponentFactory {
  static create(type: string) {
    switch (type) {
      case "button":
        return new PrimaryButton();
      case "input":
        return new DisabledInput();
      default:
        throw new Error("Invalid type");
    }
  }
}
```

2. 不同环境下API封装

```JavaScript
interface ApiClient {
  fetchData(): Promise<any>;
}

class DevApiClient implements ApiClient {
  async fetchData() {
    return fetch("https://dev.api.com/data");
  }
}

class ProdApiClient implements ApiClient {
  async fetchData() {
    return fetch("https://prod.api.com/data");
  }
}

// 工厂方法
function createApiClient(): ApiClient {
  return process.env.NODE_ENV === "development" 
    ? new DevApiClient() 
    : new ProdApiClient();
}
```

3. 数据解析器

```JavaScript
interface DataParser {
  parse(data: string): any;
}

class JsonParser implements DataParser {
  parse(data: string) {
    return JSON.parse(data);
  }
}

class XmlParser implements DataParser {
  parse(data: string) {
    // XML解析逻辑
  }
}

// 工厂方法
function createParser(type: string): DataParser {
  switch (type) {
    case "json": return new JsonParser();
    case "xml": return new XmlParser();
    default: throw new Error("Unsupported format");
  }
}
```

## 生成器模式

### 什么是生成器模式

将多个简单的组件对象按照顺序组装，最终构建成一个复杂的对象

### 目的

把繁琐的构建过程从不同对象中抽离出来，实现使用同一套标准的制造工序产出不同产品

### 抽象实现

```JavaScript
class Director {
  private Builder builder;
  public Process(Build _builder) {
    this.builder = _builder
  }
  
  public building() {
    this.builder.buildBasement()
    // ...
    this.builder.buildWall()
    // ...
    this.builder.buildRoof()
    // ...
    this.builder.done()
  }
}
```

### 使用场景

1. 统一的表格组件流程（都需要条件筛选、表格内容、分页器）

```JavaScript
const TableDirector = ({ builder }: { builder: Builder }) => {
  const [page, setPage] = useState(0)
  const { filterCriteriaNode, filterCriteriaData, searchData, onSearch } = builder.getFilterCriteria({
    updateSearch: setPage
  })
  const { tableBody } = builder.getTableBody({
    tableData: searchData
  })
  const { pagerNode } = builder.getPager({
    page,
    updatePage: (page) => {
      setPage(page)
      onSearch({
        ...filterCriteriaData.current,
        page
      })
    }
  })
  return (
    {filterCriteriaNode}
    {tableBody}
    {pagerNode}
  )
}
```

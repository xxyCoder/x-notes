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

## 门面模式

### 什么是门面模式

将多个子接口封装起来，对外提供统一的高层接口

### 目的

实现一键操作，无需了解子系统细节，且子系统内部修改不影响客户端使用，减少了耦合

### 使用场景

1. 二次封装第三方库

```JavaScript
const request = axios.create({
  baseURL,
})

setCommonRequestInterceptors(request)
setCommonResponseInterceptors(request)

const http = getHttp(request)

export default http
```

2. 操作简化管理

```JavaScript
const login = async () => {
  try {
    await loginReq()
    cookieStorage.set()
    localStorage.set()
  } catch(err) {
  
  }
}
```

## 组合模式

### 什么是组合模式

将对象组合成树形结构以表示整体/部分的层次结构，提取并抽象其相同部分，特殊化其不同的部分，以提高可复用性和可扩展性

### 应用场景

1. UI组件树
```js
// 抽象组件 (Component)  
interface UIComponent {  
  render(): JSX.Element;  
}  

// 叶子节点 (Leaf)  
class Button implements UIComponent {  
  render() { return <button>Click</button>; }  
}  

// 容器节点 (Composite)  
class Modal implements UIComponent {  
  private children: UIComponent[] = [];  

  add(child: UIComponent) {  
    this.children.push(child);  
  }  

  render() {  
    return (  
      <div className="modal">  
        {this.children.map(child => child.render())}  
      </div>  
    );  
  }  
}  

const modal = new Modal();  
modal.add(new Button());  
modal.add(new Button());  
console.log(modal.render()); // 渲染包含两个按钮的弹窗
```
2. 嵌套表单
```js
class FormField implements UIComponent {  
  constructor(private name: string) {}  

  render() {  
    return <input name={this.name} />;  
  }  
}  

class Fieldset implements UIComponent {  
  private fields: UIComponent[] = [];  

  add(field: UIComponent) {  
    this.fields.push(field);  
  }  

  render() {  
    return (  
      <fieldset>  
        {this.fields.map(field => field.render())}  
      </fieldset>  
    );  
  }  
}  

// 构建嵌套表单  
const addressFieldset = new Fieldset();  
addressFieldset.add(new FormField("city"));  
addressFieldset.add(new FormField("zip"));  

const mainForm = new Fieldset();  
mainForm.add(new FormField("name"));  
mainForm.add(addressFieldset); // 嵌套字段集
```
3. 侧边栏菜单
```js
class MenuItem implements UIComponent {  
  constructor(private label: string) {}  

  render() { return <li>{this.label}</li>; }  
}  

class DropdownMenu implements UIComponent {  
  private items: UIComponent[] = [];  

  add(item: UIComponent) {  
    this.items.push(item);  
  }  

  render() {  
    return (  
      <ul>  
        {this.items.map(item => item.render())}  
      </ul>  
    );  
  }  
}  

// 创建多级菜单  
const subMenu = new DropdownMenu();  
subMenu.add(new MenuItem("Settings"));  
subMenu.add(new MenuItem("Logout"));  

const mainMenu = new DropdownMenu();  
mainMenu.add(new MenuItem("Home"));  
mainMenu.add(subMenu); // 嵌套子菜单  
```

## 装饰器模式

### 什么是装饰器模式

在程序运行时通过对原始对象进行包装完成装饰，同时不改变原始对象结构

### 应用场景

1. 高阶组件实现功能等增强
```js
// 基础组件
const Button = () => <button>Click</button>;

// 装饰器（高阶组件）
const withLogging = (WrappedComponent) => {
  return (props) => {
    console.log(`组件被渲染: ${WrappedComponent.name}`);
    return <WrappedComponent {...props} />;
  };
};

const LoggedButton = withLogging(Button);
```

## 适配器模式

当一个对象或类的接口不能匹配用户所期待的接口时，适配器就充当中间转换的角色，以达到兼容用户接口的目的，同时适配器也实现了客户端与接口的解耦，提高了组件的可复用性

### 什么时候使用

1. 集成接口不统一时
2. 升级库版本但是需要保留旧接口兼容性

### 应用场景

1. 第三方库兼容
```js
class LegacyLogger {
  log(message) {
    console.log(`[Legacy] ${message}`);
  }
}

class NewLogger {
  print(msg) {
    console.log(`[New] ${msg}`);
  }
}

class LoggerAdapter {
  constructor(newLogger) {
    this.logger = newLogger;
  }
  
  log(message) {
    this.logger.print(message); 
  }
}

const logger = new LoggerAdapter(new NewLogger());
logger.log("Hello");
```

2. 数据格式转换
```js
// 后端返回的数据（蛇形命名）
const backendData = [
  { user_id: 1, full_name: "Alice" },
  { user_id: 2, full_name: "Bob" }
];

// 前端组件需要驼峰命名
const dataAdapter = (data) => 
  data.map(item => ({
    userId: item.user_id,
    fullName: item.full_name
  }));

const adaptedData = dataAdapter(backendData);
```

3. 统一不同库的接口
```js
// 统一图表配置接口
class ChartAdapter {
  constructor(chartLib) {
    this.lib = chartLib;
  }

  render(data, options) {
    if (this.lib.type === "echarts") {
      this.lib.setOption({ data, ...options }); // ECharts 的配置方式
    } else if (this.lib.type === "d3") {
      this.lib.draw(data, options); // D3 的配置方式
    }
  }
}

const echartsAdapter = new ChartAdapter({ type: "echarts", setOption: echartsInstance.setOption });
echartsAdapter.render(data, { color: "red" });
```

## 享元模式

通过对细粒度对象的复用从而减少内存占用、提升性能

### 核心概念

1. 内部状态：不可变但可共享的部分
2. 外部状态：变化并且不共享的部分，由外部传入
3. 享元工厂：创建并管理对象的工厂，确保一个享元只被创建一次

### 应用场景

1. 大量重复的UI组件（列表、表格和日历）

```JavaScript
class ButtonFactory {
  constructor() {
    this.styles = {};
  }
  getStyle(styleType) {
    if (!this.styles[styleType]) {
      this.styles[styleType] = new ButtonStyle(styleType); // 创建内部状态
    }
    return this.styles[styleType];
  }
}

// 内部状态：按钮样式
class ButtonStyle {
  constructor(type) {
    this.type = type;
    this.className = `btn-${type}`; // 共享的CSS类
  }
  render(text) {
    const btn = document.createElement('button');
    btn.className = this.className;
    btn.textContent = text; // 外部状态由外部传入
    return btn;
  }
}

// 使用
const factory = new ButtonFactory();
const primaryStyle = factory.getStyle('primary'); // 共享样式

// 创建1000个按钮，共享同一个样式对象
const buttons = Array(1000).fill().map((_, i) => {
  return primaryStyle.render(`Button ${i}`); // 外部状态：文本
});
```

2. SVG等资源共享

```JavaScript
const GradientTag: FC<GradientTagProps> = ({...}) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      {...props}
    >
      <defs>
        <linearGradient id={id} x1="100%" x2="0%" y1="50%" y2="50%">
          <stop offset="0%" stopColor={fromColor} />
          <stop offset="100%" stopColor={toColor} />
        </linearGradient>
      </defs>
      <g fill="none" fillRule="evenodd">
        <path fillRule="evenodd" fill={`url(#${id})`} d={pathData} />
        <path
          fill={triangleColor}
          d={`m0 ${mainHeight} h${realTriangleWidth} v${realTriangleHeight}z`}
        />
      </g>
    </svg>
  )
}

export default GradientTag
```

3. 虚拟滚动 （通过dom diff共享对象）

```JavaScript
const VirtualList = ({ items, rowHeight }) => {
  const [scrollTop, setScrollTop] = useState(0);
  const visibleCount = Math.ceil(viewportHeight / rowHeight);
  
  // 计算可见行范围
  const startIdx = Math.floor(scrollTop / rowHeight);
  const endIdx = startIdx + visibleCount;

  return (
    <div onScroll={e => setScrollTop(e.target.scrollTop)}>
      <div style={{ height: `${items.length * rowHeight}px` }}>
        {items.slice(startIdx, endIdx).map(item => (
          // 复用DOM节点（内部状态：行样式）
          <div key={item.id} style={{ height: rowHeight, top: item.index * rowHeight }}>
            {item.text} {/* 外部状态：动态数据 */}
          </div>
        ))}
      </div>
    </div>
  );
};
```

## 桥接模式

将抽象和实现分离，使二者可以各自单独变化而不受到对方约束，使用时再将其组合起来

### 应用场景

1. 跨平台通知

```js
// 实现部分：通知发送器
class Notifier {
  send(message) {
    throw new Error("必须实现 send 方法");
  }
}

// 具体实现：邮件通知
class EmailNotifier extends Notifier {
  send(message) {
    console.log(`发送邮件：${message}`);
    // 实际邮件发送逻辑
  }
}

// 具体实现：短信通知
class SMSNotifier extends Notifier {
  send(message) {
    console.log(`发送短信：${message}`);
    // 实际短信发送逻辑
  }
}

// 抽象部分：通知服务
class NotificationService {
  constructor(notifier) {
    this.notifier = notifier;
  }
  
  dispatch(message) {
    throw new Error("必须实现 dispatch 方法");
  }
}

// 扩展抽象：订单通知
class OrderNotification extends NotificationService {
  dispatch(message) {
    console.log("[订单通知] 准备发送...");
    this.notifier.send(`订单更新：${message}`);
  }
}

const emailService = new OrderNotification(new EmailNotifier());
emailService.dispatch("您的订单已发货"); 

const smsService = new OrderNotification(new SMSNotifier());
smsService.dispatch("包裹已送达");
```

## 模版方法

定义了操作中的算法骨架，而具体实现步骤推迟在子类中实现

### 抽象实现

```JavaScript
// 1. 抽象类定义模板方法和步骤
abstract class AbstractProcessor {
  public process(): void {
    this.stepOne();
    this.stepTwo();
    this.hook(); // 可选钩子
    this.stepThree();
  }

  // 抽象步骤，必须由子类实现
  protected abstract stepOne(): void;
  protected abstract stepTwo(): void;

  // 具体步骤 (可有默认实现)
  protected stepThree(): void {
    console.log("AbstractProcessor: Default stepThree implementation");
  }

  // 钩子方法 (可选覆盖，空实现)
  protected hook(): void {}
}

// 2. 具体子类实现抽象步骤，可选覆盖钩子或具体步骤
class ConcreteProcessorA extends AbstractProcessor {
  protected stepOne(): void {
    console.log("ConcreteProcessorA: Custom stepOne implementation");
  }

  protected stepTwo(): void {
    console.log("ConcreteProcessorA: Custom stepTwo implementation");
  }

  // 覆盖钩子方法
  protected hook(): void {
    console.log("ConcreteProcessorA: Overridden hook");
  }
}

class ConcreteProcessorB extends AbstractProcessor {
  protected stepOne(): void {
    console.log("ConcreteProcessorB: Custom stepOne implementation");
  }

  protected stepTwo(): void {
    console.log("ConcreteProcessorB: Custom stepTwo implementation");
  }

  // 覆盖具体步骤
  protected stepThree(): void {
    console.log("ConcreteProcessorB: Overridden stepThree");
  }
}

// 3. 客户端使用
const processorA = new ConcreteProcessorA();
processorA.process();

const processorB = new ConcreteProcessorB();
processorB.process();
```

### 应用场景

1. 框架或组件生命周期钩子
2. webpack等打包工具构建流程

## 责任链

责任链是由很多责任节点串联起来的一条任务链，允许请求者将责任链视为整体进行请求，不必关系具体流程走向，总之请求可以得到处理

### 应用场景

1. 事件处理（DOM事件冒泡）

```js
document.getElementById("parent").addEventListener("click", (e) => {
  if (e.detail !== 2) {
    e.stopPropagation();
    // ...
  }
});
```

2. 中间件

```js
// Koa中间件示例
app.use(async (ctx, next) => {
  console.log('Middleware 1 start');
  await next(); // 传递给下一个中间件
  console.log('Middleware 1 end');
});

app.use(async (ctx, next) => {
  console.log('Middleware 2 start');
  ctx.body = 'Hello World';
  // 不再调用next()，终止传递
});
```

## 策略模式

定义了一系列算法，并将每个算法封装，使得它们可以相互替换

### 应用场景

1. 支付或者登陆方式的选择

```JavaScript
const useApplePay = () => {}

const useWechatPay = () => {}

const useLinkPay = () => {}

const usePayment = (paymethod) => {
  const { applePay } = useApplePay()
  const { wechatPay } = useWechatPay()
  const { linkPay } = useLinkPay()
  
  const payMethod = () => {
    switch (paymethod) {
     // ...
    }
  }
  
  return { payMethod }
}
```

2. 国际化处理

```JavaScript
// 国际化策略
const i18nStrategies = {
  en: {
    greeting: 'Hello',
    farewell: 'Goodbye'
  },
  zh: {
    greeting: '你好',
    farewell: '再见'
  },
  ja: {
    greeting: 'こんにちは',
    farewell: 'さようなら'
  }
}

class I18n {
  constructor(locale = 'en') {
    this.locale = locale
  }
  
  setLocale(locale) {
    this.locale = locale
  }
  
  t(key) {
    return i18nStrategies[this.locale][key] || key
  }
}

const i18n = new I18n('zh')
console.log(i18n.t('greeting'))
```

### 和工厂模式区别

策略模式重在行为的选择与替换，工厂模式重在对象的创建

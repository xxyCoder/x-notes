## 原型对象

本质就是一个Object，解决了构造函数中重复属性和方法的问题

每个函数都有一个prototype对象（除了箭头函数），该对象会有一个constructor属性指向构造函数本身（这个属性就是一个指针，指向当前构造函数的地址）

## 原型链

本质就是数据结构中的链表，通过[[Prototype]]指针指向下一个原型对象（每个对象都有一个[[Prototype]]指针），由于构造函数都继承自Object函数，所以最终会指向Object.prototype，而Object是顶层函数，故而Object.prototype.__proto__指向null

```Plain
{ constructor: [Function], __proto__ } { constructor: [Object], __proto__ } null
                               |_______↑                            |_______↑
```

## 对象的[[Get]]操作

如果无法在对象本身找到需要的属性，则会继续访问对象的[[Prototype]]

## 属性的设置和屏蔽

如果属性不是直接存在于对象中，[[Prototype]]链就会被遍历，类似[[Get]]操作。如果原型链上找不到属性，属性就会被直接添加到对象上；如果在原型链上找到该属性，还需要考虑以下几种情况：

1. 没有被标记为只读，则在对象上添加新属性，形成屏蔽效果（屏蔽访问原型链上的相关属性）
2. 如果标记为只读，则修改失败，在严格模式下抛出错误（为了模拟类属性的继承）
3. 如果该属性是一个setter，则调用该setter函数

## 类

相当于Function + prototype + [[prototype]]的语法糖

```JavaScript
class Point {
  #ppp = 'ppp'
  #getP() {
    return this.#ppp
  }

  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  static name = "p1";
  static getName() {
    return this.name
  }

  toString() {
    this.#getP()
    return `(${this.x}, ${this.y})`;
  }

  get xxx() {
    return this.x;
  }

  set xxx(value) {
    this.x = value;
  }
}

console.log(Object.getOwnPropertyDescriptors(Point.prototype))
console.log(Object.getOwnPropertyDescriptors(Point))
```

1. 其中原型上的方法均不能枚举

```JSON
{
  constructor: {
    value: [class p1] { name: 'p1' },
    writable: true,
    enumerable: false,
    configurable: true
  },
  toString: {
    value: [Function: toString],
    writable: true,
    enumerable: false,
    configurable: true
  },
  xxx: {
    get: [Function: get xxx],
    set: [Function: set xxx],
    enumerable: false,
    configurable: true
  }
}
```

2. 静态属性和静态方法（不可枚举）挂在类本身

```JSON
{
  length: { value: 2, writable: false, enumerable: false, configurable: true },
  name: { value: 'p1', writable: true, enumerable: true, configurable: true },
  prototype: {
    value: {},
    writable: false,
    enumerable: false,
    configurable: false
  },
  getName: {
    value: [Function: getName],
    writable: true,
    enumerable: false,
    configurable: true
  }
} 
```

3. 私有方法和属性不挂在类或类的原型上，而是在编译时将其提出在类的外层，在调用私有属性或方法的地方进行代码替换，从而实现子类无法继承私有属性或方法

```JavaScript
var _ppp = /*#__PURE__*/ new WeakMap();

constructor() {
  _classPrivateFieldInitSpec(this, _ppp, 'ppp');
}

function _getP() {
  return _classPrivateFieldGet(_ppp, this);
}

toString() {
  _getP.call(this)
}
```

### 类的继承

也就是类的prototype的 [[prototype]] 指向父类的prototype

其中supoer关键字在类实例方法，如果通过super设置属性，则代表this，其余情况都代表父类prototype

super在静态方法，如果通过super设置属性，则代表this，其余情况都代表父类

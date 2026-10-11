以 V8 为例说明普通 JavaScript Array 的底层实现。

## 1. 底层本质、内存视角

### 先区分语言语义和 V8 实现

从 JavaScript 语言语义看，数组是一个特殊对象：

- 有数字下标；
- 有 length 属性；
- 可以动态增加或删除元素；
- 可以保存不同类型的值；
- 可以存在空洞。

从 V8 实现看，数组通常是一个 JSArray 对象，另外连接着一块专门保存数组下标元素的 elements 存储区。

~~~javascript
const a = [1, 2, 3];
~~~

可以用下面这个概念模型理解：

~~~text
变量 a
  │
  ▼
JSArray 对象
  ├── Map：对象布局和 ElementsKind 等信息
  ├── length：3
  ├── elements ──────► 元素存储区
  │                      ├── 1
  │                      ├── 2
  │                      └── 3
  └── properties：额外的命名属性
~~~

这里的 a 保存的是对堆中 JSArray 对象的引用，不是数组内容本身。

~~~javascript
const a = [1, 2, 3];
const b = a;

b[0] = 99;

console.log(a[0]); // 99
~~~

a 和 b 指向同一个数组对象，赋值只复制引用。

### 数组下标元素和普通属性分开存储

~~~javascript
const a = [10, 20, 30];

a[0] = 99;       // 数组下标元素，进入 elements
a.user = "Tom";  // 命名属性，进入 properties
~~~

V8 会把整数下标形式的属性作为 elements 处理，把普通字符串或 Symbol 属性作为 properties 处理。

数组下标通常可以直接映射到 elements 存储区的位置：

~~~text
下标 0 -> elements[0]
下标 1 -> elements[1]
下标 2 -> elements[2]
~~~

普通属性则需要通过对象的属性布局信息来找到位置。V8 使用 Map，也就是通常所说的隐藏类，记录对象当前的结构。

### V8 用 ElementsKind 描述数组的元素布局

JavaScript 语言层面只有一个 number 类型，但 V8 会进一步区分数组元素：

~~~javascript
const a = [1, 2, 3];
~~~

这类数组通常是：

~~~text
PACKED_SMI_ELEMENTS
~~~

其中：

- PACKED 表示元素连续，没有空洞；
- SMI 表示 Small Integer，小整数；
- ELEMENTS 表示这是数组的元素存储类型。

如果数组只保存小整数，V8 可以把整数直接编码在元素槽位中，不需要给每个整数都分配一个独立的堆对象。

### 加入浮点数会改变 ElementsKind

~~~javascript
const a = [1, 2, 3];

a.push(4.5);
~~~

数组会从：

~~~text
PACKED_SMI_ELEMENTS
~~~

转成：

~~~text
PACKED_DOUBLE_ELEMENTS
~~~

V8 可以使用专门的 double 元素存储区，直接保存浮点数。

### 加入字符串或对象会进一步改变 ElementsKind

~~~javascript
const a = [1, 2, 3];

a.push("hello");
a.push({ name: "Tom" });
~~~

这类数组通常会转成：

~~~text
PACKED_ELEMENTS
~~~

此时元素槽位保存的是普通 JavaScript 值。对于字符串和对象，通常表现为指向堆对象的引用。

所以常见的元素类型变化可以简化为：

~~~text
PACKED_SMI_ELEMENTS
        ↓
PACKED_DOUBLE_ELEMENTS
        ↓
PACKED_ELEMENTS
~~~

V8 会根据 ElementsKind 为数组操作选择不同的内部路径，例如 map、reduce、forEach 和下标访问都可能因此使用不同的优化方式。

### PACKED 和 HOLEY

看下面的代码：

~~~javascript
const a = [1, 2, 3];

a[5] = 6;
~~~

结果可以表示成：

~~~text
下标:  0   1   2   3      4      5
值:    1   2   3   空洞   空洞    6
length = 6
~~~

V8 会把它从：

~~~text
PACKED_SMI_ELEMENTS
~~~

转成：

~~~text
HOLEY_SMI_ELEMENTS
~~~

HOLEY 表示元素存储区中存在空洞。

空洞不是一个真正存进去的 undefined，而是 V8 内部用来表示“这个下标没有属性”的特殊标记，通常称为 the_hole。

~~~javascript
const a = [];
a.length = 1;

console.log(a[0]);  // undefined
console.log(0 in a); // false
~~~

如果是显式存入 undefined：

~~~javascript
const a = [];
a[0] = undefined;

console.log(a[0]);  // undefined
console.log(0 in a); // true
~~~

读取结果相同，但两者的属性是否存在不同。

空洞还会影响原型链查找：

~~~javascript
const a = [];
a.length = 1;

Array.prototype[0] = "from prototype";

console.log(a[0]); // "from prototype"
~~~

因为数组本身没有下标 0，V8 还要继续检查原型链。因此，PACKED 数组的访问通常可以做更直接的检查，HOLEY 数组则需要更多判断。

### 有空洞不等于立刻进入字典模式

~~~javascript
const a = [];
a[5] = 1;
~~~

这种数组虽然是 holey，但仍可能使用快速元素存储。

如果数组非常稀疏：

~~~javascript
const a = [];
a[1000000] = 1;
~~~

V8 如果为中间所有位置分配空间，会造成很大浪费。因此，它可能把数组切换到 dictionary elements，用类似字典或哈希表的结构记录实际存在的下标：

~~~text
Dictionary:
1000000 -> 1
~~~

这种方式节省空间，但下标访问和数组方法通常不如连续的 packed elements 快。

### length 不等于实际存储元素数量

~~~javascript
const a = [];
a[100] = "x";

console.log(a.length); // 101
~~~

length 是最大的数组下标加一，而不是实际存储了多少个值。

这个数组实际上只存了一个值，但逻辑长度是 101，中间位置都是空洞。

~~~javascript
const a = [];
a.length = 1000;

console.log(a.length); // 1000
console.log(0 in a);   // false
~~~

### 数组扩容

~~~javascript
const a = [];

a.push(1);
a.push(2);
a.push(3);
~~~

V8 会为数组维护逻辑长度和 elements 的实际容量。

容量足够时，push 可以直接把新值写入已有的元素存储区：

~~~text
elements:
[1][2][3][预留空间...]
~~~

容量不足时，V8 可能会：

1. 申请更大的 elements 存储区；
2. 复制旧元素；
3. 让 JSArray 指向新的 elements；
4. 更新 length。

具体扩容比例属于 V8 实现细节，不是 JavaScript 语言保证。

### V8 中常见的几种数组形态

~~~javascript
const a = [1, 2, 3];
~~~

通常可以理解为：

~~~text
JSArray
  ├── ElementsKind: PACKED_SMI_ELEMENTS
  ├── length: 3
  └── elements: [1, 2, 3]
~~~

~~~javascript
const b = [1.1, 2.2, 3.3];
~~~

通常接近：

~~~text
JSArray
  ├── ElementsKind: PACKED_DOUBLE_ELEMENTS
  ├── length: 3
  └── elements: [1.1, 2.2, 3.3]
~~~

~~~javascript
const c = [];
c[5] = 1;
~~~

通常接近：

~~~text
JSArray
  ├── ElementsKind: HOLEY_SMI_ELEMENTS
  ├── length: 6
  └── elements: [hole, hole, hole, hole, hole, 1]
~~~

~~~javascript
const d = [];
d[1000000] = 1;
~~~

可能接近：

~~~text
JSArray
  ├── dictionary elements
  ├── length: 1000001
  └── dictionary: { 1000000: 1 }
~~~

### 普通 Array 和 TypedArray 不一样

~~~javascript
const a = new Int32Array(3);
~~~

Int32Array 属于 TypedArray。它具有固定长度和明确的元素类型，底层是连续的二进制内存，更适合数值计算、音视频和二进制数据处理。

普通 Array 则更灵活：

~~~javascript
const a = [1, "hello", { name: "Tom" }];
~~~

普通数组的元素布局由 V8 根据内容和使用方式决定，不能把它简单理解成固定类型的 C 数组。

## 2. 基础用法、可调用方法

### 创建数组

~~~javascript
const a = [10, 20, 30];
~~~

创建空数组：

~~~javascript
const a = [];
~~~

使用构造函数时要注意：

~~~javascript
new Array(3);       // 创建长度为 3、但包含 3 个空洞的数组
new Array(1, 2, 3); // 创建 [1, 2, 3]
~~~

### 访问和修改

~~~javascript
const a = [10, 20, 30];

console.log(a[0]);      // 10
console.log(a.at(-1));  // 30
console.log(a.length);  // 3

a[1] = 99;
~~~

访问不存在的位置会得到 undefined：

~~~javascript
console.log(a[10]); // undefined
~~~

### 添加和删除

末尾添加：

~~~javascript
a.push(40);
~~~

删除并返回末尾元素：

~~~javascript
const value = a.pop();
~~~

开头添加：

~~~javascript
a.unshift(5);
~~~

删除并返回开头元素：

~~~javascript
const value = a.shift();
~~~

这些方法会修改原数组。

### splice 和 slice

splice 修改原数组：

~~~javascript
const a = [10, 20, 30, 40];

a.splice(1, 1);
// a 变成 [10, 30, 40]
~~~

在指定位置插入：

~~~javascript
a.splice(1, 0, 20);
// a 变成 [10, 20, 30, 40]
~~~

slice 返回新数组，不修改原数组：

~~~javascript
const a = [10, 20, 30, 40];

const b = a.slice(1, 3);
// b 是 [20, 30]
~~~

### 查询

~~~javascript
a.includes(20); // 是否包含 20
a.indexOf(20);  // 返回第一个匹配下标
~~~

查找元素：

~~~javascript
a.find(x => x > 20);
~~~

查找下标：

~~~javascript
a.findIndex(x => x > 20);
~~~

### 遍历和转换

遍历：

~~~javascript
a.forEach(x => {
  console.log(x);
});
~~~

每个元素转换为新数组：

~~~javascript
const b = a.map(x => x * 2);
~~~

筛选出满足条件的元素：

~~~javascript
const b = a.filter(x => x > 20);
~~~

累计计算：

~~~javascript
const sum = a.reduce((total, x) => total + x, 0);
~~~

判断是否至少有一个满足条件：

~~~javascript
a.some(x => x > 20);
~~~

判断是否全部满足条件：

~~~javascript
a.every(x => x > 0);
~~~

### 合并、连接和展平

合并数组：

~~~javascript
const c = a.concat([50, 60]);
~~~

转成字符串：

~~~javascript
a.join(",");
~~~

展平一层嵌套：

~~~javascript
const a = [[1, 2], [3, 4]];
const b = a.flat();
// [1, 2, 3, 4]
~~~

### 排序和反转

反转原数组：

~~~javascript
a.reverse();
~~~

sort() 会修改原数组。

默认排序会按字符串比较：

~~~javascript
[10, 2, 30].sort();
// 默认不是按数值大小排序
~~~

数字排序应明确提供比较函数：

~~~javascript
const a = [10, 2, 30];

a.sort((x, y) => x - y);
// [2, 10, 30]
~~~

### 一组常用方法的修改行为

会修改原数组的方法：

~~~text
push
pop
shift
unshift
splice
sort
reverse
~~~

通常返回新数组或新结果的方法：

~~~text
slice
concat
map
filter
flat
~~~

forEach 不返回转换后的数组，主要用于执行遍历过程中的操作。

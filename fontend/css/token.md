# Design Token W3C DTCG标准

## 一、为什么需要 Design Token（解决的现实问题）

1. 同一套UI规范，Web、iOS、Android多端需要重复维护样式，修改时多端手动改，容易出现不一致。
2. 代码大量硬编码色号、像素，修改需要到处搜索替换，容易漏改。
3. 裸样式值没有语义，看到`#2563eb`，无法直观知道这个颜色用于什么业务场景。

> 核心思路：把视觉样式抽成一份**平台无关的中立数据源**，不绑定任何一端。修改只改源头，由工具翻译成各个平台可用代码。

## 二、核心概念清晰定义

### 1. Group（分组）

- **定义**：仅用于归类收纳的嵌套层级，等价于文件夹，**Group本身不是Token**。
- 特征：对象内部**没有`$value`字段**，只用来存放子Group或者叶子Token。
- 示例：`colors`、`spacing`，用来把颜色、尺寸类的token归集在一起。
> ⚠️注意：分组名字只是人为约定，就算分组叫`colors`，并不会自动让内部token变成颜色类型。

### 2. Token（叶子令牌对象）

- **定义**：真正存储一条视觉样式信息的对象，**只有包含`$value`的对象才是Token**。
- 标准内置字段（DTCG）
|字段|是否必填|说明|
|---|---|---|
|`$value`|✅必填|真实样式值；可以是原始常量，也可以是token引用字符串|
|`$type`|可选|标记该token的数据种类：`color`/`dimension`/`shadow`，给转换工具识别，做对应平台的输出|
|`$description`|可选|文本备注，描述用途，用于文档生成|
|`$deprecated`|可选|布尔值，标记该token是否废弃|

> 关键区分：
> - Group = 文件夹，用来整理文件；
> - `$type` = 文件的类型标记，写在Token对象内部，描述这份数据是什么种类。

## 三、DTCG标准JSON完整样例（标准交换格式）

```json
{
  "colors": {          // Group分组：文件夹，不是token，无$value
    "brand": {         // 嵌套子Group，依旧不是token
      "500": {         // ✅叶子Token对象，存在$value，是真正的token
        "$type": "color",
        "$value": "#2563eb",
        "$description": "品牌主蓝色"
      },
      "400": {
        "$type": "color",
        "$value": "#3b82f6"
      }
    }
  },
  "spacing": {         // Group分组
    "m": {
      "$type": "dimension",
      "$value": "16px"
    }
  },
  "semantic": {        // Group分组：存放语义token
    "button-primary-bg": {
      "$type": "color",
      "$value": "{colors.brand.500}",
      "$description": "主按钮背景色"
    }
  }
}
```

判定规则：
1. 对象没有`$value` → Group分组，仅收纳；
2. 对象包含`$value` → 叶子Token。

## 四、Token的两种行业分类（最佳实践，规范不强制）

### 1. 基础Token（Primitive原始令牌）

`$value`直接填写原始常量（色号、px）。
只描述“这是什么”，**不带业务场景含义**。
```json
"500": {
  "$type":"color",
  "$value":"#2563eb"
}
```

#### 命名模式

`{色相名}-{档位}`

- 色相：`blue / gray / red / green / purple`；中文体系也可用 `brand‑primary / brand‑secondary`
- 档位：代表明度，**数字越大颜色越深**，两套主流档位体系：

1. **50‑900（Material、Figma 主流）**：`gray‑50`最浅，`gray‑900`最深，间隔 100；`blue‑500`为该色相基准主色。
2. **0‑10（Ant Design）**：`blue‑0`最浅，`blue‑10`最深；`blue‑6`为基准主色Ant Design。

### 2. 语义Token（Semantic别名令牌）

代表业务用途：按钮背景、警告文字、页面底色。
> 最佳实践：`$value`使用token引用，**不复制硬编码原始常量**。
```json
"button-primary-bg": {
  "$type":"color",
  "$value":"{colors.brand.500}"
}
```
> 支持语义套语义：语义token可以引用另一个语义token，不一定直接引用基础token。

#### 命名模式

`{对象}-{变体}-{状态}`

> 
> `分类‑对象/属性‑变体‑交互状态`

- `color`：固定前缀，标识是颜色令牌
- 对象：`text / background / border / icon / surface / action / feedback`
- 变体：`primary / secondary / tertiary / subtle / brand / success / warning / error / info`
- 状态：`default / hover / active / focus / disabled`

## 五、Token引用语法（DTCG标准）

语法：`{group1.group2.tokenName}`
1. 必须填写**完整层级路径**，不能省略group。
    - ✅ `{colors.brand.500}`
    - ❌ `{brand.500}`
2. 使用位置：仅写在token的`$value`字段中。
3. 浏览器原生CSS不识别，**是转换工具解析语法**；工具会把引用替换为目标token真实值。

## 六、通用数据流（与框架无关）

```
DTCG JSON源文件（平台无关token配置）
        ↓转换工具（Style‑Dictionary v4）解析
        ↓处理引用关系、读取$type元信息
输出多端产物：
├─ Web → CSS自定义变量 --xxx
├─ iOS → Swift常量
└─ Android → 资源xml
```
> token源文件不能直接运行，必须经过工具转换。

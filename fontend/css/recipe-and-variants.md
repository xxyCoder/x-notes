## Recipe

**Recipe 是参数化的组件样式规则。**

它集中定义一个组件：

- 固定不变的基础样式
- 允许变化的样式维度
- 各维度的默认选择
- 特定组合下的附加规则
- 复合组件各个 Slot 的样式

基本结构：

```tsx
const buttonRecipe = {
  base: {
    display: "inline-flex",
    alignItems: "center",
  },

  variants: {
    size: {
      sm: { height: "8", px: "3" },
      lg: { height: "12", px: "5" },
    },
    visual: {
      solid: { bg: "brand.500", color: "white" },
      outline: { borderWidth: "1px" },
    },
  },

  defaultVariants: {
    size: "sm",
    visual: "solid",
  },

  compoundVariants: [
    {
      size: "lg",
      visual: "outline",
      css: {
        borderWidth: "2px",
      },
    },
  ],
}
```

Recipe 的作用是：

> 把散落的组件 CSS，变成集中、可复用、可组合、受约束的组件样式规则。

可以把 Recipe 看成一个函数：

```text
Recipe(Variant 选择) -> 最终组件样式
```

---

## Variants

**Variants 是 Recipe 提供的所有可选样式维度集合。**

例如：

```tsx
variants: {
  size: {
    sm: {},
    lg: {},
  },
  visual: {
    solid: {},
    outline: {},
  },
}
```

这里：

```text
variants                  所有样式维度的集合

size、visual              Variant keys，样式维度

sm、lg                    size 的 Variant values

solid、outline            visual 的 Variant values
```

调用组件时，就是在选择这些值：

```tsx
<Button size="lg" visual="outline" />
```

它等价于：

```tsx
buttonRecipe({
  size: "lg",
  visual: "outline",
})
```

Variants 的作用是：

> 明确组件允许哪些变化，并把这些变化限制为稳定、命名清晰的选项。

---

## 两者关系

```text
Recipe
├── 定义组件整体样式规则
├── 包含基础样式
└── 声明 Variants
    ├── size
    │   ├── sm
    │   └── lg
    └── visual
        ├── solid
        └── outline
```

最短定义：

> **Recipe 管组件怎么画；Variants 管组件可以怎么变。**

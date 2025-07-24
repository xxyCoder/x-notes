## 多种组件根据条件展示其一

如果有多个组件但是只能展示其中一个，每个组件需要根据某个条件进行展示，如果满足多个条件则按照优先级展示最高优先级的那个组件
一般来说会这样写，这样写的话条件只会越堆越多，有点麻烦

```js
{opt1 && node1}
{opt2 && !opt1 && node2}
{opt3 && !opt2 && !opt1 && node3}
```

可以将条件改造成数组形式，数组的查询都是从0开始，天生就有优先级的概念（先从0，然后是1...），先返回true的就展示对应下标组件即可
后续有新值条件和组件，可以直接添加就行，非常方便

```js
const conditions = [opt1, opt2, op3]
const componentId = conditions.findIndex(cond => cond)
let id = 0
const componentMap = {
  [id++]: node1,
  [id++]: node2,
  [id++]: node3
}
{componentId >= 0 && componentMap[componentId]}
```

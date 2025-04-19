## 自动版

### 使用defineProperty实现
```js
const observe = (obj) => {
  if (!obj || typeof obj !== "object") return;

  Object.entries(obj).forEach(([key, value]) => {
    let currentValue = value
    observe(currentValue)
    Object.defineProperty(obj, key, {
      set(value) {
        if (value === currentValue) {
          return
        }
        currentValue = value // 赋值为了一个对象，需要重新监听
        observe(currentValue)
        console.log(key, 'set', value)
      },
      get() {
        console.log(key, 'get')
        return currentValue
      }
    })
  });
};
```

### 使用Proxy实现
```js
const observe = (obj) => {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }
  return new Proxy(obj, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver)
      console.log('get')
      return observe(value)
    },
    set(target, key, value, receiver) {
      const oldValue = Reflect.get(target, key, receiver)
      if (oldValue === value) {
        return oldValue
      }
      console.log('set')
      return Reflect.set(target, key, value, receiver)
    }
  })
}
```

## 手动版
```js
const handler = (valueOrFn) => {
  const value = typeof valueOrFn === 'function' ? valueOrFn() : valueOrFn

  const update = (valueOrFn) => {
    const oldValue = update.memoizedState
    const newValue = typeof valueOrFn === 'function' ? valueOrFn(oldValue) : valueOrFn
  
    if (newValue === oldValue) return
    update.memoizedState = newValue
    console.log('update')
  }
  update.memoizedState = value
  return [value, update]
}
```

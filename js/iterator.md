## 迭代器

是一个符合[迭代器协议](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Iteration_protocols#%E8%BF%AD%E4%BB%A3%E5%99%A8%E5%8D%8F%E8%AE%AE)的对象，需要靠闭包维持状态，每次next都是函数调用

```JavaScript
const iterator = () => {
  let idx = 0;
  return {
    next(value) {
      if (value !== undefined) {
        idx = value;
      }
      if (idx > 5) {
        return { done: true };
      }
      return { value: idx++, done: false };
    },
    return() {
      // 当for...of出现错误、提前break或者return时调用
    }
  };
};

// 使用示例
const it = iterator();
console.log(it.next()); // { value: 0, done: false }
console.log(it.next()); // { value: 1, done: false }
console.log(it.next(10)); // { value: 10, done: false }
console.log(it.next()); // { done: true }
```

## 生成器

是一个特殊的函数，并且是Iterator的子类，调用后不执行方法，只会返回一个迭代器对象，每次yield会暂停函数的执行，自动保存函数执行上下文，等待next调用进行恢复，yield的返回值由next决定

整体类似一个状态机

```JavaScript
function* gameStateMachine() {
  let score = 0;
  while (true) {
    const action = yield { score, state: "PLAYING" }; // 暂停，等待外部输入动作
    if (action === "COLLECT_COIN") score += 10;
    else if (action === "HIT_ENEMY") score -= 5;
    else if (action === "GAME_OVER") return { score, state: "END" };
  }
}

const game = gameStateMachine();
console.log(game.next().value); // { score:0, state:"PLAYING" }
console.log(game.next("COLLECT_COIN").value); // { score:10, state:"PLAYING" }
console.log(game.next("HIT_ENEMY").value); // { score:5, state:"PLAYING" }
console.log(game.next("GAME_OVER").value); // { score:5, state:"END" }
```

### throw

可以在函数体外抛出错误，并在函数体内进行catch，如果函数体内没有catch则由外部函数进行捕获

首次调用throw会直接抛在外部函数，因为没有执行过next相当于没有启动过内部函数

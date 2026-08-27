import { DirtyLevel } from "./constant"

export let activeEffect: null | ReactiveEffect = null

function preCleanEffect(effect: ReactiveEffect) {
  // 不清空deps，用于收集依赖的时候进行新旧对比
  effect._depsLength = 0
  ++effect._trackId
}

function postCleanEffect(effect: ReactiveEffect) {
  if (effect.deps.length > effect._depsLength) {
    for (let i = effect._depsLength; i < effect.deps.length; ++i) {
      cleanDepEffect(effect.deps[i], effect)
    }
    effect.deps.length = effect._depsLength
  }
}

export class ReactiveEffect<T = any> {
  private active = true
  _trackId = 0 // 记录effect执行了多少次，相同次数的effect再次记录则说明已经记录过了，不需要再次记录
  deps: ReturnType<typeof createDep>[] = []
  _depsLength = 0;

  _running = 0 // 避免在effect更新依赖

  _dirtyLevel = DirtyLevel.Dirty // computed属性需要，如果是no dirty就不需要再次运行了

  constructor(public fn: () => T, public scheduler: () => void) { }

  get dirty() {
    return this._dirtyLevel === DirtyLevel.Dirty
  }

  set dirty(v: boolean) {
    this._dirtyLevel = v ? DirtyLevel.Dirty : DirtyLevel.NoDirty
  }

  run() {
    this.dirty = false
    if (!this.active) {
      return this.fn()
    }
    // 避免嵌套effect，避免返回上一级的时候丢失activeEffect真正的值
    let lastEffect = activeEffect

    try {
      // 收集依赖，当执行函数的时候（代理依赖会触发get方法），故抛出全局变量让get方法可以访问
      activeEffect = this
      // 清空上次收集的依赖
      preCleanEffect(this)
      this._running++
      return this.fn()
    } finally {
      this._running--
      // 清除多余的旧依赖
      postCleanEffect(this)
      activeEffect = lastEffect
    }
  }

  stop() {
    if (this.active) {
      // 停止依赖收集
      this.active = false
      preCleanEffect(this)
      postCleanEffect(this)
    }
  }
}

export function effect<T = any>(fn: () => T, options?: any) {
  // 当fn中的依赖变化后就重新调用run方法
  const _effect = new ReactiveEffect<T>(fn, () => {
    _effect.run()
  })

  // 默认执行一次
  _effect.run()
  // options里面可以有scheduler选项
  if (options) {
    Object.assign(_effect, options)
  }

  // 外部调用run方法的时候不会丢失this绑定
  return _effect.run.bind(_effect)
}

// Map { object: { attr: Map { effect_1, effect_2, effect_3 } } } 
const depsMap = new Map<object, Map<string | symbol, ReturnType<typeof createDep>>>()

export function createDep(fn: () => void) {
  // fn是清理函数
  const dep = new Map<ReactiveEffect, number>()
  // @ts-ignore
  dep.cleanup = fn
  return dep
}

export function track(target: object, key: string | symbol) {
  if (!activeEffect) { // 说明不是在effect中访问的
    return
  }

  let objDeps = depsMap.get(target)
  if (!objDeps) {
    depsMap.set(target, (objDeps = new Map()))
  }

  let keyDeps = objDeps.get(key)
  if (!keyDeps) {
    objDeps.set(key, (keyDeps = createDep(() => objDeps.delete(key))))
  }

  trackEffect(activeEffect, keyDeps)
}

function cleanDepEffect(dep: Map<ReactiveEffect<any>, number>, effect: ReactiveEffect) {
  dep.delete(effect)
  if (dep.size === 0) {
    // @ts-ignore
    dep.cleanup?.()
  }
}

export function trackEffect(effect: ReactiveEffect, dep: ReturnType<typeof createDep>) {
  if (dep.get(effect) !== effect._trackId) { // 第一次记录该effect
    // 双向记录
    dep.set(effect, effect._trackId)
    const oldDep = effect.deps[effect._depsLength]
    effect.deps[effect._depsLength++] = dep

    if (oldDep !== dep && !!oldDep) {
      cleanDepEffect(oldDep, effect)
    }
  }
}

export function trigger(target: object, key: string | symbol, newValue: any, oldValue: any) {
  const objDeps = depsMap.get(target)
  if (!objDeps) {
    return
  }
  const keyDeps = objDeps.get(key)
  if (!keyDeps) {
    return
  }

  triggerEffect(keyDeps)
}

export function triggerEffect(deps: Map<ReactiveEffect<any>, number>) {
  for (const effect of deps.keys()) {
    if (effect._dirtyLevel < DirtyLevel.Dirty) {
      effect._dirtyLevel = DirtyLevel.Dirty
    }
    if (!effect._running) {
      effect.scheduler?.()
    }
  }
}
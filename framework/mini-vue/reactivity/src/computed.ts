import { isFunction } from "../../shared";
import { createDep, ReactiveEffect } from "./effect";
import { trackRefValue, triggerRefValue } from "./ref";

export function computed(getterOrOptions: Function | { get: Function, set: Function }) {
  let getter: Function
  let setter: Function
  if (isFunction(getterOrOptions)) {
    getter = getterOrOptions
    setter = () => { }
  } else {
    getter = getterOrOptions.get
    setter = getterOrOptions.set
  }
  return new ComputedRefImpl(getter, setter)
}

export class ComputedRefImpl {
  _value: any
  _effect: ReactiveEffect
  dep: ReturnType<typeof createDep> = new Map()

  constructor(public getter: Function, public setter: Function) {
    this._effect = new ReactiveEffect(() => getter(this._value, undefined), () => {
      // 计算属性的依赖更新后触发计算属性收集的effect，让其重新调用.value方法从而更新_value
      triggerRefValue(this)
    })
  }

  get value() {
    if (this._effect.dirty) {
      this._value = this._effect.run()
    }
    trackRefValue(this)
    return this._value
  }

  set value(newValue) {
    this.setter(newValue)
  }
}
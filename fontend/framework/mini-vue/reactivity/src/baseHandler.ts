import { ReactiveFlag } from "./constant"
import { track, trigger } from "./effect"

export const mutableHandler: ProxyHandler<any> = {
  get(target, key, receiver) {
    if (key === ReactiveFlag.IS_REACTIVE) {
      return true
    }
    // 收集effect
    track(target, key)
    return Reflect.get(target, key, receiver)
  },
  set(target, key, newValue, receiver) {
    const oldValue = target[key]

    const returnValue = Reflect.set(target, key, newValue, receiver)
    if (oldValue !== newValue) {
      trigger(target, key, newValue, oldValue)
    }

    return returnValue
  }
}
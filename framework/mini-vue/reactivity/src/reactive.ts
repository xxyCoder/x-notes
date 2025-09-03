import { isObject } from "../../shared";
import { mutableHandler } from "./baseHandler";
import { ReactiveFlag } from "./constant";

export function reactive(target: any) {
  return createReactiveObject(target)
}

// 记录代理后的结果，用于复用
const reactiveMap = new WeakMap()

export function createReactiveObject(target: any) {
  if (!isObject(target)) {
    return target
  }

  // 如果target是被代理的对象，则直接返回
  if (target[ReactiveFlag.IS_REACTIVE]) {
    return target
  }

  // 相同的对象就不需要再次代理了
  const cacheProxy = reactiveMap.get(target)
  if (cacheProxy) {
    return cacheProxy
  }

  const proxy = new Proxy(target, mutableHandler)
  reactiveMap.set(target, proxy)

  return proxy
}

export function toReactive(value: any) {
  return isObject(value) ? reactive(value) : value
}
import { isFunction, isObject } from "../../shared"
import { ReactiveEffect } from "./effect"
import { isReactive } from "./reactive"
import { isRef } from "./ref"

interface WatchOptions {
  immediate?: boolean
  deep?: number
}

export function watch(source: any, cb: Function, options: WatchOptions = {}) {
  return doWatch(source, cb, options)
}

export function watchEffect(getter: Function, options: WatchOptions = {}) {

}

function traverse(source: any, deep = 0, curDeep = 0, seen = new Set()) {
  if (!isObject(source)) {
    return source
  }

  if (curDeep >= deep) {
    return source
  }

  if (seen.has(source)) {
    return source
  }

  for (const key in source) {
    traverse(source[key], deep, curDeep + 1, seen)
  }
  return source
}

function doWatch(source: any, cb?: Function, options: WatchOptions = {}) {

  const reactiveGetter = (source: any, deep = 0) => traverse(source, deep)

  let getter: () => any
  if (isReactive(source)) {
    getter = reactiveGetter(source, options.deep)
  } else if (isRef(source)) {
    getter = () => source.value
  } else if (isFunction(source)) {
    getter = source
  } else {
    return
  }

  let oldValue: any, newValue: any
  const job = () => {
    newValue = effect.run()
    cb?.(newValue, oldValue)
    oldValue = newValue
  }
  const effect = new ReactiveEffect(getter, job)

  if (cb) {
    // watch
    if (options.immediate) {
      job()
    } else {
      oldValue = effect.run()
    }
  } else {
    // watchEffect
    effect.run()
  }
}
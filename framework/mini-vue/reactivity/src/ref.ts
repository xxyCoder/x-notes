import { ComputedRefImpl } from "./computed"
import { activeEffect, createDep, trackEffect, triggerEffect } from "./effect"
import { toReactive } from "./reactive"

export function ref(value: any) {
  return createRef(value)
}

function createRef(value: any) {
  return new RefImpl(value)
}

class RefImpl {
  __v_isRef = true
  _value: any
  dep: ReturnType<typeof createDep> = new Map()

  constructor(public _rawValue: any) {
    this._value = toReactive(_rawValue)
  }
  get value() {
    trackRefValue(this)
    return this._value
  }
  set value(newValue) {
    if (newValue !== this._rawValue) {
      this._rawValue = newValue
      this._value = newValue
      triggerRefValue(this)
    }
  }
}

export function trackRefValue(ref: RefImpl | ComputedRefImpl) {
  if (activeEffect) {
    trackEffect(activeEffect, ref.dep = ref.dep || createDep(() => ref.dep.clear()))
  }
}

export function triggerRefValue(ref: RefImpl | ComputedRefImpl) {
  const dep = ref.dep
  if (dep) {
    triggerEffect(dep)
  }
}
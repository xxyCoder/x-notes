export function isObject(target: any): target is object {
  return typeof target === 'object' && target !== null
}

export function isFunction(target: any): target is Function {
  return typeof target === 'function'
}
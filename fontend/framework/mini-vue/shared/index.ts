export function isObject(target: any): target is object {
	return typeof target === "object" && target !== null
}

export function isFunction(target: any): target is Function {
	return typeof target === "function"
}

export function isString(target: any): target is string {
	return typeof target === "string"
}

export function isUndefined(target: any): target is undefined {
	return typeof target === "undefined"
}

export function hasOwn(target: any, key: string | symbol) {
	return Object.prototype.hasOwnProperty.call(target, key)
}

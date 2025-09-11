import {isObject} from "../shared"

export function patchClass(el: HTMLElement, newValue: any) {
	if (typeof newValue === "string") {
		el.className = newValue
	} else {
		el.removeAttribute("class")
	}
}

export function patchStyle(el: HTMLElement, prevValue: any, newValue: any) {
	const style = el.style
	if (isObject(newValue)) {
		for (const key in newValue) {
			style[key] = newValue[key]
		}
	}

	if (isObject(prevValue)) {
		for (const key in prevValue) {
			if (newValue?.[key] === null) {
				style[key] = null
			}
		}
	}
}

function createInvoker(handler: any) {
	const invoker = () => invoker.value()
	invoker.value = handler

	return invoker
}
export function patchEvent(el: HTMLElement, name: string, handler: any) {
	// @ts-ignore
	const invokers = el._vei || (el_vei = {})
	const eventName = name.slice(2).toLowerCase()

	const exisitingInvoker = invokers[eventName]
	if (exisitingInvoker && handler) {
		// 函数换绑
		exisitingInvoker.value = handler
		return
	}

	if (handler) {
		// 以前没有绑定现在有
		const invoker = (invokers[eventName] = createInvoker(handler))
		el.addEventListener(eventName, invoker)
	}
	if (exisitingInvoker) {
		// 以前有绑定现在没有
		el.removeEventListener(eventName, exisitingInvoker)
		invokers[eventName] = null
	}
}

export function patchAttr(el: HTMLElement, key: string, value: any) {
	if (typeof value !== "string") {
		return
	}
	if (!value) {
		el.removeAttribute(key)
	} else {
		el.setAttribute(key, value)
	}
}

export default function patchProps(
	el: HTMLElement,
	key: string,
	prevValue: any,
	newValue: any
) {
	if (key === "class") {
		patchClass(el, newValue)
	} else if (key === "style") {
		patchStyle(el, prevValue, newValue)
	} else if (/^on[A-Z]/.test(key)) {
		patchEvent(el, key, newValue)
	} else {
		patchAttr(el, key, newValue)
	}
}

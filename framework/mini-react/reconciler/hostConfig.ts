import {Props} from "../shared/ReactTypes"

export function createInstance(type: string, pendingProps: Props) {
	return document.createElement(type)
}

export function createTextInstance(txt: Props["content"]) {
	return document.createTextNode(String(txt))
}

export function appendInitialChild(parent: Element, child: Element) {
	parent.appendChild(child)
}

export const appendChildToContainer = appendInitialChild
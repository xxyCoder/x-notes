import {Props} from "../shared/ReactTypes"
import {DOMElement, updateFiberProps} from "../src/synctheticEvent"
import {FiberNode} from "./fiber"
import {Callback} from "./syncTaskQueue"
import {HostComponent, HostText} from "./workTags"

export function createInstance(type: string, pendingProps: Props) {
	const element = document.createElement(type) as unknown as DOMElement
	updateFiberProps(element, pendingProps)
	return element
}

export function createTextInstance(txt: Props["content"]) {
	return document.createTextNode(String(txt))
}

export function appendInitialChild(parent: Element, child: Element) {
	parent.appendChild(child)
}

export const appendChildToContainer = appendInitialChild

export function insertChildToContainer(
	parent: Element,
	before: Element,
	after: Element
) {
	parent.insertBefore(after, before)
}

export function commitUpdate(fiber: FiberNode) {
	switch (fiber.tag) {
		case HostText:
			const text = fiber.pendingProps.content as string
			commitTextUpdate(fiber.stateNode as Text, text)
			break
		case HostComponent:
			break
	}
}

export function commitTextUpdate(textInstance: Text, content: string) {
	textInstance.textContent = content
}

export function removeChild(child: Element, container: Element) {
	container.removeChild(child)
}

export const scheduleMicroTask =
	typeof queueMicrotask === "function"
		? queueMicrotask
		: typeof Promise === "function"
		? (cb: Callback) => Promise.resolve(null).then(() => cb())
		: setTimeout

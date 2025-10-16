import {Props} from "../shared/ReactTypes"
import {FiberNode} from "./fiber"
import {HostText} from "./workTags"

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

export function commitUpdate(fiber: FiberNode) {
	switch (fiber.tag) {
		case HostText:
			const text = fiber.pendingProps.content as string
			commitTextUpdate(fiber.stateNode as Text, text)
			break
	}
}

export function commitTextUpdate(textInstance: Text, content: string) {
	textInstance.textContent = content
}

export function removeChild(child: Element, container: Element) {
	container.removeChild(child)
}
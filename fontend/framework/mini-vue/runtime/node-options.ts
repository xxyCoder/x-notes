import {VNode} from "./vnode"

export default {
	insert(el: Node, container: Node, anchor?: Node | null) {
		container?.insertBefore(el, anchor || null)
	},
	remove(el: ChildNode) {
		const parent = el?.parentNode
		if (parent) {
			el.remove()
		}
	},
	createElement(type: string) {
		return document.createElement(type)
	},
	createText(text: string) {
		return document.createTextNode(text)
	},
	setElementText(el: Node, text: string) {
		el.textContent = text
	},
	setText(el: Node, text: string) {
		el.nodeValue = text
	},
	parentNode(el: Node) {
		return el.parentNode
	},
	nextSibling(el: Node) {
		return el.nextSibling
	},
}

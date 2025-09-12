export default {
	insert(el: HTMLElement, container: HTMLElement, anchor?: HTMLElement | null) {
		container.insertBefore(el, anchor || null)
	},
	remove(el: HTMLElement) {
		const parent = el.parentNode
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
	setElementText(el: HTMLElement, text: string) {
		el.textContent = text
	},
	setText(el: HTMLElement, text: string) {
		el.nodeValue = text
	},
	parentNode(el: HTMLElement) {
		return el.parentNode
	},
	nextSibling(el: HTMLElement) {
		return el.nextSibling
	},
}

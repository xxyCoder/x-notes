import {isObject} from "../shared"
import {ShapeFlags} from "../shared/shapeFlags"
import nodeOptions from "./node-options"
import patchProps from "./patch-props"

const renderOptions = Object.assign({patchProps}, nodeOptions)

interface VNode {
	type: string
	children: VNode[] | VNode | string
	props: Record<string, number | string | boolean>
	shapeFlag: ShapeFlags
}

function createRenderer(options: typeof renderOptions) {
	const {
		insert: hostInsert,
		remove: hostRemove,
		createElement: hostCreateElement,
		createText: hostCreateText,
		setElementText: hostSetElementText,
		setText: hostSetText,
		parentNode: hostParentNode,
		nextSibling: hostNextSibling,
		patchProps: hostPatchProps,
	} = options

	const mountChildren = (children: VNode[], container: HTMLElement) => {
		for (let i = 0; i < children.length; ++i) {
			patch(null, children[i], container)
		}
	}

	const mountElement = (vnode: VNode, container: HTMLElement) => {
		const {type, children, props, shapeFlag} = vnode
		const el = hostCreateElement(vnode.type)

		if (isObject(props)) {
			for (const key in props) {
				hostPatchProps(el, key, null, props[key])
			}
		}
		if (ShapeFlags.TEXT_CHILDREN & shapeFlag) {
			hostSetElementText(container, children as string)
		} else if (ShapeFlags.ARRAY_CHILDREN & shapeFlag) {
			mountChildren(children as VNode[], el)
		} 

		hostInsert(el, container)
	}

	const patch = (n1: VNode | null, n2: VNode, container: HTMLElement) => {
		if (n1 === n2) {
			return
		}

		if (n1 === null) {
			// mount
			mountElement(n2, container)
		}
	}

	return {
		render(vnode: VNode, container: HTMLElement) {
			// @ts-ignore
			patch(container._vnode || null, vnode, container)
			// @ts-ignore
			container._vnode = vnode
		},
	}
}

export const render = (vnode: VNode, container: HTMLElement) => {
	return createRenderer(renderOptions).render(vnode, container)
}

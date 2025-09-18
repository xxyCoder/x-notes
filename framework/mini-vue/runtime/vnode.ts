import {isObject, isString} from "../shared"
import {ShapeFlags} from "../shared/shapeFlags"
import {Instance} from "./instance"

export const Text = Symbol("Text")
export const Fragment = Symbol("Fragment")

export interface Component {
	data?: () => Record<string, unknown>
	props: Record<string, unknown>
	render: () => VNode
}

export interface VNode {
	__v_isVNode: boolean
	key: string | number
	type: string | symbol | Component
	children?: VNode[] | string | Record<string, unknown>
	props: Record<string, number | string | boolean | symbol>
	shapeFlag: number
	el: Node | null
	component?: Instance
}

export const createVNode = (
	type: string,
	props: Record<string, string | number | boolean | symbol>,
	children?: VNode[] | string
): VNode => {
	let shapeFlag = isString(type)
		? isObject(type)
			? ShapeFlags.STATEFUL_COMPONENT
			: ShapeFlags.ELEMENT
		: 0

	if (children) {
		if (Array.isArray(children)) {
			shapeFlag |= ShapeFlags.ARRAY_CHILDREN
		} else if (isObject(children)) {
			shapeFlag |= ShapeFlags.SLOTS_CHILDREN
		} else {
			shapeFlag |= ShapeFlags.TEXT_CHILDREN
		}
	}

	return {
		__v_isVNode: true,
		key: props.key as string,
		props,
		el: null,
		shapeFlag,
		type,
		children,
	}
}

export const isVNode = (target: any): target is VNode => {
	return target?.__v_isVNode || false
}

export const isSameVNode = (n1: VNode, n2: VNode) => {
	return n1.type === n2.type && n1.key === n2.key
}

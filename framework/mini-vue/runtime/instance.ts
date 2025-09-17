import {reactive} from "../reactivity/src/reactive"
import {hasOwn, isObject} from "../shared"
import {VNode} from "./vnode"

export interface Instance {
	state: any
	vnode: VNode
	subTree: VNode | null
	updateFn?: (() => void) | null
	attrs: Record<string | symbol, unknown>
	props: Record<string | symbol, unknown>
	propOptions: Record<string, unknown>
	isMounted: boolean
	proxy: null | Instance
}

const publicProperty = {
	atts: (instance: Instance) => instance.attrs,
}

export function createInstance({
	state,
	vnode,
	propOptions,
}: {
	state: any
	vnode: VNode
	propOptions: Record<string, unknown>
}) {
	const instance: Instance = {
		state,
		vnode,
		subTree: null,
		isMounted: false,
		updateFn: null,
		props: {},
		attrs: {},
		propOptions,
		proxy: null,
	}

	instance.proxy = new Proxy(instance, {
		get(target, key) {
			const {state, props} = target
			if (isObject(state) && hasOwn(state, key)) {
				return state[key]
			} else if (isObject(props) && hasOwn(props, key)) {
				return state[key]
			}
			const getter = publicProperty[key]
			return getter?.(target)
		},
		set(target, key, newValue) {
			const {state, props} = target
			if (isObject(state) && hasOwn(state, key)) {
				state[key] = newValue
			} else if (isObject(props) && hasOwn(props, key)) {
				console.warn("prop不能更改")
				return false
			}
			return true
		},
	})

	return instance
}

export function initProps(instance: Instance, rawProps: VNode["props"]) {
	const props: Record<string, unknown> = {}
	const attrs: Record<string, unknown> = {}
	const propOptions = instance.propOptions

	if (isObject(propOptions) && isObject(rawProps)) {
		for (const key in rawProps) {
			if (key in propOptions) {
				props[key] = reactive(rawProps[key])
			} else {
				attrs[key] = rawProps[key]
			}
		}
	}
	instance.attrs = attrs
	instance.props = props
}

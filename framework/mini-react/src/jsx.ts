import {REACT_ELEMENT_TYPE} from "../shared/ReactSymbols.ts"
import {Key, Props, ReactElementType, Ref, Type} from "../shared/ReactTypes.ts"

/**
 * jsx函数经过babel编译转化为对象，描述了一个dom节点
 * 后续就可以在js中对该dom对象进行创建或对比更新真实dom
 * @param type 既可以是 f App()也可以是element字符串
 */
const ReactElement = (type: Type, key: Key, ref: Ref, props: Props) => {
	const element: ReactElementType = {
		$$typeof: REACT_ELEMENT_TYPE,
		type,
		key,
		ref,
		props,
	}

	return element
}

/**
 * jsx允许将html写在js代码中（声明式编程）
 */
export const jsx = (type: Type, config: any, ...maybeChildrens: any[]) => {
	let key: Key = null
	let ref: Ref = null
	const props: Props = {}

	if (typeof config === "object" && config !== null) {
		for (const prop in config) {
			const value = config[prop]
			if (prop === "key") {
				key = "" + value
			} else if (prop === "ref") {
				ref = value
			} else if (Object.prototype.hasOwnProperty.call(config, prop)) {
				props[prop] = value
			}
		}
	}

	const length = maybeChildrens?.length || 0
	if (length === 1) {
		props.children = maybeChildrens[0]
	} else if (length > 0) {
		props.children = maybeChildrens
	}
	return ReactElement(type, key, ref, props)
}

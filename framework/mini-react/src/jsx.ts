import {REACT_ELEMENT_TYPE} from "../shared/ReactSymbols.ts"
import {Key, Props, ReactElementType, Ref, Type} from "../shared/ReactTypes.ts"

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

export const jsx = (type: Type, config: any, ...maybeChildrens: any[]) => {
	let key: Key = null
	let ref: Ref = null
	const props: Props = {}

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

	const length = maybeChildrens?.length || 0
	if (length === 1) {
		props.children = maybeChildrens[0]
	} else if (length > 0) {
		props.children = maybeChildrens
	}
	return ReactElement(type, key, ref, props)
}

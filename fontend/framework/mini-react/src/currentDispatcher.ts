import {Action} from "../shared/ReactTypes"

export type Dispatch<State> = (action: Action<State>) => void

export interface Dispatcher {
	useState: <T>(initialState: T | (() => T)) => [T, Dispatch<T>]
	useEffect: (callback: () => void, deps?: any[]) => void
	useRef: <T>(initialValue: T) => {current: T}
}

export const currentDispatcher: {current: Dispatcher | null} = {
	current: null,
}

export function resolveDispatcher() {
	const dispatcher = currentDispatcher.current

	if (dispatcher === null) {
		throw new Error("不在函数组件中使用")
	}
	return dispatcher
}

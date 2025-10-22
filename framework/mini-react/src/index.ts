import {
	currentDispatcher,
	Dispatcher,
	resolveDispatcher,
} from "./currentDispatcher"

export const useState: Dispatcher["useState"] = (initialState) => {
	const dispatcher = resolveDispatcher()
	return dispatcher.useState(initialState)
}

export const useEffect: Dispatcher["useEffect"] = (create, deps) => {
	const dispatcher = resolveDispatcher()
	return dispatcher.useEffect(create, deps)
}

export const INTERNAL_SHARED_DATA = {
	currentDispatcher,
}

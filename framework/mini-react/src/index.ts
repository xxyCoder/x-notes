import {
	currentDispatcher,
	Dispatcher,
	resolveDispatcher,
} from "./currentDispatcher"

export const useState: Dispatcher["useState"] = (initialState) => {
	const dispatcher = resolveDispatcher()
	return dispatcher.useState(initialState)
}

export const INTERNAL_SHARED_DATA = {
	currentDispatcher,
}

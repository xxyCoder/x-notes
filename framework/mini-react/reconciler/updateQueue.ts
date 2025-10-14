import {Action} from "../shared/ReactTypes"
import {Dispatch} from "../src/currentDispatcher"

// 表示一个更新操作，要么给一个更新值，要么给一个更新函数（需要传递旧值，返回新值）
export interface Update<State> {
	action: Action<State>
	next: Update<State> | null
}

export const createUpdate = <State>(action: Action<State>): Update<State> => {
	return {
		action,
		next: null,
	}
}

/**
 * updateQueue
 * 	shared.pending
 * 		update
 * 		update
 * 		update
 * 		...
 */
export interface UpdateQueue<State> {
	shared: {
		pending: Update<State> | null
	}
	dispatch: Dispatch<State> | null
}

export const createUpdateQueue = <State>(): UpdateQueue<State> => {
	return {
		shared: {
			pending: null,
		},
		dispatch: null,
	}
}

export const enqueueUpdate = <State>(
	updateQueue: UpdateQueue<State>,
	update: Update<State>
) => {
	update.next = updateQueue.shared.pending
	updateQueue.shared.pending = update
}

// 根据初始状态 + 更新函数进行更新
export const processUpdateQueue = <State>(
	baseState: State,
	updateQueue: UpdateQueue<State> | null
) => {
	const pending = updateQueue?.shared?.pending || null

	if (pending === null) {
		return {
			memoizedState: baseState,
		}
	}

	let first = pending
	while (first.next !== pending && first.next !== null) {
		first = first.next
	}

	let current = first
	let newState = baseState

	do {
		const action = current.action
		if (action instanceof Function) {
			newState = action(newState) // 使用前一个state作为参数
		} else {
			newState = action // 直接使用新值
		}
		current = current.next!
	} while (current !== pending.next && current !== null) // 遍历整个环形链表

	return {
		memoizedState: newState,
	}
}

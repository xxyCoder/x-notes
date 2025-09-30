/**
 * updateQueue
 * 	shared.pending
 * 		update
 * 		update
 * 		...
 */

import {Action} from "../shared/ReactTypes"

export interface Update<State> {
	action: Action<State>
}

export const createUpdate = <State>(state: State): Update<State> => {
	return {
		action: state,
	}
}

export interface UpdateQueue<State> {
	shared: {
		pending: Update<State> | null
	}
}

export const createUpdateQueue = <State>(): UpdateQueue<State> => {
	return {
		shared: {
			pending: null,
		},
	}
}

export const enqueueUpdate = <State>(
	updateQueue: UpdateQueue<State>,
	update: Update<State>
) => {
	updateQueue.shared.pending = update
}

// 根据初始状态 + 更新函数进行更新
export const processUpdate = <State>(
	baseState: State,
	pendingUpdate: Update<State> | null
) => {
	const finalState = {
		memoizedState: baseState,
	}
	if (pendingUpdate !== null) {
		const action = pendingUpdate.action
		if (action instanceof Function) {
			finalState.memoizedState = action(baseState)
		} else {
			finalState.memoizedState = baseState
		}
	}

	return finalState
}

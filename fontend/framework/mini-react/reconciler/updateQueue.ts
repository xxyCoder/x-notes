import {Action} from "../shared/ReactTypes"
import {Dispatch} from "../src/currentDispatcher"
import {Lane, Lanes} from "./fiberLanes"

/**
 * action 表示一个更新操作，要么给一个更新值，要么给一个更新函数（需要传递旧值，返回新值）
 * lanes 表示优先级
 */
export interface Update<State> {
	action: Action<State>
	lanes: Lanes
	next: Update<any> | null
}

export const createUpdate = <State>(
	action: Action<State>,
	lanes: Lanes
): Update<State> => {
	return {
		action,
		lanes,
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
	const pending = updateQueue.shared.pending
	if (pending === null) {
		// 指向自己形成环状链表
		update.next = update
	} else {
		// abc => c -> a -> b -> c
		update.next = pending.next
		pending.next = update
	}
	// pending始终指向最后插入的update，那么pending.next指向的就是第一个update
	updateQueue.shared.pending = update
}

// 根据初始状态 + 更新函数进行更新
export const processUpdateQueue = <State>(
	baseState: State,
	pendingUpdate: Update<State> | null,
	renderLane: Lane
) => {
	let newState = baseState

	if (pendingUpdate !== null) {
		const first = pendingUpdate.next
		let pending = pendingUpdate.next
		do {
			const lanes = pending!.lanes
			if (lanes === renderLane) {
				const action = pending!.action
				if (action instanceof Function) {
					newState = action(newState) // 使用前一个state作为参数
				} else {
					newState = action // 直接使用新值
				}
			}
			pending = pending!.next
		} while (pending !== first) // 遍历整个环形链表
	}

	return {
		memoizedState: newState,
	}
}

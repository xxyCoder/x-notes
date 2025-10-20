import internals from "../shared/internals"
import {Action, TypeFunc} from "../shared/ReactTypes"
import {Dispatcher, Dispatch} from "../src/currentDispatcher"
import {FiberNode} from "./fiber"
import { requestUpdateLanes } from "./fiberLanes"
import {
	createUpdate,
	createUpdateQueue,
	enqueueUpdate,
	processUpdateQueue,
	UpdateQueue,
} from "./updateQueue"
import {scheduleUpdateOnFiber} from "./workLoop"

let currentlyRenderingFiber: FiberNode | null = null
let workInProgressHook: Hook | null = null
let currentHook: Hook | null = null

const {currentDispatcher} = internals

interface Hook {
	memoizedState: any
	updateQueue: unknown
	next: Hook | null
}

export function renderWithHooks(fiber: FiberNode) {
	currentlyRenderingFiber = fiber
	fiber.memoizedState = null

	const current = fiber.alternate
	if (current !== null) {
		// update
		currentDispatcher.current = HookDispatcherOnUpdate
	} else {
		// mount
		currentDispatcher.current = HookDispatcherOnMount
	}

	// 函数存储在react element的type中，也就是fiber的type
	const Component = fiber.type as TypeFunc
	const props = fiber.pendingProps
	const child = Component(props)

	currentlyRenderingFiber = null
	return child
}

function mountState<T>(initialState: T | (() => T)): [T, Dispatch<T>] {
	const hook = mountWorkInProgressHook()
	const memoizedState =
		initialState instanceof Function ? initialState() : initialState
	hook.memoizedState = memoizedState

	const queue = createUpdateQueue()
	hook.updateQueue = queue

	const dispatch = dispatchSetState.bind(null, currentlyRenderingFiber, queue)
	queue.dispatch = dispatch

	return [memoizedState, dispatch]
}

function mountWorkInProgressHook() {
	const hook: Hook = {
		memoizedState: null,
		updateQueue: null,
		next: null,
	}

	if (workInProgressHook === null) {
		// 说明是第一个hook
		if (currentlyRenderingFiber === null) {
			throw new Error("没有在函数中调用hook")
		}
		workInProgressHook = hook
		currentlyRenderingFiber.memoizedState = workInProgressHook
	} else {
		// 后续hook
		workInProgressHook.next = hook
		workInProgressHook = hook
	}

	return hook
}

const HookDispatcherOnMount: Dispatcher = {
	useState: mountState,
}

function updateState<T>(): [T, Dispatch<T>] {
	const hook = updateWorkInProgress()
	const updateQueue = hook.updateQueue as UpdateQueue<T>
	const {memoizedState} = processUpdateQueue(hook.memoizedState, updateQueue)
	hook.memoizedState = memoizedState

	return [memoizedState, updateQueue.dispatch!]
}

function updateWorkInProgress() {
	let hook: Hook | null = null
	if (currentHook === null) {
		// 说明是第一个hook
		const current = currentlyRenderingFiber?.alternate
		hook = current?.memoizedState ?? null
	} else {
		// 后续hook
		hook = currentHook.next
	}

	if (hook === null) {
		// mount/update u1 u2 u3 null
		// update       u1 u2 u3 u4
		throw new Error("hook 必须在函数顶层调用")
	}
	currentHook = hook
	const newHook: Hook = {
		memoizedState: hook.memoizedState,
		updateQueue: hook.updateQueue,
		next: null,
	}

	if (workInProgressHook === null) {
		// 说明是第一个hook
		if (currentlyRenderingFiber === null) {
			throw new Error("没有在函数中调用hook")
		}
		workInProgressHook = newHook
		currentlyRenderingFiber.memoizedState = workInProgressHook
	} else {
		// 后续hook
		workInProgressHook.next = newHook
		workInProgressHook = newHook
	}
	return newHook
}

const HookDispatcherOnUpdate: Dispatcher = {
	useState: updateState,
}

function dispatchSetState<State>(
	fiber: FiberNode,
	updateQueue: UpdateQueue<State>,
	action: Action<State>
) {
	const lanes = requestUpdateLanes()
	const update = createUpdate(action, lanes)
	enqueueUpdate<State>(updateQueue, update)
	scheduleUpdateOnFiber(fiber, lanes)
}

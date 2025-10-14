import internals from "../shared/internals"
import {Action, TypeFunc} from "../shared/ReactTypes"
import {Dispatcher, Dispatch} from "../src/currentDispatcher"
import {FiberNode} from "./fiber"
import {
	createUpdate,
	createUpdateQueue,
	enqueueUpdate,
	UpdateQueue,
} from "./updateQueue"
import {scheduleUpdateOnFiber} from "./workLoop"

let currentlyRenderingFiber: FiberNode | null = null
let workInProgressHook: Hook | null = null

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
	} else {
		// mount
		currentDispatcher.current = HookDispatcherOnMount
	}

	const Component = fiber.type as TypeFunc
	const props = fiber.pendingProps
	const child = Component(props)

	currentlyRenderingFiber = null
	return child
}

const HookDispatcherOnMount: Dispatcher = {
	useState: mountState,
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

function dispatchSetState<State>(
	fiber: FiberNode,
	updateQueue: UpdateQueue<State>,
	action: Action<State>
) {
	const update = createUpdate(action)
	enqueueUpdate<State>(updateQueue, update)
	scheduleUpdateOnFiber(fiber)
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

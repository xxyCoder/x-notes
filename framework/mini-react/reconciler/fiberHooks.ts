import internals from "../shared/internals"
import {Action, TypeFunc} from "../shared/ReactTypes"
import {Dispatcher, Dispatch} from "../src/currentDispatcher"
import {FiberNode} from "./fiber"
import {Flags, PassiveEffect} from "./fiberFlags"
import {Lane, NoLane, requestUpdateLanes} from "./fiberLanes"
import {HookHasEffect} from "./hookEffectTags"
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
let currentRenderLane: Lane = NoLane

const {currentDispatcher} = internals

interface Hook {
	memoizedState: any
	updateQueue: unknown
	next: Hook | null
}

type EffectCallback = (() => void) | void
type EffectDeps = any[] | null

export interface Effect {
	tag: Flags
	create: EffectCallback
	destroy: EffectCallback
	deps?: EffectDeps
	next: Effect | null // 将effect形成一个链表，避免遍历外层memoizedState形成的所有hook链表
}

export interface FCUpdateQueue<State> extends UpdateQueue<State> {
	lastEffect: Effect | null
}

export function renderWithHooks(fiber: FiberNode, renderLane: Lane) {
	currentlyRenderingFiber = fiber
	fiber.memoizedState = null
	fiber.updateQueue = null
	currentRenderLane = renderLane

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
	currentRenderLane = NoLane
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

function mountEffect(create: EffectCallback, deps?: EffectDeps) {
	const hook = mountWorkInProgressHook()
	const nextDeps = deps ?? null
	if (!currentlyRenderingFiber) {
		throw new Error("")
	}
	// mount阶段所有effect必然都要执行一次
	currentlyRenderingFiber.flags |= PassiveEffect

	hook.memoizedState = pushEffect(
		PassiveEffect | HookHasEffect,
		create,
		void 0,
		deps
	)

	const queue = createUpdateQueue()
	hook.updateQueue = queue

	const dispatch = dispatchSetState.bind(null, currentlyRenderingFiber, queue)
	queue.dispatch = dispatch
}

function pushEffect(
	hookFlags: Flags,
	create: EffectCallback,
	destroy: EffectCallback,
	deps?: EffectDeps
) {
	const effect: Effect = {
		create,
		deps,
		destroy,
		tag: hookFlags,
		next: null,
	}
	const fiber = currentlyRenderingFiber!
	const updateQueue = fiber.updateQueue as FCUpdateQueue<any>
	if (updateQueue === null) {
		const updateQueue = createFCComponentUpdateQueue()
		effect.next = effect
		updateQueue.lastEffect = effect
		fiber.updateQueue = updateQueue
	} else {
		const lastEffect = updateQueue.lastEffect
		if (lastEffect === null) {
			effect.next = effect
		} else {
			const firstEffect = lastEffect.next
			lastEffect.next = effect
			effect.next = firstEffect
			updateQueue.lastEffect = effect
		}
	}

	return effect
}

function createFCComponentUpdateQueue<State>() {
	const updateQueue = createUpdateQueue<State>() as FCUpdateQueue<State>
	updateQueue.lastEffect = null

	return updateQueue
}

const HookDispatcherOnMount: Dispatcher = {
	useState: mountState,
	useEffect: mountEffect,
}

function updateState<T>(): [T, Dispatch<T>] {
	const hook = updateWorkInProgress()
	const updateQueue = hook.updateQueue as UpdateQueue<T>
	const {memoizedState} = processUpdateQueue(
		hook.memoizedState,
		updateQueue.shared.pending,
		currentRenderLane
	)
	hook.memoizedState = memoizedState
	updateQueue.shared.pending = null

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
	useEffect: () => {},
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

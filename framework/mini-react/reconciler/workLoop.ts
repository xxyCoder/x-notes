import {Props} from "../shared/ReactTypes"
import beginWork from "./beginWork"
import {
	commitHookEffectListCreate,
	commitHookEffectListDestroy,
	commitHookEffectListUnmount,
	commitLayoutEffects,
	commitMutationEffects,
} from "./commitWork"
import completeWork from "./completeWork"
import {FiberNode, FiberRootNode, PendingPassiveEffects} from "./fiber"
import {MutationMask, NoFlags, PassiveEffect, PassiveMask} from "./fiberFlags"
import {
	getHighestPriorityLane,
	Lane,
	Lanes,
	markRootFinished,
	mergeLanes,
	NoLane,
	SyncLane,
} from "./fiberLanes"
import {HookHasEffect} from "./hookEffectTags"
import {scheduleMicroTask} from "./hostConfig"
import {flushSyncCallbacks, scheduleSyncCallback} from "./syncTaskQueue"
import {HostRoot} from "./workTags"

let workInProgress: FiberNode | null = null
let workInProgressRootRenderLane: Lane = NoLane
let rootDoesHasPassiveEffects: boolean = false

// 更新的触发可以从fiber树中任意一个fiber node开始
export function scheduleUpdateOnFiber(fiber: FiberNode, lanes: Lane) {
	const root = markUpdateFromFiberToRoot(fiber)
	markRootUpdated(root, lanes)

	ensureRootIsScheduled(root)
}

function markUpdateFromFiberToRoot(fiber: FiberNode) {
	let node = fiber
	let parent = fiber.return

	while (parent !== null) {
		node = parent
		parent = parent.return
	}
	if (node.tag === HostRoot) {
		// fiber root node
		return node.stateNode
	}
	return null
}

function markRootUpdated(root: FiberRootNode, lanes: Lanes) {
	root.pendingLanes = mergeLanes(root.pendingLanes, lanes)
}

// 调度阶段：选中高优先级更新然后进入render阶段、commit阶段，重复这一过程直到为NoLane
function ensureRootIsScheduled(root: FiberRootNode) {
	// 获取优先级
	const updateLane = getHighestPriorityLane(root.pendingLanes)
	if (updateLane === NoLane) {
		// 没有更新
		return
	}
	if (updateLane === SyncLane) {
		// 同步优先级，使用微任务调度
		scheduleSyncCallback(performSyncWorkOnRoot.bind(null, root, updateLane))
		scheduleMicroTask(flushSyncCallbacks)
	} else {
		// 使用宏任务调度
	}
}

function performSyncWorkOnRoot(root: FiberRootNode, lane: Lane) {
	const nextLane = getHighestPriorityLane(root.pendingLanes)
	// 多个SyncLane更新放入队列等待执行，执行完第一个后（会将当前Lane删除）就没必要执行后续相同优先级的更新了
	if (nextLane !== SyncLane) {
		ensureRootIsScheduled(root)
		return
	}
	prepareFreshStack(root, lane)
	do {
		try {
			workLoop()
			break
		} catch (err) {
			workInProgress = null
		}
	} while (true)
	const finishedWork = root.current.alternate
	root.finishedWork = finishedWork
	root.finishedLanes = mergeLanes(
		root.finishedLanes,
		workInProgressRootRenderLane
	)
	workInProgressRootRenderLane = NoLane

	commitRoot(root)
}

function commitRoot(root: FiberRootNode) {
	const finishedWork = root.finishedWork
	if (finishedWork === null) {
		return
	}
	const lane = root.finishedLanes
	root.finishedWork = null
	root.finishedLanes = NoLane
	markRootFinished(root, lane)

	if (
		(finishedWork.flags & PassiveMask) !== NoFlags ||
		(finishedWork.subFlags & PassiveMask) !== NoFlags
	) {
		if (!rootDoesHasPassiveEffects) {
			rootDoesHasPassiveEffects = true
			// 使用调度器调度副作用
			flushPassiveEffect(root.pendingPassiveEffects)
		}
	}

	const subTreeHasFlags =
		(finishedWork.subFlags & (MutationMask | PassiveMask)) !== NoFlags
	const rootHasFlags =
		(finishedWork.flags & (MutationMask | PassiveEffect)) !== NoFlags

	if (subTreeHasFlags || rootHasFlags) {
		// beforeMutation
		// mutation
		commitMutationEffects(finishedWork, root)
		root.current = finishedWork // fiber树切换
		commitLayoutEffects(finishedWork, root)
	} else {
		root.current = finishedWork
	}
	rootDoesHasPassiveEffects = false
	ensureRootIsScheduled(root)
}

function prepareFreshStack(fiber: FiberRootNode, lane: Lane) {
	// 拿到的是host fiber，也就是说workInProgress最开始被赋值为host fiber（fiber的起点）
	workInProgress = createWorkInProgress(fiber.current, {})
	workInProgressRootRenderLane = lane
}

function flushPassiveEffect(pendingPassiveEffects: PendingPassiveEffects) {
	pendingPassiveEffects.unmount.forEach((effect) => {
		commitHookEffectListUnmount(PassiveEffect, effect)
	})
	pendingPassiveEffects.unmount = []

	pendingPassiveEffects.update.forEach((effect) => {
		commitHookEffectListDestroy(PassiveEffect | HookHasEffect, effect)
	})
	pendingPassiveEffects.update.forEach((effect) => {
		commitHookEffectListCreate(PassiveEffect | HookHasEffect, effect)
	})
	pendingPassiveEffects.update = []
	flushPassiveEffect(pendingPassiveEffects) // 在useEffect中更新
}

function workLoop() {
	while (workInProgress !== null) {
		performUnitOfWork(workInProgress)
	}
}

function performUnitOfWork(fiber: FiberNode) {
	const next = beginWork(fiber, workInProgressRootRenderLane)
	fiber.memoizedProps = fiber.pendingProps

	if (next === null) {
		completeUnitOfWork(fiber)
	} else {
		workInProgress = next
	}
}

function completeUnitOfWork(fiber: FiberNode) {
	let node: FiberNode | null = fiber
	do {
		completeWork(node)
		// 寻找下一个子节点
		const sibling = node.sibling
		if (sibling !== null) {
			workInProgress = sibling
			return
		}
		node = node.return
		workInProgress = node
	} while (node !== null)
}

export function createWorkInProgress(current: FiberNode, pendingProps: Props) {
	let wip = current.alternate

	if (wip === null) {
		wip = new FiberNode(current.tag, pendingProps, current.key)
		wip.stateNode = current.stateNode
		wip.alternate = current
		current.alternate = wip
	} else {
		wip.pendingProps = pendingProps
		wip.flags = NoFlags
		wip.subFlags = NoFlags
	}

	wip.type = current.type
	wip.updateQueue = current.updateQueue
	wip.child = current.child
	wip.memoizedProps = current.memoizedProps
	wip.memoizedState = current.memoizedState
	wip.ref = current.ref

	return wip
}

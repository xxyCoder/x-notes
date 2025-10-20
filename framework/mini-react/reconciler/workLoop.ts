import {Props} from "../shared/ReactTypes"
import beginWork from "./beginWork"
import {commitMutationEffects} from "./commitWork"
import completeWork from "./completeWork"
import {FiberNode, FiberRootNode} from "./fiber"
import {MutationMask, NoFlags} from "./fiberFlags"
import {
	getHighestPriorityLane,
	Lane,
	Lanes,
	mergeLanes,
	NoLane,
	SyncLane,
} from "./fiberLanes"
import {scheduleMicroTask} from "./hostConfig"
import {flushSyncCallbacks, scheduleSyncCallback} from "./syncTaskQueue"
import {HostRoot} from "./workTags"

let workInProgress: FiberNode | null = null

// 更新的触发可以从fiber树中任意一个fiber node开始
export function scheduleUpdateOnFiber(fiber: FiberNode, lanes: Lane) {
	const root = markUpdateFromFiberToRoot(fiber)
	markRootUpdated(root, lanes)

	// renderRoot(root)
	ensureRootIsScheduled(root)
}

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

function markRootUpdated(root: FiberRootNode, lanes: Lanes) {
	root.pendingLanes = mergeLanes(root.pendingLanes, lanes)
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

function prepareFreshStack(fiber: FiberRootNode) {
	// 拿到的是host fiber，也就是说workInProgress最开始被赋值为host fiber（fiber的起点）
	workInProgress = createWorkInProgress(fiber.current, {})
}

function performSyncWorkOnRoot(root: FiberRootNode, lane: Lane) {
	const nextLane = getHighestPriorityLane(root.pendingLanes)
	if (nextLane !== SyncLane) {
		ensureRootIsScheduled(root)
		return
	}
	prepareFreshStack(root)
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

	commitRoot(root)
}

function commitRoot(root: FiberRootNode) {
	const finishedWork = root.finishedWork
	if (finishedWork === null) {
		return
	}
	root.finishedWork = null

	const subTreeHasFlags = (finishedWork.subFlags & MutationMask) !== NoFlags
	const rootHasFlags = (finishedWork.flags & MutationMask) !== NoFlags
	if (subTreeHasFlags || rootHasFlags) {
		// beforeMutation
		// mutation
		commitMutationEffects(finishedWork)
		root.current = finishedWork
		// layout
	} else {
		root.current = finishedWork
	}
}

function workLoop() {
	while (workInProgress !== null) {
		performUnitOfWork(workInProgress)
	}
}

function performUnitOfWork(fiber: FiberNode) {
	const next = beginWork(fiber)
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

	return wip
}

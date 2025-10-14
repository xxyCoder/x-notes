import {Props} from "../shared/ReactTypes"
import beginWork from "./beginWork"
import { commitMutationEffects } from "./commitWork"
import completeWork from "./completeWork"
import {FiberNode, FiberRootNode} from "./fiber"
import {MutationMask, NoFlags} from "./fiberFlags"
import {HostRoot} from "./workTags"

let workInProgress: FiberNode | null = null

// 更新的触发可以从fiber树中任意一个fiber node开始
export function scheduleUpdateOnFiber(fiber: FiberNode) {
	const root = markUpdateFromFiberToRoot(fiber)

	renderRoot(root)
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
	workInProgress = createWorkInProgress(fiber.current, {})
}

function renderRoot(root: FiberRootNode) {
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

	// beforeMutation

	// mutation
	const subTreeHasFlags = (finishedWork.subFlags & MutationMask) !== NoFlags
	const rootHasFlags = (finishedWork.flags & MutationMask) !== NoFlags
	if (subTreeHasFlags || rootHasFlags) {
		commitMutationEffects(finishedWork)
		root.current = finishedWork
	} else {
		root.current = finishedWork
	}

	// layout
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
		const sibling = node.sibling
		if (sibling !== null) {
			workInProgress = sibling
			return
		}
		node = node.return
		workInProgress = node
	} while (node !== null)
}

function createWorkInProgress(current: FiberNode, pendingProps: Props) {
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

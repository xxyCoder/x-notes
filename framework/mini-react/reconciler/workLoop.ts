import {Props} from "../shared/ReactTypes"
import {FiberNode} from "./fiber"
import {NoFlags} from "./fiberFlags"
import {HostRoot} from "./workTags"

let workInProgress: FiberNode | null = null

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
		return node.stateNode
	}
	return null
}

function prepareFreshStack(fiber: FiberNode) {
	workInProgress = createWorkInProgress(fiber, {})
}

function renderRoot(root: FiberNode) {
	prepareFreshStack(root)
  do {
    try {
      workLoop()
    } catch (err) {
      workInProgress = null
    }
  } while(true)
}

function workLoop() {
  
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

import {Props} from "../shared/ReactTypes"
import {mountChildrenFibers, reconcilerChildFibers} from "./childFibers"
import {FiberNode} from "./fiber"
import { renderWithHooks } from "./fiberHooks"
import {processUpdate} from "./updateQueue"
import {FunctionComponent, HostComponent, HostRoot, HostText} from "./workTags"

// 处理子节点，为其创建fiber
export default function beginWork(fiber: FiberNode) {
	switch (fiber.tag) {
		case HostRoot:
			return updateHostRoot(fiber)
		case HostComponent:
			return updateHostComponent(fiber)
		case HostText:
			// text没有子节点
			return null
		case FunctionComponent:
			return updateFunctionComponent(fiber)
		default:
			console.log("none")
      return null
	}
}

function updateFunctionComponent(fiber: FiberNode) {
	const nextChildren = renderWithHooks(fiber)

	reconcilerChildren(fiber, nextChildren)
	return fiber.child
}

function updateHostRoot(fiber: FiberNode) {
	const {memoizedState: baseState, updateQueue} = fiber
	const pending = updateQueue?.shared.pending || null
	if (updateQueue) {
		updateQueue.shared.pending = null
	}
	// 对于host root fiber来说，就是<App /> element
	const {memoizedState} = processUpdate(baseState, pending)
	fiber.memoizedState = memoizedState

	const nextChildren = memoizedState
	reconcilerChildren(fiber, nextChildren)
	return fiber.child
}

function updateHostComponent(fiber: FiberNode) {
	const nextProps = fiber.pendingProps
	const nextChildren = nextProps.children

	reconcilerChildren(fiber, nextChildren)
	return fiber.child
}

function reconcilerChildren(fiber: FiberNode, children: Props["children"]) {
	const current = fiber.alternate
	if (current === null) {
		// mount
		mountChildrenFibers(fiber, null, children)
	} else {
		// update
		reconcilerChildFibers(fiber, current.child, children)
	}
}

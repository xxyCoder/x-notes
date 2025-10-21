import {Props} from "../shared/ReactTypes"
import {mountChildrenFibers, reconcilerChildFibers} from "./childFibers"
import {FiberNode} from "./fiber"
import {renderWithHooks} from "./fiberHooks"
import {Lane} from "./fiberLanes"
import {processUpdateQueue} from "./updateQueue"
import {FunctionComponent, HostComponent, HostRoot, HostText} from "./workTags"

// 当前element已经转化为fiber，需要处理子节点，为其创建fiber并建立指针关系
export default function beginWork(fiber: FiberNode, renderLane: Lane) {
	switch (fiber.tag) {
		case HostRoot:
			return updateHostRoot(fiber, renderLane)
		case HostComponent:
			return updateHostComponent(fiber)
		case HostText:
			// text没有子节点
			return null
		case FunctionComponent:
			return updateFunctionComponent(fiber, renderLane)
		default:
			console.log("none")
			return null
	}
}

function updateFunctionComponent(fiber: FiberNode, renderLane: Lane) {
	// function类型的fiber需要执行函数后才能拿到子元素，执行函数需要在某个context中才行（可能函数有使用hook)
	const nextChildren = renderWithHooks(fiber, renderLane)

	reconcilerChildren(fiber, nextChildren)
	return fiber.child
}

function updateHostRoot(fiber: FiberNode, renderLane: Lane) {
	const {memoizedState: baseState, updateQueue} = fiber
	if (updateQueue) {
		updateQueue.shared.pending = null
	}
	// 对于host root fiber，子元素存放在updateQueue了（在updateContainer函数中将其压入queue了）
	const {memoizedState} = processUpdateQueue(
		baseState,
		updateQueue?.shared.pending ?? null,
		renderLane
	)
	fiber.memoizedState = memoizedState

	const nextChildren = memoizedState
	reconcilerChildren(fiber, nextChildren)
	return fiber.child
}

function updateHostComponent(fiber: FiberNode) {
	// 对于host component类型的fiber，其子元素存在于props.children中（jsx编译后会将children存放在react element的props中，也就是fiber的pendingProps）
	const nextProps = fiber.pendingProps
	const nextChildren = nextProps.children

	reconcilerChildren(fiber, nextChildren)
	return fiber.child
}

function reconcilerChildren(fiber: FiberNode, children: Props["children"]) {
	const current = fiber.alternate
	if (current === null) {
		// mount
		fiber.child = mountChildrenFibers(fiber, null, children)
	} else {
		// update
		fiber.child = reconcilerChildFibers(fiber, current.child, children)
	}
}

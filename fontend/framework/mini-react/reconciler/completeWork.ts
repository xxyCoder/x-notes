import {updateFiberProps} from "../src/synctheticEvent"
import {FiberNode} from "./fiber"
import {Flags, NoFlags, Ref, Update} from "./fiberFlags"
import {
	appendInitialChild,
	createInstance,
	createTextInstance,
} from "./hostConfig"
import {FunctionComponent, HostComponent, HostRoot, HostText} from "./workTags"

function markUpdate(fiber: FiberNode) {
	fiber.flags |= Update
}

// complete work是自底向上的，先建立了子dom，就方便在父dom中调用append方法
export default function completeWork(fiber: FiberNode) {
	const {pendingProps, alternate: current} = fiber
	/**
	 * 1. 构建dom
	 * 2. 将子dom加入到当前dom
	 */
	switch (fiber.tag) {
		case HostRoot:
			bubbleProperties(fiber)
			return
		case HostComponent:
			if (current !== null && fiber.stateNode) {
				// update
				updateFiberProps(fiber.stateNode, fiber.pendingProps)
				if (current.ref !== fiber.ref) {
					markRef(fiber)
				}
			} else {
				const instance = createInstance(fiber.type as string, pendingProps)
				appendAllChildren(instance, fiber)
				fiber.stateNode = instance
				if (fiber.ref !== null) {
					markRef(fiber)
				}
			}
			bubbleProperties(fiber)
			return
		case HostText:
			if (current !== null && fiber.stateNode) {
				// update
				const oldText = current.memoizedProps?.content
				const newText = pendingProps.content
				if (oldText !== newText) {
					markUpdate(fiber)
				}
			} else {
				const instance = createTextInstance(pendingProps.content)
				fiber.stateNode = instance
			}
			bubbleProperties(fiber)
		case FunctionComponent:
			bubbleProperties(fiber)
			return
		default:
	}
}

function appendAllChildren(parent: Element, fiber: FiberNode) {
	let node = fiber.child
	while (node !== null) {
		if ([HostComponent, HostText].includes(node.tag)) {
			appendInitialChild(parent, node.stateNode)
		} else if (node.child !== null) {
			node.child.return = node
			node = node.child
			continue
		}

		if (node === fiber) {
			return
		}
		while (node.sibling === null) {
			if (node.return === null || node.return === fiber) {
				return
			}
			node = node?.return
		}
		node.sibling.return = node.return
		node = node.sibling
	}
}

// 将子fiber的flag向上冒泡进行优化（如果子fiber没有flags，也就说明不需要走子节点更新）
function bubbleProperties(fiber: FiberNode) {
	let child = fiber.child
	let subFlags = NoFlags
	while (child !== null) {
		subFlags |= child.flags
		subFlags |= child.subFlags

		child = child.sibling
	}
	fiber.subFlags |= subFlags
}

function markRef(fiber: FiberNode) {
	fiber.flags |= Ref
}

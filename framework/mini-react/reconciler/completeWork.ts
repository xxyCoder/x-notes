import {FiberNode} from "./fiber"
import {Flags, NoFlags} from "./fiberFlags"
import {
	appendInitialChild,
	createInstance,
	createTextInstance,
} from "./hostConfig"
import {HostComponent, HostRoot, HostText} from "./workTags"

export default function completeWork(fiber: FiberNode) {
	const {pendingProps, alternate: current} = fiber

	/**
	 * 1. 构建dom
	 * 2. 加入父dom
	 */
	switch (fiber.tag) {
		case HostRoot:
			return
		case HostComponent:
			if (current !== null && fiber.stateNode) {
				// update
			} else {
				const instance = createInstance(fiber.type as string, pendingProps)
				appendAllChildren(instance, fiber)
				fiber.stateNode = instance
			}
			bubbleProperties(fiber)
			return
		case HostText:
			if (current !== null && fiber.stateNode) {
				// update
			} else {
				const instance = createTextInstance(pendingProps.content)
				fiber.stateNode = instance
			}
			bubbleProperties(fiber)
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

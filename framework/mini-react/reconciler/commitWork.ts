import {FiberNode} from "./fiber"
import {
	ChildDeletion,
	MutationMask,
	NoFlags,
	Placement,
	Update,
} from "./fiberFlags"
import {
	appendChildToContainer,
	commitUpdate,
	insertChildToContainer,
	removeChild,
} from "./hostConfig"
import {FunctionComponent, HostComponent, HostRoot, HostText} from "./workTags"

let nextEffect: FiberNode | null = null
// 从底部往上处理effect
export const commitMutationEffects = (finishedWork: FiberNode) => {
	// finishedWork = host fiber
	nextEffect = finishedWork

	while (nextEffect !== null) {
		const child = nextEffect.child
		if ((nextEffect.subFlags & MutationMask) !== NoFlags && child !== null) {
			nextEffect = child
		} else {
			up: while (nextEffect !== null) {
				commitMutationEffectsOnFiber(nextEffect)
				const sibling = nextEffect.sibling
				if (sibling !== null) {
					nextEffect = sibling
					break up
				}
				nextEffect = nextEffect.return
			}
		}
	}
}

function commitMutationEffectsOnFiber(finishedWork: FiberNode) {
	const flags = finishedWork.flags
	if ((flags & Placement) !== NoFlags) {
		commitPlacement(finishedWork)
		finishedWork.flags &= ~Placement
	}
	if ((flags & Update) !== NoFlags) {
		commitUpdate(finishedWork)
		finishedWork.flags &= ~Update
	}
	if ((flags & ChildDeletion) !== NoFlags) {
		const deletions = finishedWork.deletions ?? []
		deletions.forEach((fiber) => commitDeletion(fiber))
		finishedWork.flags &= ~ChildDeletion
	}
}

function commitDeletion(fiber: FiberNode) {
	let rootHostNode: FiberNode | null = null
	commitNestedComponent(fiber, (unmountFiber) => {
		switch (unmountFiber.tag) {
			case HostComponent:
				if (rootHostNode === null) {
					rootHostNode = unmountFiber
				}
				// TODO: 解绑ref
				return
			case HostText:
				if (rootHostNode === null) {
					rootHostNode = unmountFiber
				}
				return
			case FunctionComponent:
				// useEffect unmount
				return
		}
	})

	if (rootHostNode !== null) {
		const hostParent = getHostParent(rootHostNode)
		if (!!hostParent) {
			removeChild((rootHostNode as FiberNode).stateNode, hostParent)
		}
	}
	fiber.return = null
	fiber.child = null
}

function commitNestedComponent(
	root: FiberNode,
	onCommitUnmount: (fiber: FiberNode) => void
) {
	let node = root
	while (true) {
		onCommitUnmount(node)
		if (node.child !== null) {
			node.child.return = node
			node.child = node
			continue
		}
		if (node === root) {
			return
		}
		while (node.sibling === null) {
			if (node.return === null || node.return === root) {
				return
			}
			node = node.return
		}
		node.sibling.return = node.return
		node = node.sibling
	}
}

function commitPlacement(finishedWork: FiberNode) {
	// 需要找到最近的有真实dom的fiber，也就是tag为host component或者是host root（容器）
	const parent = getHostParent(finishedWork)
	const sibling = getHostSibling(finishedWork)
	if (parent !== null) {
		insertOrAppendPlacementNodeIntoContainer(finishedWork, parent, sibling)
	}
}
/**
 * <App> <div />
 *  App: <span />
 * 最终变成 <span /> <div />
 */
function getHostSibling(fiber: FiberNode) {
	let node = fiber
	findSibling: while (true) {
		while (node.sibling === null) {
			const parent = node.return
			if (
				parent === null ||
				parent.tag === HostComponent ||
				parent.tag === HostRoot
			) {
				return null
			}
			node = parent
		}
		node.sibling.return = node.return
		node = node.sibling
		while (![HostComponent, HostText].includes(node.tag)) {
			// 向下遍历找host
			// 排除Placement节点（被移动走了，不能作为host sibling)
			if ((node.flags & Placement) !== NoFlags) {
				continue findSibling
			}
			if (node.child === null) {
				continue findSibling
			}
			node.child.return = node.child
			node = node.child
		}
		if ((node.flags & Placement) === NoFlags) {
			return node.stateNode
		}
	}
}

function getHostParent(fiber: FiberNode) {
	let parent = fiber.return

	while (parent) {
		const tag = parent.tag
		if (tag === HostComponent) {
			return parent.stateNode as Element
		} else if (tag === HostRoot) {
			return parent.stateNode.container as Element
		}
		parent = parent.return
	}
	return null
}

function insertOrAppendPlacementNodeIntoContainer(
	finishedWork: FiberNode,
	hostParent: Element,
	before?: Element
) {
	if (finishedWork.tag === HostComponent || finishedWork.tag === HostText) {
		if (typeof before !== "undefined") {
			insertChildToContainer(hostParent, before, finishedWork.stateNode)
		} else {
			appendChildToContainer(hostParent, finishedWork.stateNode)
		}
	}
	const child = finishedWork.child
	if (child !== null) {
		// 递归找到有真实dom的fiber，比如当前fiber tag为function component
		insertOrAppendPlacementNodeIntoContainer(child, hostParent)
		let sibling = finishedWork.sibling
		while (sibling !== null) {
			insertOrAppendPlacementNodeIntoContainer(sibling, hostParent)
			sibling = sibling.sibling
		}
	}
}

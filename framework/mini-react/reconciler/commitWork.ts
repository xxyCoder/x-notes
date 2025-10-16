import {FiberNode} from "./fiber"
import {MutationMask, NoFlags, Placement} from "./fiberFlags"
import {appendChildToContainer} from "./hostConfig"
import {HostComponent, HostRoot, HostText} from "./workTags"

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
}

function commitPlacement(finishedWork: FiberNode) {
	// 需要找到最近的有真实dom的fiber，也就是tag为host component或者是host root（容器）
	const parent = getHostParent(finishedWork)
  if (parent) {
    appendPlacementNodeIntoContainer(finishedWork, parent)
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
}

function appendPlacementNodeIntoContainer(
	finishedWork: FiberNode,
	hostParent: Element
) {
	if (finishedWork.tag === HostComponent || finishedWork.tag === HostText) {
		appendChildToContainer(hostParent, finishedWork.stateNode)
	}
	const child = finishedWork.child
	if (child !== null) {
		// 递归找到有真实dom的fiber，比如当前fiber tag为function component
		appendPlacementNodeIntoContainer(child, hostParent)
		let sibling = finishedWork.sibling
		while (sibling !== null) {
			appendPlacementNodeIntoContainer(sibling, hostParent)
      sibling = sibling.sibling
		}
	}
}

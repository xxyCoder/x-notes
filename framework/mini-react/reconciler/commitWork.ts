import {FiberNode} from "./fiber"
import {MutationMask, NoFlags, Placement} from "./fiberFlags"
import {appendChildToContainer} from "./hostConfig"
import {HostComponent, HostRoot, HostText} from "./workTags"

let nextEffect: FiberNode | null = null
export const commitMutationEffects = (finishedWork: FiberNode) => {
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
		appendPlacementNodeIntoContainer(child, hostParent)
		let sibling = finishedWork.sibling
		while (sibling !== null) {
			appendPlacementNodeIntoContainer(sibling, hostParent)
      sibling = sibling.sibling
		}
	}
}

import {Props, ReactElementType} from "../shared/ReactTypes"
import {createFiberFromElement, FiberNode} from "./fiber"
import {REACT_ELEMENT_TYPE} from "../shared/ReactSymbols.ts"
import {HostText} from "./workTags.ts"
import {ChildDeletion, Placement} from "./fiberFlags.ts"
import {createWorkInProgress} from "./workLoop.ts"

function useFiber(fiber: FiberNode, pendingProps: Props) {
	const clone = createWorkInProgress(fiber, pendingProps)
	clone.sibling = null

	return clone
}

/**
 *
 * @param shouldTrackEffect 是否跟踪副作用（即标记flag）
 * mount阶段不需要标记，只需要在根节点标记Placement即可（一个优化，即构建一个离线的dom树后，再执行一次插入就可以把整个树插入了）
 */

function childrenReconciler(shouldTrackEffect: boolean) {
	function deleteChild(returnFiber: FiberNode, childToDelete: FiberNode) {
		if (!shouldTrackEffect) {
			return
		}
		const deletions = returnFiber.deletions ?? []
		deletions.push(childToDelete)
		// 子fiber被删除的话，在新的current fiber 树上是找不到该fiber的，也就无法在mutation阶段进行真正的删除，所以需要在父fiber上标记并存储在deletions字段中
		returnFiber.flags |= ChildDeletion
	}

	function reconcilerSingleElement(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		newChild: ReactElementType
	) {
		const key = newChild.key
		if (currentFiber !== null) {
			// update
			if (currentFiber.key === key && currentFiber.type === newChild.type) {
				const existing = useFiber(currentFiber, newChild.props)
				existing.return = returnFiber
				return existing
			} else {
				// 删除旧element，走到和mount阶段一样的流程
				deleteChild(returnFiber, currentFiber)
			}
		}
		// mount
		const fiber = createFiberFromElement(newChild)
		// 这里仅仅将当前fiber的return指针指向了父fiber，修改父fiber的child在最外层
		fiber.return = returnFiber

		return fiber
	}

	function reconcilerSingleTextNode(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		content: string | number
	) {
		if (currentFiber !== null) {
			if (currentFiber.tag === HostText) {
				// 说明类型都是文本，文本不需要判断key（因为没有）
				const existing = useFiber(currentFiber, {content})
				existing.return = returnFiber

				return existing
			} else {
				deleteChild(returnFiber, currentFiber)
			}
		}
		// 其实pendingProps就是一个字符串，这里方便ts定义改成{ content: 'xxxx' }
		const fiber = new FiberNode(HostText, {content}, null)
		fiber.return = returnFiber

		return fiber
	}

	function placeSingleChild(fiber: FiberNode) {
		// update阶段新增fiber
		if (shouldTrackEffect && fiber.alternate === null) {
			fiber.flags |= Placement
		}
		return fiber
	}

	return function (
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		newChild?: Props["children"]
	) {
		if (
			typeof newChild === "object" &&
			!Array.isArray(newChild) &&
			newChild !== null
		) {
			switch (newChild.$$typeof) {
				case REACT_ELEMENT_TYPE:
					return placeSingleChild(
						reconcilerSingleElement(returnFiber, currentFiber, newChild)
					)
			}
		}

		// TODO: 多节点

		if (typeof newChild === "string" || typeof newChild === "number") {
			return placeSingleChild(
				reconcilerSingleTextNode(returnFiber, currentFiber, newChild)
			)
		}
		// 兜底情况
		if (currentFiber !== null) {
			deleteChild(returnFiber, currentFiber)
		}
		return null
	}
}

export const mountChildrenFibers = childrenReconciler(false)
export const reconcilerChildFibers = childrenReconciler(true)

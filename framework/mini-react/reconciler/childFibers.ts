import {Props, ReactElementType, SingleChildren} from "../shared/ReactTypes"
import {createFiberFromElement, FiberNode} from "./fiber"
import {REACT_ELEMENT_TYPE} from "../shared/ReactSymbols.ts"
import {HostText} from "./workTags.ts"
import {Placement} from "./fiberFlags.ts"

/**
 *
 * @param shouldTrackEffect 是否跟踪副作用（即标记flag）
 * mount阶段不需要标记，只需要在根节点标记Placement即可（一个优化）
 */

function childrenReconciler(shouldTrackEffect: boolean) {
	function reconcilerSingleElement(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		newChild: ReactElementType
	) {
		const fiber = createFiberFromElement(newChild)
		fiber.return = returnFiber

		return fiber
	}

	function reconcilerSingleTextNode(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		content: string | number
	) {
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
					placeSingleChild(
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
	}
}

export const mountChildrenFibers = childrenReconciler(false)
export const reconcilerChildFibers = childrenReconciler(true)

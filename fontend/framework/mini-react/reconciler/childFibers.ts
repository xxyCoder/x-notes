import {
	Key,
	Props,
	ReactElementType,
	SingleChildren,
} from "../shared/ReactTypes"
import {createFiberFromElement, FiberNode} from "./fiber"
import {REACT_ELEMENT_TYPE} from "../shared/ReactSymbols.ts"
import {HostText} from "./workTags.ts"
import {ChildDeletion, Placement} from "./fiberFlags.ts"
import {createWorkInProgress} from "./workLoop.ts"

type ExistingChildren = Map<Key, FiberNode>

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

	function deleteRemainChild(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null
	) {
		if (!shouldTrackEffect) {
			return
		}
		let childToDelete = currentFiber
		while (childToDelete !== null) {
			deleteChild(returnFiber, childToDelete)
			childToDelete = childToDelete.sibling
		}
	}

	// mount/update后是单节点
	function reconcilerSingleElement(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		newChild: ReactElementType
	) {
		const key = newChild.key
		while (currentFiber !== null) {
			// update
			if (currentFiber.key === key && currentFiber.type === newChild.type) {
				const existing = useFiber(currentFiber, newChild.props)
				existing.return = returnFiber
				// eg: A1 B1 C1 -> B1
				deleteRemainChild(returnFiber, currentFiber.sibling)
				return existing
			} else {
				// 删除旧element，走到和mount阶段一样的流程
				deleteChild(returnFiber, currentFiber)
				// eg: A1 B1 C1 -> B2 or A1 B1 C1 -> D1
				currentFiber = currentFiber.sibling
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
		while (currentFiber !== null) {
			if (currentFiber.tag === HostText) {
				// 说明类型都是文本，文本不需要判断key（因为没有）
				const existing = useFiber(currentFiber, {content})
				existing.return = returnFiber
				deleteRemainChild(returnFiber, currentFiber.sibling)
				return existing
			} else {
				deleteChild(returnFiber, currentFiber)
				currentFiber = currentFiber.sibling
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

	function reconcilerChildArray(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		newChilds: SingleChildren[]
	) {
		// 1. 将current的fiber保存在map中
		const existingChildrenMap: ExistingChildren = new Map()
		let current = currentFiber
		while (current !== null) {
			const keyToUse = current.key ?? current.index
			existingChildrenMap.set(keyToUse, current)
			current = current.sibling
		}

		let lastPlacedIndex = -1
		let lastNewFiber: FiberNode | null = null
		let firstNewFiber: FiberNode | null = null
		// 遍历child，寻找复用节点
		for (let i = 0; i < newChilds.length; ++i) {
			const after = newChilds[i]
			const newFiber = updateFromMap(returnFiber, existingChildrenMap, i, after)
			if (newFiber === null) {
				continue
			}
			newFiber.return = returnFiber
			if (lastNewFiber == null) {
				lastNewFiber = newFiber
				firstNewFiber = newFiber
			} else {
				lastNewFiber.sibling = newFiber
				lastNewFiber = lastNewFiber.sibling
			}
			if (!shouldTrackEffect) {
				continue
			}

			// 标记旧fiber移动还是保持位置不动
			// 新fiber插入
			const current = newFiber.alternate
			if (current !== null) {
				const oldIndex = current.index
				if (oldIndex < lastPlacedIndex) {
					// 移动
					newFiber.tag |= Placement
					continue
				} else {
					// fiber保持位置不变
					lastPlacedIndex = oldIndex
				}
			} else {
				// 插入
				newFiber.tag |= Placement
			}
		}

		// map剩余fiber都是不可复用的，直接删除
		existingChildrenMap.forEach((fiber) => {
			deleteChild(returnFiber, fiber)
		})
		return firstNewFiber
	}

	function updateFromMap(
		returnFiber: FiberNode,
		existingChildren: ExistingChildren,
		index: number,
		element: SingleChildren
	) {
		// @ts-ignore
		const keyToUse = element?.key ?? index
		const before = existingChildren.get(keyToUse)

		// host text
		if (typeof element == "string" || typeof element === "number") {
			if (typeof before !== "undefined") {
				existingChildren.delete(keyToUse)
				// 复用
				return useFiber(before, {content: element})
			}
			// string element上没有key
			const newFiber = new FiberNode(HostText, {content: element}, null)
			newFiber.index = index
			return newFiber
		}
		if (typeof element === "object" && element !== null) {
			switch (element.$$typeof) {
				case REACT_ELEMENT_TYPE: {
					if (typeof before !== "undefined") {
						if (before.type === element.type) {
							existingChildren.delete(keyToUse)
							return useFiber(before, element.props)
						}
					}
					const newFiber = createFiberFromElement(element)
					newFiber.index = index
					return newFiber
				}
			}
		}

		return null
	}

	return function (
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		newChild?: Props["children"]
	) {
		if (
			typeof newChild === "object" &&
			newChild !== null &&
			!Array.isArray(newChild)
		) {
			switch (newChild.$$typeof) {
				case REACT_ELEMENT_TYPE:
					return placeSingleChild(
						reconcilerSingleElement(returnFiber, currentFiber, newChild)
					)
			}
		} else if (Array.isArray(newChild)) {
			return reconcilerChildArray(returnFiber, currentFiber, newChild)
		} else if (typeof newChild === "string" || typeof newChild === "number") {
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

import {Key, Props, ReactElementType, Ref, Type} from "../shared/ReactTypes"
import {Flags, NoFlags} from "./fiberFlags"
import { Effect } from "./fiberHooks"
import {Lanes, NoLane} from "./fiberLanes"
import {UpdateQueue} from "./updateQueue"
import {FunctionComponent, HostComponent, WorkTag} from "./workTags"

/**
 * react element从数据类型来看，只是一个dom节点的快照，没有包含组件实例状态、组件直接关系等信息
 * fiber是一个动态的工作单元
 */
export class FiberNode {
	type: Type
	key: Key
	ref: Ref
	tag: WorkTag
	index: number

	stateNode: any

	return: FiberNode | null
	sibling: FiberNode | null
	child: FiberNode | null

	pendingProps: Props
	memoizedProps: Props | null
	memoizedState: any

	alternate: FiberNode | null

	flags: Flags
	subFlags: Flags
	updateQueue: UpdateQueue<any> | null

	deletions: FiberNode[] | null

	constructor(tag: WorkTag, pendingProps: Props, key: Key) {
		this.type = null
		this.key = key
		this.ref = null
		this.tag = tag
		this.index = 0

		this.stateNode = null

		this.return = null
		this.child = null
		this.sibling = null

		this.pendingProps = pendingProps
		this.memoizedProps = null
		this.memoizedState = null
		this.alternate = null

		this.flags = NoFlags
		this.subFlags = NoFlags

		this.updateQueue = null

		this.deletions = null
	}
}


export interface PendingPassiveEffects {
	unmount: Effect[]
	update: Effect[]
}
/**
 * 整个应用的入口控制器，双缓冲树的管理者
 * @param containerInfo 实际的DOM元素，如div#root
 * @param current 在当前屏幕显示的树
 * @param finishedWork 已完成的workInProgress树
 * @param pendingLanes 代表所有没有被“消费”的lane集合
 * @param finishedLanes 代表本次更新的lane
 */
export class FiberRootNode {
	containerInfo: Element
	current: FiberNode
	finishedWork: FiberNode | null
	pendingLanes: Lanes
	finishedLanes: Lanes
	pendingPassiveEffects: PendingPassiveEffects

	// host root fiber定义了react fiber的边界，作为整个fiber树的起点
	constructor(container: Element, hostRootFiber: FiberNode) {
		this.containerInfo = container
		this.current = hostRootFiber
		hostRootFiber.stateNode = this

		this.finishedWork = null

		this.pendingLanes = NoLane
		this.finishedLanes = NoLane

		this.pendingPassiveEffects = {
			unmount: [],
			update: []
		}
	}
}

export function createFiberFromElement(element: ReactElementType) {
	const {type, key, props} = element
	let fiberWorkTag: WorkTag = FunctionComponent
	if (typeof type === "string") {
		fiberWorkTag = HostComponent
	} else if (typeof type !== "function") {
		console.error("")
	}

	const fiber = new FiberNode(fiberWorkTag, props, key)
	fiber.type = type

	return fiber
}

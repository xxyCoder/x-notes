import {Key, Props, ReactElementType, Ref, SingleChildren, Type} from "../shared/ReactTypes"
import {Flags, NoFlags} from "./fiberFlags"
import {UpdateQueue} from "./updateQueue"
import {FunctionComponent, HostComponent, HostText, WorkTag} from "./workTags"

export class FiberNode {
	type: Type
	key: Key
	ref: Ref
	tag: WorkTag

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

	constructor(tag: WorkTag, pendingProps: Props, key: Key) {
		this.type = null
		this.key = key
		this.ref = null
		this.tag = tag

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
	}
}

export class FiberRootNode {
	containerInfo: Element
	current: FiberNode
	// 指向最新的host root fiber
	finishedWork: FiberNode | null

	constructor(container: Element, hostRootFiber: FiberNode) {
		this.containerInfo = container
		this.current = hostRootFiber
		hostRootFiber.stateNode = this

		this.finishedWork = null
	}
}

export function createFiberFromElement(element: ReactElementType) {
	const {type, key, props} = element
	let fiberWorkTag: WorkTag = FunctionComponent
	if (typeof type === "string") {
		fiberWorkTag = HostComponent
	} else if (typeof type !== "function") {
		console.error('')
	}

	const fiber = new FiberNode(fiberWorkTag, props, key)
	fiber.type = type

	return fiber
}

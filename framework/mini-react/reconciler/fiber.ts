import {Key, Props, Ref, Type} from "../shared/ReactTypes"
import {Flags, NoFlags} from "./fiberFlags"
import {WorkTag} from "./workTags"

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
	updateQueue: any

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
import {ReactElementType} from "../shared/ReactTypes"
import {FiberNode, FiberRootNode} from "./fiber"
import {createUpdate, createUpdateQueue, enqueueUpdate} from "./updateQueue"
import { scheduleUpdateOnFiber } from "./workLoop"
import {HostRoot} from "./workTags"

 export function createContainer(container: Element) {
	const hostRootFiber = new FiberNode(HostRoot, {}, null)
	// 统一的根fiber
	const root = new FiberRootNode(container, hostRootFiber)
	hostRootFiber.updateQueue = createUpdateQueue<ReactElementType>()

	return root
}

export function updateContainer(
	element: ReactElementType,
	root: FiberRootNode
) {
	const hostRootFiber = root.current
	const update = createUpdate<ReactElementType>(element)

	enqueueUpdate<ReactElementType>(hostRootFiber.updateQueue!, update)
	scheduleUpdateOnFiber(hostRootFiber)

	return element
}

import {ReactElementType} from "../shared/ReactTypes"
import {FiberNode, FiberRootNode} from "./fiber"
import {requestUpdateLanes} from "./fiberLanes"
import {createUpdate, createUpdateQueue, enqueueUpdate} from "./updateQueue"
import {scheduleUpdateOnFiber} from "./workLoop"
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
	const lanes = requestUpdateLanes()
	// element就是App函数返回的结果通过jsx处理后的ReactElement
	const update = createUpdate<ReactElementType>(element, lanes)

	enqueueUpdate<ReactElementType>(hostRootFiber.updateQueue!, update)
	scheduleUpdateOnFiber(hostRootFiber, lanes)

	return element
}

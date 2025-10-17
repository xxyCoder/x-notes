import {Props} from "../shared/ReactTypes"

export const elementPropsKey = "_props"
const vaildEventTypeList = ["click"]

export interface DOMElement extends Element {
	[elementPropsKey]: Props
}

export function updateFiberProps(node: DOMElement, props: Props) {
	node[elementPropsKey] = props
}

export function initEvent(container: Element, eventType: string) {
	if (!vaildEventTypeList.includes(eventType)) {
		return
	}
	container.addEventListener(eventType, (e) => {
		dispatchEvent(container, eventType, e)
	})
}

function dispatchEvent(container: Element, eventType: string, event: Event) {
	const targetElement = event.target
	if (targetElement === null) {
		throw new Error("事件不存在")
	}
	// 1. 收集沿途的事件
	const {capture, bubble} = collectPaths(targetElement, container, eventType)
	// 2. 构造合成事件
	const synctheticEvent = createSynctheticEvent(event)
	// 3. 遍历capture、bubble
	triggerEventFlow(capture, synctheticEvent)
	if (!synctheticEvent.__stopPropagation) {
		triggerEventFlow(bubble, synctheticEvent)
	}
}

type EventCallback = (e: Event) => void
interface Paths {
	capture: EventCallback[]
	bubble: EventCallback[]
}
const getEventCallbackNameFromEventType = (eventType: string) => {
	return {
		click: ["onClickCapture", "onClick"],
	}[eventType]
}

function collectPaths(
	targetElement: EventTarget,
	container: Element,
	eventType: string
) {
	const paths: Paths = {
		capture: [],
		bubble: [],
	}

	let element = targetElement as DOMElement
	while (element && element !== container) {
		const props = element[elementPropsKey]
		if (props) {
			const eventNameList = getEventCallbackNameFromEventType(eventType)
			if (eventNameList?.length === 2) {
				const captureEventCb = props[eventNameList[0]]
				paths.capture.unshift(captureEventCb)

				const bubbleEventCb = props[eventNameList[1]]
				paths.bubble.push(bubbleEventCb)
			}
		}
		element = element.parentNode as DOMElement
	}

	return paths
}

// 之所以要创建合成事件，是因为capture和bubble阶段都是模拟的，那么stopPropagation等方法也需要模拟实现
interface SynctheticEvent extends Event {
	__stopPropagation: boolean
}
function createSynctheticEvent(event: Event) {
	const synctheticEvent = event as SynctheticEvent
	synctheticEvent.__stopPropagation = false
	const originStopPropagation = event.stopPropagation
	synctheticEvent.stopPropagation = () => {
		synctheticEvent.__stopPropagation = true
		originStopPropagation?.()
	}

	return synctheticEvent
}

function triggerEventFlow(
	cbs: EventCallback[],
	synctheticEvent: SynctheticEvent
) {
	for (let i = 0; i < cbs.length; ++i) {
		const cb = cbs[i]
		cb.call(null, synctheticEvent)
		if (synctheticEvent.__stopPropagation) {
			break
		}
	}
}

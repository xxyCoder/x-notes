import {FiberRootNode} from "./fiber"

export type Lane = number
export type Lanes = number // 代表lane的集合

// 越小优先级越高（除了0）
export const SyncLane = 0b0001
export const NoLane = 0b0000

export function mergeLanes(laneA: Lane | Lanes, laneB: Lane | Lanes): Lanes {
	return laneA | laneB
}

export function requestUpdateLanes() {
	return SyncLane
}

export function getHighestPriorityLane(lanes: Lanes): Lane {
	// 取最低位
	return lanes & -lanes
}

// 移除lane
export function markRootFinished(root: FiberRootNode, lane: Lane) {
	root.pendingLanes &= ~lane
}

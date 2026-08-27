export type Callback = (...args: any[]) => void

let syncQueue: Callback[] | null = null
let isFlushingSyncQueue = false

export function scheduleSyncCallback(callback: Callback) {
	if (syncQueue === null) {
		syncQueue = [callback]
	} else {
		syncQueue.push(callback)
	}
}

export function flushSyncCallbacks() {
	if (!isFlushingSyncQueue && syncQueue) {
		isFlushingSyncQueue = true
		try {
			syncQueue.forEach((cb) => cb())
		} catch (err) {
			console.error(err)
		} finally {
			isFlushingSyncQueue = false
			syncQueue = null
		}
	}
}

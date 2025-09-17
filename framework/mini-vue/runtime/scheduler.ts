let isFlushing = false
const queue: Function[] = []
const resolvePromise = Promise.resolve()

export function queneJob(job: () => void) {
	if (!queue.includes(job)) {
		queue.push(job)
	}
	if (!isFlushing) {
		isFlushing = true
		resolvePromise.then(() => {
			isFlushing = false
			const jobs = queue.slice(0)
			queue.length = 0

			jobs.forEach((job) => job())
			jobs.length = 0
		})
	}
}

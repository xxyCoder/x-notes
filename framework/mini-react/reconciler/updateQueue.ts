export const createUpdateQueue = () => {
	return {
		shared: {
			pending: null,
		},
	}
}

export const enqueueUpdate = <State>(updateQueue, update) => {
	updateQueue.shared.pending = update
}

export const createUpdate = <State>(state: State) => {
  return {
    action: state
  }
}
import { ReactElementType } from "../shared/ReactTypes"
import { initEvent } from "../src/synctheticEvent"
import { createContainer, updateContainer } from "./fiberReconciler"

export function createRoot(container: Element) {
  const root = createContainer(container)

  return {
    render(element: ReactElementType) {
      initEvent(container, 'click')
      updateContainer(element, root)
    }
  }
}
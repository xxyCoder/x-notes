import { ReactElementType } from "../shared/ReactTypes"
import { createContainer, updateContainer } from "./fiberReconciler"

export function createRoot(container: Element) {
  const root = createContainer(container)

  return {
    render(element: ReactElementType) {
      updateContainer(element, root)
    }
  }
}
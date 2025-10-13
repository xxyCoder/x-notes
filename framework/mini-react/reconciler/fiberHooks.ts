import {TypeFunc} from "../shared/ReactTypes"
import {FiberNode} from "./fiber"

export function renderWithHooks(fiber: FiberNode) {
	const Component = fiber.type as TypeFunc 
	const props = fiber.pendingProps
	const child = Component(props)
	return child
}

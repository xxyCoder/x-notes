export type Key = any
export type Ref = any
export type SingleChildren = ReactElementType | string | number
export type Props = {
	children?: SingleChildren | SingleChildren[]
	content?: string | number
}
export type Type = string | ((props?: Props) => ReactElementType) | null
export type Action<State> = State | ((prevState: State) => State)

export interface ReactElementType {
	$$typeof: symbol | number
	type: Type
	key: Key
	props: Props
	ref: Ref
}

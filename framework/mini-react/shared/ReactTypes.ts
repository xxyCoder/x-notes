export type Key = any
export type Ref = any
export type SingleChildren = ReactElementType | string | number
export type Props = {
	children?: SingleChildren | SingleChildren[]
	content?: string | number
}
export type TypeFunc = ((props?: Props) => ReactElementType)
export type Type = string | TypeFunc | null
export type Action<State> = State | ((prevState: State) => State)

export interface ReactElementType {
	$$typeof: symbol | number
	type: Type
	key: Key
	props: Props
	ref: Ref
}

export type Key = any
export type Ref = any
export type SingleChildren = ReactElementType | string
export type Props = Record<string, string> & {
	children?: SingleChildren | SingleChildren[]
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

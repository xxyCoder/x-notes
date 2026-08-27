export const NoFlags = 0b0000000
export const Placement = 0b0000001
export const Update = 0b0000010
export const ChildDeletion = 0b0000100

export const PassiveEffect = 0b0001000 // 表示当前fiber本次存在副作用
export const Ref = 0b0010000

export const MutationMask = Placement | Update | ChildDeletion | Ref
export const LayoutMask = Ref

export const PassiveMask = PassiveEffect | ChildDeletion

export type Flags = number

import {ReactiveEffect} from "../reactivity/src/effect"
import {reactive} from "../reactivity/src/reactive"
import {isObject, isUndefined} from "../shared"
import {ShapeFlags} from "../shared/shapeFlags"
import {createInstance, initProps} from "./instance"
import nodeOptions from "./node-options"
import patchProps from "./patch-props"
import {queneJob} from "./scheduler"
import {Component, Fragment, isSameVNode, isVNode, Text, VNode} from "./vnode"

const renderOptions = Object.assign({patchProps}, nodeOptions)

function createRenderer(options: typeof renderOptions) {
	const {
		insert: hostInsert,
		remove: hostRemove,
		createElement: hostCreateElement,
		createText: hostCreateText,
		setElementText: hostSetElementText,
		setText: hostSetText,
		parentNode: hostParentNode,
		nextSibling: hostNextSibling,
		patchProps: hostPatchProps,
	} = options

	const mountChildren = (children: VNode[], container: HTMLElement) => {
		for (let i = 0; i < children.length; ++i) {
			patch(null, children[i], container)
		}
	}

	const mountElement = (
		vnode: VNode,
		container: HTMLElement,
		anchor?: HTMLElement | null
	) => {
		const {type, children, props, shapeFlag} = vnode
		const el = hostCreateElement(type as string)
		vnode.el = el

		if (isObject(props)) {
			for (const key in props) {
				hostPatchProps(el, key, null, props[key])
			}
		}
		if (ShapeFlags.TEXT_CHILDREN & shapeFlag) {
			hostSetElementText(container, children as string)
		} else if (ShapeFlags.ARRAY_CHILDREN & shapeFlag) {
			mountChildren(children as VNode[], el)
		}

		hostInsert(el, container, anchor)
	}

	const unmount = (vnode: VNode) => {
		if (vnode.el) {
			if (vnode.type === Fragment) {
				unmountChildren(vnode.children as VNode[])
			} else {
				hostRemove(vnode.el as HTMLElement)
			}
		}
	}

	const patchProps = (oldProps: object, newProps: object, el: HTMLElement) => {
		if (isObject(newProps)) {
			for (const key in newProps) {
				hostPatchProps(el, key, oldProps[key], newProps[key])
			}
		}
		if (isObject(oldProps)) {
			for (const key in oldProps) {
				if (!isObject(newProps) || !(key in newProps)) {
					hostPatchProps(el, key, oldProps[key], null)
				}
			}
		}
	}

	const unmountChildren = (children: VNode[]) => {
		for (let i = 0; i < children.length; ++i) {
			unmount(children[i])
		}
	}

	const patchKeyedChildren = (
		c1: VNode[],
		c2: VNode[],
		container: HTMLElement
	) => {
		// 双方先从头开始比较相等的vnode
		let i = 0
		let e1 = c1.length - 1
		let e2 = c2.length - 1

		while (i <= e1 && i <= e2) {
			const n1 = c1[i]
			const n2 = c2[i]
			if (!isSameVNode(n1, n2)) {
				break
			}
			patch(n1, n2, container)
			++i
		}
		// 双方再从尾比较相等的vnode
		while (i <= e1 && i <= e2) {
			const n1 = c1[e1]
			const n2 = c2[e2]
			if (!isSameVNode(n1, n2)) {
				break
			}
			patch(n1, n2, container)
			--e1
			--e2
		}

		if (i > e1) {
			// 有新增
			while (i <= e2) {
				patch(null, c2[i], container, c2[e2 + 1]?.el as HTMLElement)
				++i
			}
		} else if (i > e2) {
			// 需要删除旧节点
			while (i <= e1) {
				unmount(c1[i])
				++i
			}
		}

		const keyToNewIndexMap = new Map<VNode["key"], number>()
		let s1 = i
		let s2 = i
		for (let j = s2; j <= e2; ++j) {
			const vnode = c2[j]
			keyToNewIndexMap.set(vnode.key, j)
		}

		const toBePatched = e2 - s2 + 1
		const newIndexToOldIndexMap = new Array<number>(toBePatched).fill(0)

		for (let j = s1; j <= e1; ++j) {
			const oldVnode = c1[j]
			const newVnodeIdx = keyToNewIndexMap.get(oldVnode.key)
			if (isUndefined(newVnodeIdx)) {
				unmount(oldVnode)
			} else {
				newIndexToOldIndexMap[newVnodeIdx - s2] = j + 1 // 保证位置上为0的元素是没有在该循环中比对过的
				patch(oldVnode, c2[newVnodeIdx], container)
			}
		}

		// 获取最长递增子序列
		// @ts-ignore
		const increasingSeq = getSequence(newIndexToOldIndexMap)

		// 倒序插入 + 最长子序列算法过滤不需要改动位置的元素
		for (let j = toBePatched - 1, k = increasingSeq.length - 1; j >= 0; --j) {
			const newIndex = s2 + j
			const anchor = c2[newIndex + 1]?.el
			const el = c2[newIndex].el

			if (!el) {
				patch(null, c2[newIndex], container, anchor as HTMLElement)
			} else {
				if (j === increasingSeq[k]) {
					--k
					continue
				}
				hostInsert(el as HTMLElement, container, anchor as HTMLElement)
			}
		}
	}

	const patchChildren = (n1: VNode, n2: VNode, el: HTMLElement) => {
		const c1 = n1.children
		const c2 = n2.children

		const prevShapeFlags = n1.shapeFlag
		const shapeFlags = n2.shapeFlag

		/**
		 * 新节点是文本
		 * 	1. 老节点是文本，直接替换
		 * 	2. 老节点是数组，移除数组，添加文本
		 * 	3. 老节点为空，添加文本
		 * 新节点是空
		 * 	1. 无论老节点是什么，直接移除
		 * 新节点是数组
		 * 	1. 老节点是文本，删除文本，挂载新数组
		 * 	2. 老节点是数组，进行diff
		 * 	3. 老节点是空，挂载新数组
		 *
		 */

		if (shapeFlags & ShapeFlags.TEXT_CHILDREN) {
			if (prevShapeFlags & ShapeFlags.ARRAY_CHILDREN) {
				unmountChildren(c1 as VNode[])
			}
			if (c1 !== c2) {
				hostSetElementText(el, c2 as string)
			}
		} else if (c2 === null) {
			if (prevShapeFlags & ShapeFlags.TEXT_CHILDREN) {
				hostSetElementText(el, "")
			} else if (prevShapeFlags & ShapeFlags.ARRAY_CHILDREN) {
				unmountChildren(c1 as VNode[])
			}
		} else if (shapeFlags & ShapeFlags.ARRAY_CHILDREN) {
			if (prevShapeFlags & ShapeFlags.TEXT_CHILDREN) {
				// diff
				patchKeyedChildren(c1 as VNode[], c2 as VNode[], el)
				return
			}

			hostSetElementText(el, "")
			mountChildren(c2 as VNode[], el)
		}
	}

	const patchElement = (n1: VNode, n2: VNode, container: HTMLElement) => {
		const el = (n2.el = n1.el) // 复用dom

		const oldProps = n1.props || {}
		const newProps = n2.props || {}
		patchProps(oldProps, newProps, container)

		patchChildren(n1, n2, container)
	}

	const processElement = (
		n1: VNode | null,
		n2: VNode,
		container: HTMLElement,
		anchor?: HTMLElement | null
	) => {
		if (n1 === null) {
			// mount
			mountElement(n2, container, anchor)
		} else {
			patchElement(n1, n2, container)
		}
	}

	const processText = (n1: VNode | null, n2: VNode, container: HTMLElement) => {
		if (n1 === null) {
			hostInsert((n2.el = hostCreateText(n2.children as string)), container)
		} else {
			const el = (n2.el = n1.el)
			if (n1.children! == n2.children) {
				hostSetText(el!, n2.children as string)
			}
		}
	}

	const processFragment = (
		n1: VNode | null,
		n2: VNode,
		container: HTMLElement
	) => {
		if (n1 === null) {
			mountChildren(n2.children as VNode[], container)
		} else {
			patchChildren(n1, n2, container)
		}
	}

	const mountComponent = (
		vnode: VNode,
		container: HTMLElement,
		anchor?: HTMLElement | null
	) => {
		const {
			data = () => {},
			render,
			props: propOptions = {},
		} = vnode.type as Component

		const state = reactive(data())
		const instance = (vnode.component = createInstance({
			state,
			vnode,
			propOptions,
		}))
		initProps(instance, vnode.props)
		const componentUpdateFn = () => {
			const subTree = render.call(instance.proxy, instance.proxy)

			patch(instance.subTree, subTree, container, anchor)
			instance.subTree = subTree
			instance.isMounted = true
		}

		const effect = new ReactiveEffect(componentUpdateFn, () => queneJob(update))

		const update = (instance.updateFn = () => {
			effect.run()
		})
		update()
	}

	const patchComponent = () => {}

	const processComponent = (
		n1: VNode | null,
		n2: VNode,
		container: HTMLElement,
		anchor?: HTMLElement | null
	) => {
		if (n1 === null) {
			mountComponent(n2, container, anchor)
		} else {
			patchComponent()
		}
	}

	const patch = (
		n1: VNode | null,
		n2: VNode,
		container: HTMLElement,
		anchor?: HTMLElement | null
	) => {
		if (n1 === n2) {
			return
		}

		if (!!n1 && !isSameVNode(n1, n2)) {
			// 根元素不一致，直接移除整个dom
			unmount(n1)
			n1 = null
		}
		const {type, shapeFlag} = n2
		switch (type) {
			case Text:
				processText(n1, n2, container)
				break
			case Fragment:
				processFragment(n1, n2, container)
				break
			default:
				if (shapeFlag & ShapeFlags.ELEMENT) {
					processElement(n1, n2, container, anchor)
				} else if (shapeFlag & ShapeFlags.COMPONENT) {
					processComponent(n1, n2, container, anchor)
				}
		}
	}

	return {
		render(vnode: VNode | null, container: HTMLElement) {
			if (vnode === null) {
				// @ts-ignore
				if (container._vnode) {
					// @ts-ignore
					unmount(container._vnode)
				}
			} else {
				// @ts-ignore
				patch(container._vnode || null, vnode, container)
				// @ts-ignore
				container._vnode = vnode
			}
		},
	}
}

export const render = (vnode: VNode, container: HTMLElement) => {
	return createRenderer(renderOptions).render(vnode, container)
}

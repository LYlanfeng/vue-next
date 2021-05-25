import { isObject, toRawType, def } from '@vue/shared'
import {
  mutableHandlers,
  readonlyHandlers,
  shallowReactiveHandlers,
  shallowReadonlyHandlers
} from './baseHandlers'
import {
  mutableCollectionHandlers,
  readonlyCollectionHandlers,
  shallowCollectionHandlers,
  shallowReadonlyCollectionHandlers
} from './collectionHandlers'
import { UnwrapRef, Ref } from './ref'

/**
 * reactive对象属性枚举
 */
export const enum ReactiveFlags {
  SKIP = '__v_skip',
  IS_REACTIVE = '__v_isReactive',
  IS_READONLY = '__v_isReadonly',
  RAW = '__v_raw'
}

/**
 * reactive对象类型，主要用于枚举判断使用
 * SKIP：是否可以包装成一个reactive对象，api：markRaw 可以吧一个普通对象，就是给对象增加一个SKIP的属性，设置为true，则代表无法通过reactive转化为代理对象
 * IS_REACTIVE: 是否是一个reactive代理对象
 * IS_READONLY: 是否是一个readonly代理对象
 * RAW：获取代理对象的原始对象
 */
export interface Target {
  [ReactiveFlags.SKIP]?: boolean
  [ReactiveFlags.IS_REACTIVE]?: boolean
  [ReactiveFlags.IS_READONLY]?: boolean
  [ReactiveFlags.RAW]?: any
}

// reactive代理对象集合
export const reactiveMap = new WeakMap<Target, any>()
// 浅reactive代理对象集合
export const shallowReactiveMap = new WeakMap<Target, any>()
// readonly代理对象集合
export const readonlyMap = new WeakMap<Target, any>()
// 浅reactiv代理对象集合
export const shallowReadonlyMap = new WeakMap<Target, any>()

/**
 * 对象类型映射的枚举，具体映射见下方 targetTypeMap 方法
 * INVALID：不能代理
 * COMMON：Object/Array 使用基础代理方式
 * COLLECTION：Map/Set/WeakMap/WeakSet 使用集合代理方式
 */
const enum TargetType {
  INVALID = 0,
  COMMON = 1,
  COLLECTION = 2
}

/**
 * 判断对象类型，返回类型枚举，根据枚举决定了proxy handler处理方式
 * @param rawType
 */
function targetTypeMap(rawType: string) {
  switch (rawType) {
    case 'Object':
    case 'Array':
      return TargetType.COMMON
    case 'Map':
    case 'Set':
    case 'WeakMap':
    case 'WeakSet':
      return TargetType.COLLECTION
    default:
      return TargetType.INVALID
  }
}

/**
 * 获取目标对象类型枚举
 * @param value
 */
function getTargetType(value: Target) {
  /*
    如果是一个不可代理的或者不可扩展的对象返回 TargetType.INVALID
    否则通过类型来返回TargetType的枚举
   */
  return value[ReactiveFlags.SKIP] || !Object.isExtensible(value)
    ? TargetType.INVALID
    : targetTypeMap(toRawType(value))
}

// only unwrap nested ref
export type UnwrapNestedRefs<T> = T extends Ref ? T : UnwrapRef<T>

/**
 * Creates a reactive copy of the original object.
 *
 * The reactive conversion is "deep"—it affects all nested properties. In the
 * ES2015 Proxy based implementation, the returned proxy is **not** equal to the
 * original object. It is recommended to work exclusively with the reactive
 * proxy and avoid relying on the original object.
 *
 * A reactive object also automatically unwraps refs contained in it, so you
 * don't need to use `.value` when accessing and mutating their value:
 *
 * ```js
 * const count = ref(0)
 * const obj = reactive({
 *   count
 * })
 *
 * obj.count++
 * obj.count // -> 1
 * count.value // -> 1
 * ```
 */
export function reactive<T extends object>(target: T): UnwrapNestedRefs<T>
export function reactive(target: object) {
  // 如果是一个readonly 代理，则直接返回
  if (target && (target as Target)[ReactiveFlags.IS_READONLY]) {
    return target
  }
  return createReactiveObject(
    target,
    false,
    mutableHandlers,
    mutableCollectionHandlers,
    reactiveMap
  )
}

/**
 * Return a shallowly-reactive copy of the original object, where only the root
 * level properties are reactive. It also does not auto-unwrap refs (even at the
 * root level).
 */
export function shallowReactive<T extends object>(target: T): T {
  return createReactiveObject(
    target,
    false,
    shallowReactiveHandlers,
    shallowCollectionHandlers,
    shallowReactiveMap
  )
}

type Primitive = string | number | boolean | bigint | symbol | undefined | null
type Builtin = Primitive | Function | Date | Error | RegExp
export type DeepReadonly<T> = T extends Builtin
  ? T
  : T extends Map<infer K, infer V>
    ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
    : T extends ReadonlyMap<infer K, infer V>
      ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
      : T extends WeakMap<infer K, infer V>
        ? WeakMap<DeepReadonly<K>, DeepReadonly<V>>
        : T extends Set<infer U>
          ? ReadonlySet<DeepReadonly<U>>
          : T extends ReadonlySet<infer U>
            ? ReadonlySet<DeepReadonly<U>>
            : T extends WeakSet<infer U>
              ? WeakSet<DeepReadonly<U>>
              : T extends Promise<infer U>
                ? Promise<DeepReadonly<U>>
                : T extends {}
                  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
                  : Readonly<T>

/**
 * Creates a readonly copy of the original object. Note the returned copy is not
 * made reactive, but `readonly` can be called on an already reactive object.
 */
export function readonly<T extends object>(
  target: T
): DeepReadonly<UnwrapNestedRefs<T>> {
  return createReactiveObject(
    target,
    true,
    readonlyHandlers,
    readonlyCollectionHandlers,
    readonlyMap
  )
}

/**
 * Returns a reactive-copy of the original object, where only the root level
 * properties are readonly, and does NOT unwrap refs nor recursively convert
 * returned properties.
 * This is used for creating the props proxy object for stateful components.
 */
export function shallowReadonly<T extends object>(
  target: T
): Readonly<{ [K in keyof T]: UnwrapNestedRefs<T[K]> }> {
  return createReactiveObject(
    target,
    true,
    shallowReadonlyHandlers,
    shallowReadonlyCollectionHandlers,
    shallowReadonlyMap
  )
}

/**
 * 创建reactive代理对象
 * @param target 原始对象
 * @param isReadonly 是否是只取对象，仅 readonly/shallowReadonly 才为 true
 * @param baseHandlers 普通对象：Object/Array proxy handlers
 * @param collectionHandlers 集合：Map/Set/WeakMap/WeakSet proxy handlers
 * @param proxyMap // 代理对象存储集合
 */
function createReactiveObject(
  target: Target,
  isReadonly: boolean,
  baseHandlers: ProxyHandler<any>,
  collectionHandlers: ProxyHandler<any>,
  proxyMap: WeakMap<Target, any>
) {
  // 不是一个对象，则无法代理，直接返回，如果是开发环境，则提示
  if (!isObject(target)) {
    if (__DEV__) {
      console.warn(`value cannot be made reactive: ${String(target)}`)
    }
    return target
  }
  // target is already a Proxy, return it.
  // exception: calling readonly() on a reactive object
  /*
   如果原始对象存在（代表是一个代理对象）并且 不是创建只读，或者是一个只读的代理对象，则返回。举例如下：
   基础：target[ReactiveFlags.RAW] 代表target是一个代理对象
   1. isReadonly 为 false，代表这个方法创建的是非（readonly/shallowReadonly）代理，则无需要二次代理：简单代码实例如下
      const proxy = reacitve({ count: 1 })
      const newProxy = reactive(proxy)
      console.log(proxy === newProxy) // true
   2. target[ReactiveFlags.IS_REACTIVE] 为 false，代表这个是一个readonly代理对象，则不能继续
   ps: 表示target为代理对象的时候，只能通过 readonly/shallowReadonly 二次代理 reactive 代理对象
   */
  if (
    target[ReactiveFlags.RAW] &&
    !(isReadonly && target[ReactiveFlags.IS_REACTIVE])
  ) {
    return target
  }
  // target 如果已经存在代理对象，则直接返回，防止重复代理
  const existingProxy = proxyMap.get(target)
  if (existingProxy) {
    return existingProxy
  }
  // 获取对象的类型枚举
  const targetType = getTargetType(target)
  // TargetType.INVALID 则不代理
  if (targetType === TargetType.INVALID) {
    return target
  }
  const proxy = new Proxy(
    target,
    // 使用集合代理处理还是基础代理处理
    targetType === TargetType.COLLECTION ? collectionHandlers : baseHandlers
  )
  // 保存当前代理对象
  proxyMap.set(target, proxy)
  return proxy
}

/**
 * 是否是reactive代理对象
 * @param value
 */
export function isReactive(value: unknown): boolean {
  // 如果是readonly代理对象
  if (isReadonly(value)) {
    // 判断readonly代理对象中的原始对象是否是reactive
    return isReactive((value as Target)[ReactiveFlags.RAW])
  }
  return !!(value && (value as Target)[ReactiveFlags.IS_REACTIVE])
}

/**
 * 是否是readonly代理对象
 * @param value
 */
export function isReadonly(value: unknown): boolean {
  return !!(value && (value as Target)[ReactiveFlags.IS_READONLY])
}

/**
 * 是否是代理对象
 * @param value
 */
export function isProxy(value: unknown): boolean {
  return isReactive(value) || isReadonly(value)
}

/**
 * 获取代理对象的原始对象
 * @param observed
 */
export function toRaw<T>(observed: T): T {
  return (
    (observed && toRaw((observed as Target)[ReactiveFlags.RAW])) || observed
  )
}

/**
 * 设置对象不可代理
 * @param value
 */
export function markRaw<T extends object>(value: T): T {
  def(value, ReactiveFlags.SKIP, true)
  return value
}

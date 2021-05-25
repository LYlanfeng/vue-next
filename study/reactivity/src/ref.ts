import { track, trigger } from './effect'
import { TrackOpTypes, TriggerOpTypes } from './operations'
import { isArray, isObject, hasChanged } from '@vue/shared'
import { reactive, isProxy, toRaw, isReactive } from './reactive'
import { CollectionTypes } from './collectionHandlers'

declare const RefSymbol: unique symbol

export interface Ref<T = any> {
  value: T
  /**
   * Type differentiator only.
   * We need this to be in public d.ts but don't want it to show up in IDE
   * autocomplete, so we use a private Symbol instead.
   */
  [RefSymbol]: true
  /**
   * @internal
   */
  _shallow?: boolean
}

export type ToRef<T> = [T] extends [Ref] ? T : Ref<UnwrapRef<T>>
export type ToRefs<T = any> = {
  // #2687: somehow using ToRef<T[K]> here turns the resulting type into
  // a union of multiple Ref<*> types instead of a single Ref<* | *> type.
  [K in keyof T]: T[K] extends Ref ? T[K] : Ref<UnwrapRef<T[K]>>
}

/**
 * @description 判断是否为 object 对象, 如果是 object 则通过reactive获取响应对象，如果不是则直接返回值
 * @param val
 */
const convert = <T extends unknown>(val: T): T =>
  isObject(val) ? reactive(val) : val

export function isRef<T>(r: Ref<T> | unknown): r is Ref<T>
/**
 * @description 是否为Ref对象，通过 __v_isRef 来判断 Ref是一个class实例，__v_isRef 默认为true，且不可更改
 * @param r
 */
export function isRef(r: any): r is Ref {
  return Boolean(r && r.__v_isRef === true)
}

/**
 * @description 深度转ref
 * @param value
 */
export function ref<T extends object>(value: T): ToRef<T>
export function ref<T>(value: T): Ref<UnwrapRef<T>>
export function ref<T = any>(): Ref<T | undefined>
export function ref(value?: unknown) {
  return createRef(value)
}

/**
 * @description 浅转ref，不会有递归响应行为
 * @param value
 */
export function shallowRef<T extends object>(
  value: T
): T extends Ref ? T : Ref<T>
export function shallowRef<T>(value: T): Ref<T>
export function shallowRef<T = any>(): Ref<T | undefined>
export function shallowRef(value?: unknown) {
  return createRef(value, true)
}

/**
 * Ref类，通过get和set完成依赖收集和触发
 * @class RefImpl
 */
class RefImpl<T> {
  // 值真实存储变量
  private _value: T

  // 是ref对象
  public readonly __v_isRef = true

  /**
   * 构造函数
   * @param _rawValue 值
   * @param _shallow 是否浅响应，当为false的时候，通过convert方法转成reactive响应对象
   */
  constructor(private _rawValue: T, public readonly _shallow = false) {
    this._value = _shallow ? _rawValue : convert(_rawValue)
  }

  /**
   * 通过 get 方式 拦截返回，并收集依赖
   */
  get value() {
    // 收集依赖
    track(toRaw(this), TrackOpTypes.GET, 'value')
    return this._value
  }

  /**
   * 通过 set 方式 拦截修改，并触发响应
   * @param newVal
   */
  set value(newVal) {
    if (hasChanged(toRaw(newVal), this._rawValue)) {
      this._rawValue = newVal
      this._value = this._shallow ? newVal : convert(newVal)
      // 触发响应
      trigger(toRaw(this), TriggerOpTypes.SET, 'value', newVal)
    }
  }
}

/**
 * 创建ref实例
 * @param rawValue
 * @param shallow
 */
function createRef(rawValue: unknown, shallow = false) {
  // 如果已经是ref实例，则直接返回
  if (isRef(rawValue)) {
    return rawValue
  }
  return new RefImpl(rawValue, shallow)
}

/**
 * 触发ref响应
 * @param ref
 */
export function triggerRef(ref: Ref) {
  // toRaw获取代理对象的原始对象，因为ref是RefImpl实例，不是proxy代理对象，这里传的就是ref
  trigger(toRaw(ref), TriggerOpTypes.SET, 'value', __DEV__ ? ref.value : void 0)
}

/**
 * 获取ref对象的原始值
 * @param ref
 */
export function unref<T>(ref: T): T extends Ref<infer V> ? V : T {
  return isRef(ref) ? (ref.value as any) : ref
}

/**
 * proxy handler 用于proxyRefs方法创建proxy对象，解包RefImpl实例，在响应模块中暂未发现测试用例，这个等了解其他模块再注释
 */
const shallowUnwrapHandlers: ProxyHandler<any> = {
  get: (target, key, receiver) => unref(Reflect.get(target, key, receiver)),
  set: (target, key, value, receiver) => {
    const oldValue = target[key]
    if (isRef(oldValue) && !isRef(value)) {
      oldValue.value = value
      return true
    } else {
      return Reflect.set(target, key, value, receiver)
    }
  }
}

/**
 * ref实例代理
 * @param objectWithRefs
 */
export function proxyRefs<T extends object>(
  objectWithRefs: T
): ShallowUnwrapRef<T> {
  return isReactive(objectWithRefs)
    ? objectWithRefs
    : new Proxy(objectWithRefs, shallowUnwrapHandlers)
}

export type CustomRefFactory<T> = (
  track: () => void,
  trigger: () => void
) => {
  get: () => T
  set: (value: T) => void
}

/**
 * 自定义ref跟踪
 * @class CustomRefImpl
 * @example
  <input v-model="text" />
  function useDebouncedRef(value, delay = 200) {
  let timeout
    return customRef((track, trigger) => {
      return {
        get() {
          track()
          return value
        },
        set(newValue) {
          clearTimeout(timeout)
          timeout = setTimeout(() => {
            value = newValue
            trigger()
          }, delay)
        }
      }
    })
  }

  export default {
    setup() {
      return {
        text: useDebouncedRef('hello')
      }
    }
  }
 */
class CustomRefImpl<T> {
  private readonly _get: ReturnType<CustomRefFactory<T>>['get']
  private readonly _set: ReturnType<CustomRefFactory<T>>['set']

  public readonly __v_isRef = true

  constructor(factory: CustomRefFactory<T>) {
    const { get, set } = factory(
      () => track(this, TrackOpTypes.GET, 'value'),
      () => trigger(this, TriggerOpTypes.SET, 'value')
    )
    this._get = get
    this._set = set
  }

  get value() {
    return this._get()
  }

  set value(newVal) {
    this._set(newVal)
  }
}

/**
 * 创建自定义Ref实例
 * @param factory
 */
export function customRef<T>(factory: CustomRefFactory<T>): Ref<T> {
  return new CustomRefImpl(factory) as any
}

/**
 * 将object or array 转成ref对象
 * @param object
 */
export function toRefs<T extends object>(object: T): ToRefs<T> {
  // 如果不是响应对象，提示期望是响应对象，收到的是普通对象，这样不会出现响应
  if (__DEV__ && !isProxy(object)) {
    console.warn(`toRefs() expects a reactive object but received a plain one.`)
  }
  const ret: any = isArray(object) ? new Array(object.length) : {}
  for (const key in object) {
    // 调用toRef转成ObjectRefImpl实例
    ret[key] = toRef(object, key)
  }
  return ret
}

/**
 * 对象refclass，用于代理响应对象的属性转成ref实例，如果对象不是响应的，则ref无法做到响应
 * @class ObjectRefImpl
 * ps: 为啥不判断_object是否为proxy，如果不是则通过reactive创建响应对象，或者在创建的时候，直接用RefImpl实例化
 */
class ObjectRefImpl<T extends object, K extends keyof T> {
  public readonly __v_isRef = true

  constructor(private readonly _object: T, private readonly _key: K) {}

  get value() {
    // _object是reactive的会自动触发_object响应，如果不是，则无法响应
    return this._object[this._key]
  }

  set value(newVal) {
    // _object是reactive的会自动触发_object响应，如果不是，则无法响应
    this._object[this._key] = newVal
  }
}

/**
 * 将对象的一个属相转成ObjectRefImpl实例
 * @param object 对象
 * @param key 对象的属性key
 * ps: 为什么不判断object是否为proxy，如果不是则用RefImpl实例化，这样的会构成响应式对象，
 */
export function toRef<T extends object, K extends keyof T>(
  object: T,
  key: K
): ToRef<T[K]> {
  return isRef(object[key])
    ? object[key]
    : (new ObjectRefImpl(object, key) as any)
}

// corner case when use narrows type
// Ex. type RelativePath = string & { __brand: unknown }
// RelativePath extends object -> true
type BaseTypes = string | number | boolean

/**
 * This is a special exported interface for other packages to declare
 * additional types that should bail out for ref unwrapping. For example
 * \@vue/runtime-dom can declare it like so in its d.ts:
 *
 * ``` ts
 * declare module '@vue/reactivity' {
 *   export interface RefUnwrapBailTypes {
 *     runtimeDOMBailTypes: Node | Window
 *   }
 * }
 * ```
 *
 * Note that api-extractor somehow refuses to include `declare module`
 * augmentations in its generated d.ts, so we have to manually append them
 * to the final generated d.ts in our build process.
 */
export interface RefUnwrapBailTypes {}

export type ShallowUnwrapRef<T> = {
  [K in keyof T]: T[K] extends Ref<infer V> ? V : T[K]
}

export type UnwrapRef<T> = T extends Ref<infer V>
  ? UnwrapRefSimple<V>
  : UnwrapRefSimple<T>

type UnwrapRefSimple<T> = T extends
  | Function
  | CollectionTypes
  | BaseTypes
  | Ref
  | RefUnwrapBailTypes[keyof RefUnwrapBailTypes]
  ? T
  : T extends Array<any>
    ? { [K in keyof T]: UnwrapRefSimple<T[K]> }
    : T extends object ? UnwrappedObject<T> : T

// Extract all known symbols from an object
// when unwrapping Object the symbols are not `in keyof`, this should cover all the
// known symbols
type SymbolExtract<T> = (T extends { [Symbol.asyncIterator]: infer V }
  ? { [Symbol.asyncIterator]: V }
  : {}) &
  (T extends { [Symbol.hasInstance]: infer V }
    ? { [Symbol.hasInstance]: V }
    : {}) &
  (T extends { [Symbol.isConcatSpreadable]: infer V }
    ? { [Symbol.isConcatSpreadable]: V }
    : {}) &
  (T extends { [Symbol.iterator]: infer V } ? { [Symbol.iterator]: V } : {}) &
  (T extends { [Symbol.match]: infer V } ? { [Symbol.match]: V } : {}) &
  (T extends { [Symbol.matchAll]: infer V } ? { [Symbol.matchAll]: V } : {}) &
  (T extends { [Symbol.replace]: infer V } ? { [Symbol.replace]: V } : {}) &
  (T extends { [Symbol.search]: infer V } ? { [Symbol.search]: V } : {}) &
  (T extends { [Symbol.species]: infer V } ? { [Symbol.species]: V } : {}) &
  (T extends { [Symbol.split]: infer V } ? { [Symbol.split]: V } : {}) &
  (T extends { [Symbol.toPrimitive]: infer V }
    ? { [Symbol.toPrimitive]: V }
    : {}) &
  (T extends { [Symbol.toStringTag]: infer V }
    ? { [Symbol.toStringTag]: V }
    : {}) &
  (T extends { [Symbol.unscopables]: infer V }
    ? { [Symbol.unscopables]: V }
    : {})

type UnwrappedObject<T> = { [P in keyof T]: UnwrapRef<T[P]> } & SymbolExtract<T>

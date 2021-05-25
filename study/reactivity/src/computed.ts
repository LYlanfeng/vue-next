import { effect, ReactiveEffect, trigger, track } from './effect'
import { TriggerOpTypes, TrackOpTypes } from './operations'
import { Ref } from './ref'
import { isFunction, NOOP } from '@vue/shared'
import { ReactiveFlags, toRaw } from './reactive'

export interface ComputedRef<T = any> extends WritableComputedRef<T> {
  readonly value: T
}

export interface WritableComputedRef<T> extends Ref<T> {
  readonly effect: ReactiveEffect<T>
}

export type ComputedGetter<T> = (ctx?: any) => T
export type ComputedSetter<T> = (v: T) => void

export interface WritableComputedOptions<T> {
  get: ComputedGetter<T>
  set: ComputedSetter<T>
}

/**
 * 计算属性实现类
 */
class ComputedRefImpl<T> {
  private _value!: T
  // 是否需要执行effect重新获取值
  private _dirty = true

  public readonly effect: ReactiveEffect<T>

  // 是否是ref对象
  public readonly __v_isRef = true;
  // 是否只读
  public readonly [ReactiveFlags.IS_READONLY]: boolean

  constructor(
    getter: ComputedGetter<T>,
    private readonly _setter: ComputedSetter<T>,
    isReadonly: boolean
  ) {
    this.effect = effect(getter, {
      lazy: true, // 不用立即触发响应
      scheduler: () => {
        // 当gtter中响应触发，会执行schduler方法，设置dirty为true
        if (!this._dirty) {
          this._dirty = true
          // 触发本身响应，但是实际上这个不会执行任何实际逻辑代码
          trigger(toRaw(this), TriggerOpTypes.SET, 'value')
        }
      }
    })

    this[ReactiveFlags.IS_READONLY] = isReadonly
  }

  get value() {
    // the computed ref may get wrapped by other proxies e.g. readonly() #3376
    // 主要是处理通过readyonly二次代理之后的情况
    const self = toRaw(this)
    // 为真则触发一次响应，并将dirty设置为false，则get获取为缓存，不会执行响应操作
    if (self._dirty) {
      self._value = this.effect()
      self._dirty = false
    }
    // 收集依赖，但是实际上这个不会执行任何实际逻辑代码
    track(self, TrackOpTypes.GET, 'value')
    return self._value
  }

  set value(newValue: T) {
    // 调用setter方法取设置值
    this._setter(newValue)
  }
}

/**
 * 创建computed ref
 */
export function computed<T>(getter: ComputedGetter<T>): ComputedRef<T>
export function computed<T>(
  options: WritableComputedOptions<T>
): WritableComputedRef<T>
export function computed<T>(
  getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>
) {
  let getter: ComputedGetter<T>
  let setter: ComputedSetter<T>

  // 如果单独的function函数，转成getter方法
  if (isFunction(getterOrOptions)) {
    getter = getterOrOptions
    setter = __DEV__
      ? () => {
          console.warn('Write operation failed: computed value is readonly')
        }
      : NOOP
  } else {
    getter = getterOrOptions.get
    setter = getterOrOptions.set
  }

  /**
   * 通过get方法实例化ComputedRefImpl实例
   */
  return new ComputedRefImpl(
    getter,
    setter,
    isFunction(getterOrOptions) || !getterOrOptions.set
  ) as any
}

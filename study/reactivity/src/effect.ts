import { TrackOpTypes, TriggerOpTypes } from './operations'
import { EMPTY_OBJ, isArray, isIntegerKey, isMap } from '@vue/shared'

// The main WeakMap that stores {target -> key -> dep} connections.
// Conceptually, it's easier to think of a dependency as a Dep class
// which maintains a Set of subscribers, but we simply store them as
// raw Sets to reduce memory overhead.
type Dep = Set<ReactiveEffect>
type KeyToDepMap = Map<any, Dep>
// 全局依赖收集Map，key是依赖收集对象，value是依赖收集对象的属性Set集合
const targetMap = new WeakMap<any, KeyToDepMap>()

export interface ReactiveEffect<T = any> {
  (): T // 执行函数
  _isEffect: true // 是否是effect
  id: number // 序号
  active: boolean // 是否正在使用
  raw: () => T // effect执行的方法内容
  deps: Array<Dep> // 依赖对象
  options: ReactiveEffectOptions // 参数
  allowRecurse: boolean //
}

export interface ReactiveEffectOptions {
  lazy?: boolean // 是否延迟
  scheduler?: (job: ReactiveEffect) => void // 调度，拥有改方法，会执行该方法
  onTrack?: (event: DebuggerEvent) => void // ontrack监听方法
  onTrigger?: (event: DebuggerEvent) => void // onTrigger监听方法
  onStop?: () => void // onStop监听方法
  allowRecurse?: boolean
}

export type DebuggerEvent = {
  effect: ReactiveEffect
  target: object
  type: TrackOpTypes | TriggerOpTypes
  key: any
} & DebuggerEventExtraInfo

export interface DebuggerEventExtraInfo {
  newValue?: any
  oldValue?: any
  oldTarget?: Map<any, any> | Set<any>
}

// effect执行栈
const effectStack: ReactiveEffect[] = []
// 当前正在执行的effect
let activeEffect: ReactiveEffect | undefined

/**
 * 迭代依赖key
 */
export const ITERATE_KEY = Symbol(__DEV__ ? 'iterate' : '')
/**
 * 集合迭代依赖key
 */
export const MAP_KEY_ITERATE_KEY = Symbol(__DEV__ ? 'Map key iterate' : '')

/**
 * 判断是否是efffect
 * @param fn
 */
export function isEffect(fn: any): fn is ReactiveEffect {
  return fn && fn._isEffect === true
}

/**
 * 创建effect函数
 * @param fn 执行内容函数
 * @param options // 参数
 */
export function effect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions = EMPTY_OBJ
): ReactiveEffect<T> {
  if (isEffect(fn)) {
    fn = fn.raw
  }
  const effect = createReactiveEffect(fn, options)
  if (!options.lazy) {
    effect()
  }
  return effect
}

/**
 * 停止effect
 * @param effect
 */
export function stop(effect: ReactiveEffect) {
  if (effect.active) {
    cleanup(effect)
    if (effect.options.onStop) {
      effect.options.onStop()
    }
    effect.active = false
  }
}

let uid = 0

function createReactiveEffect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions
): ReactiveEffect<T> {
  const effect = function reactiveEffect(): unknown {
    if (!effect.active) {
      return options.scheduler ? undefined : fn()
    }
    if (!effectStack.includes(effect)) {
      cleanup(effect)
      try {
        enableTracking()
        effectStack.push(effect)
        activeEffect = effect
        return fn()
      } finally {
        effectStack.pop()
        resetTracking()
        activeEffect = effectStack[effectStack.length - 1]
      }
    }
  } as ReactiveEffect
  effect.id = uid++
  effect.allowRecurse = !!options.allowRecurse
  effect._isEffect = true
  effect.active = true
  effect.raw = fn
  effect.deps = []
  effect.options = options
  return effect
}

/**
 * 清理effect，在依赖集合中将自己删除
 * @param effect
 */
function cleanup(effect: ReactiveEffect) {
  const { deps } = effect
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      deps[i].delete(effect)
    }
    deps.length = 0
  }
}

// 是否需要收集依赖
let shouldTrack = true
// 是否需要依赖栈
const trackStack: boolean[] = []

/**
 * 暂停收集依赖，并保存之前是否需要收集依赖状态
 */
export function pauseTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = false
}

/**
 * 开启收集依赖，并保存之前是否需要收集依赖状态
 */
export function enableTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = true
}

/**
 * 重置上一级依赖收集状态
 */
export function resetTracking() {
  const last = trackStack.pop()
  shouldTrack = last === undefined ? true : last
}

/**
 * 收集依赖
 * @param target 目标对象
 * @param type 类型
 * @param key 对象的属性
 */
export function track(target: object, type: TrackOpTypes, key: unknown) {
  if (!shouldTrack || activeEffect === undefined) {
    return
  }
  let depsMap = targetMap.get(target)
  if (!depsMap) {
    targetMap.set(target, (depsMap = new Map()))
  }
  let dep = depsMap.get(key)
  if (!dep) {
    depsMap.set(key, (dep = new Set()))
  }
  if (!dep.has(activeEffect)) {
    // 添加当前执行effect
    dep.add(activeEffect)
    // 将当前依赖添置至effect，用于执行effect清除
    activeEffect.deps.push(dep)
    if (__DEV__ && activeEffect.options.onTrack) {
      activeEffect.options.onTrack({
        effect: activeEffect,
        target,
        type,
        key
      })
    }
  }
}

/**
 * 触发响应
 * @param target 触发目标对象
 * @param type 类型
 * @param key 触发目标对象属性
 * @param newValue 新值
 * @param oldValue 旧值
 * @param oldTarget 暂时未发现具体作用 TODO
 */
export function trigger(
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  newValue?: unknown,
  oldValue?: unknown,
  oldTarget?: Map<unknown, unknown> | Set<unknown>
) {
  const depsMap = targetMap.get(target)
  if (!depsMap) {
    // never been tracked
    return
  }

  const effects = new Set<ReactiveEffect>()
  const add = (effectsToAdd: Set<ReactiveEffect> | undefined) => {
    if (effectsToAdd) {
      effectsToAdd.forEach(effect => {
        // effect === activeEffect 的时候会生成死循环
        if (effect !== activeEffect || effect.allowRecurse) {
          effects.add(effect)
        }
      })
    }
  }

  if (type === TriggerOpTypes.CLEAR) {
    // collection being cleared
    // trigger all effects for target
    // 所有依赖将会清除
    depsMap.forEach(add)
  } else if (key === 'length' && isArray(target)) {
    // 数据对象，仅key === 'length'会执行
    depsMap.forEach((dep, key) => {
      if (key === 'length' || key >= (newValue as number)) {
        add(dep)
      }
    })
  } else {
    // schedule runs for SET | ADD | DELETE
    if (key !== void 0) {
      add(depsMap.get(key)) // 添加该属性的依赖effect
    }

    // also run for iteration key on ADD | DELETE | Map.SET
    // 添加迭代依赖effect: ITERATE_KEY: 普通对象的迭代effect，MAP_KEY_ITERATE_KEY；集合对象的迭代effect
    switch (type) {
      case TriggerOpTypes.ADD:
        if (!isArray(target)) {
          add(depsMap.get(ITERATE_KEY))
          if (isMap(target)) {
            add(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        } else if (isIntegerKey(key)) {
          // new index added to array -> length changes
          // 数组下标访问则触发数组length effect
          add(depsMap.get('length'))
        }
        break
      case TriggerOpTypes.DELETE:
        if (!isArray(target)) {
          add(depsMap.get(ITERATE_KEY))
          if (isMap(target)) {
            add(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        }
        break
      case TriggerOpTypes.SET:
        if (isMap(target)) {
          add(depsMap.get(ITERATE_KEY))
        }
        break
    }
  }

  const run = (effect: ReactiveEffect) => {
    if (__DEV__ && effect.options.onTrigger) {
      effect.options.onTrigger({
        effect,
        target,
        key,
        type,
        newValue,
        oldValue,
        oldTarget
      })
    }
    if (effect.options.scheduler) {
      effect.options.scheduler(effect)
    } else {
      effect()
    }
  }

  effects.forEach(run)
}

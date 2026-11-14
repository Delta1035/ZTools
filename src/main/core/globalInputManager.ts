import type { EventEmitter } from 'events'
import type { UiohookKeyboardEvent, UiohookMouseEvent, UiohookWheelEvent } from 'uiohook-napi'

type UiohookModule = typeof import('uiohook-napi')
type Uiohook = UiohookModule['uIOhook']

type GlobalInputEventMap = {
  input: UiohookKeyboardEvent | UiohookMouseEvent | UiohookWheelEvent
  keydown: UiohookKeyboardEvent
  keyup: UiohookKeyboardEvent
  mousedown: UiohookMouseEvent
  mouseup: UiohookMouseEvent
  mousemove: UiohookMouseEvent
  click: UiohookMouseEvent
  wheel: UiohookWheelEvent
}

// uiohook-napi 是原生扩展（Linux 下链接 libX11/libXtst）。顶层静态 import 会让
// 加载失败（未编译、ABI 不匹配）直接拖垮主进程启动，故改为惰性 require：
// 失败只降级依赖全局输入的功能。
let uiohookModule: UiohookModule | null = null
let loadAttempted = false

/**
 * 惰性加载 uiohook-napi 原生模块。
 *
 * @returns 原生模块实例；加载失败或不可用时返回 null，不抛异常。
 */
function loadUiohook(): UiohookModule | null {
  if (loadAttempted) return uiohookModule
  loadAttempted = true

  try {
    // 主进程产物是 CJS，通过 require 动态捕获可能发生的原生链接异常
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    uiohookModule = require('uiohook-napi') as UiohookModule
  } catch (error) {
    console.warn('[GlobalInput] uiohook-napi 加载失败，全局输入功能已降级:', error)
  }

  return uiohookModule
}

/**
 * 获取底层 uIOhook 单例对象。
 *
 * @returns uIOhook 实例；原生模块缺失时返回 null。
 */
function getHook(): Uiohook | null {
  return loadUiohook()?.uIOhook ?? null
}

/**
 * 注入 uiohook 模块替身（仅供测试环境使用）。
 *
 * @param mod 替身模块；传 null 表示模拟原生模块不可用状态。
 * @returns 无返回值。
 */
export function setUiohookModuleForTesting(mod: UiohookModule | null): void {
  uiohookModule = mod
  loadAttempted = true
}

/**
 * 获取 uiohook 的修饰键 keycode 与标准名称映射。
 *
 * @returns keycode 到修饰键名称的映射字典；模块不可用时返回空对象。
 */
export function getModifierKeycodes(): Record<number, string> {
  const keys = loadUiohook()?.UiohookKey
  if (!keys) return {}

  return {
    [keys.Meta]: 'Command',
    [keys.MetaRight]: 'Command',
    [keys.Ctrl]: 'Ctrl',
    [keys.CtrlRight]: 'Ctrl',
    [keys.Alt]: 'Alt',
    [keys.AltRight]: 'Alt',
    [keys.Shift]: 'Shift',
    [keys.ShiftRight]: 'Shift'
  }
}

class GlobalInputManager {
  // uIOhook 是进程级单例。用 consumer 引用计数管理 start/stop，避免一个模块 stop 掉其他模块的监听。
  private consumers = new Set<string>()
  // listener 按 consumer 归属记录，release 时只 off 当前模块注册的事件。
  private listenersByConsumer = new Map<
    string,
    Array<{
      event: keyof GlobalInputEventMap
      listener: (...args: unknown[]) => void
    }>
  >()
  private started = false

  /**
   * 注册指定消费者的全局输入事件监听。
   *
   * @param consumer 消费者标识。
   * @param event 事件名称。
   * @param listener 事件回调函数。
   * @returns 无返回值。
   */
  public on<K extends keyof GlobalInputEventMap>(
    consumer: string,
    event: K,
    listener: (event: GlobalInputEventMap[K]) => void
  ): void {
    const eventListener = listener as (...args: unknown[]) => void
    const hook = getHook()

    // 原生模块不可用时仍登记消费记录，保证生命周期对称
    if (hook) {
      ;(hook as unknown as EventEmitter).on(event, eventListener)
    }

    const listeners = this.listenersByConsumer.get(consumer) ?? []
    listeners.push({ event, listener: eventListener })
    this.listenersByConsumer.set(consumer, listeners)
  }

  /**
   * 为消费者获取全局输入监听权限并按需启动底层监听。
   *
   * @param consumer 申请监听权限的消费者标识。
   * @returns 成功启动或复用返回 true，底层不可用或启动失败返回 false。
   */
  public acquire(consumer: string): boolean {
    const hook = getHook()
    if (!hook) return false

    this.consumers.add(consumer)
    if (this.started) return true

    try {
      hook.start()
      this.started = true
      console.log('[GlobalInput] 全局输入监听已启动')
      return true
    } catch (error) {
      this.consumers.delete(consumer)
      console.error('[GlobalInput] 启动全局输入监听失败:', error)
      return false
    }
  }

  /**
   * 释放消费者的全局输入监听权限并在无活动消费者时停止底层监听。
   *
   * @param consumer 释放权限的消费者标识。
   * @returns 无返回值。
   */
  public release(consumer: string): void {
    const hook = getHook()
    const listeners = this.listenersByConsumer.get(consumer) ?? []

    // 移除当前消费者注册的事件回调
    if (hook) {
      for (const { event, listener } of listeners) {
        ;(hook as unknown as EventEmitter).off(event, listener)
      }
    }
    this.listenersByConsumer.delete(consumer)

    this.consumers.delete(consumer)
    // 仍有其他模块依赖全局输入时，不能停止底层 uIOhook。
    if (!this.started || this.consumers.size > 0) return

    try {
      if (hook) {
        hook.stop()
        console.log('[GlobalInput] 全局输入监听已停止')
      }
    } catch (error) {
      console.error('[GlobalInput] 停止全局输入监听失败:', error)
    } finally {
      this.started = false
    }
  }
}

export default new GlobalInputManager()

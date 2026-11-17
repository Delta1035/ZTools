import type { Session } from 'electron'

interface PreloadRegistration {
  filePath: string
  id: string
}

const sessionRegistrations = new WeakMap<Session, Map<string, PreloadRegistration>>()

/**
 * 为插件主视图与独立窗口使用的共享 Session 注册宿主 preload。
 * @param session 当前插件 Session。
 * @param filePath 宿主 preload 的绝对路径。
 * @param scope 当前 preload 在 Session 中的稳定作用域。
 * @returns 已注册 preload 的 ID。
 * @throws Electron 查询或注册 Session preload 失败时抛出原始错误。
 */
export function ensurePluginSessionPreload(
  session: Session,
  filePath: string,
  scope = filePath
): string {
  const registrations = sessionRegistrations.get(session) ?? new Map<string, PreloadRegistration>()
  sessionRegistrations.set(session, registrations)
  const previous = registrations.get(scope)

  // 插件升级后路径可能变化，先移除同一作用域的旧脚本，避免两个 preload 同时执行。
  if (previous && previous.filePath !== filePath) {
    session.unregisterPreloadScript(previous.id)
    registrations.delete(scope)
  }

  // 同一 Session 会被主视图、独立窗口和重建流程复用，避免每次创建都追加脚本。
  const registered = session
    .getPreloadScripts()
    .find((script) => script.type === 'frame' && script.filePath === filePath)
  const id = registered?.id ?? session.registerPreloadScript({ type: 'frame', filePath })
  registrations.set(scope, { filePath, id })
  return id
}

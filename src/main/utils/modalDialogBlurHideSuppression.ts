const DEFAULT_RELEASE_DELAY_MS = 500

/**
 * 管理原生模态对话框期间的窗口失焦隐藏抑制。
 * 对话框结束后延迟释放，过滤操作系统排队的 blur 事件。
 */
class ModalDialogBlurHideSuppression {
  private suppressed = false
  private releaseTimer: ReturnType<typeof setTimeout> | null = null
  private depth = 0

  /**
   * 判断当前是否处于模态对话框抑制状态。
   * @returns 处于抑制状态时返回 true。
   */
  public isSuppressed(): boolean {
    return this.suppressed
  }

  /**
   * 在回调执行期间抑制窗口失焦隐藏，并在回调结束后释放状态。
   * @param callback 需要在模态对话框保护下执行的回调。
   * @param releaseDelayMs 对话框结束后延迟释放抑制的毫秒数。
   * @returns 回调的同步结果或异步结果。
   * @throws 回调抛出的异常会在清理抑制状态后继续抛出。
   */
  public withSuppressed<T>(
    callback: () => T | PromiseLike<T>,
    releaseDelayMs: number = DEFAULT_RELEASE_DELAY_MS
  ): T | Promise<T> {
    // 进入模态阶段前取消上一次尚未执行的释放，保证嵌套调用连续受保护。
    this.begin()
    try {
      const result = callback()
      if (this.isPromiseLike(result)) {
        return Promise.resolve(result).finally(() => {
          // 异步对话框成功、取消或异常结束后统一释放状态。
          this.end(releaseDelayMs)
        })
      }

      // 同步回调也必须走相同的释放路径。
      this.end(releaseDelayMs)
      return result
    } catch (error) {
      // 回调同步抛错时立即进入清理流程，再保留原始异常语义。
      this.end(releaseDelayMs)
      throw error
    }
  }

  /**
   * 在同步模态对话框期间抑制窗口失焦隐藏。
   * @param callback 必须同步返回的回调。
   * @param releaseDelayMs 对话框结束后延迟释放抑制的毫秒数。
   * @returns 回调的同步结果。
   * @throws 回调返回 Promise 或主动抛错时抛出异常。
   */
  public withSuppressedSync<T>(callback: () => T, releaseDelayMs?: number): T {
    // 同步调用也先进入保护状态，避免回调触发的 blur 立即隐藏窗口。
    this.begin()
    let released = false
    try {
      const result = callback()
      if (this.isPromiseLike(result)) {
        // 同步接口拒绝异步回调，并立即释放已经建立的保护状态。
        this.end(releaseDelayMs ?? DEFAULT_RELEASE_DELAY_MS)
        released = true
        throw new TypeError('withBlurHideSuppressedSync callback must not return a Promise')
      }

      // 同步回调完成后安排延迟释放，过滤排队的系统事件。
      this.end(releaseDelayMs ?? DEFAULT_RELEASE_DELAY_MS)
      released = true
      return result
    } catch (error) {
      // 回调抛错时仍然释放保护状态，再继续抛出原始异常。
      if (!released) {
        this.end(releaseDelayMs ?? DEFAULT_RELEASE_DELAY_MS)
      }
      throw error
    }
  }

  /**
   * 判断值是否实现 Promise-like 接口。
   * @param value 待判断的回调结果。
   * @returns 实现 then 方法时返回 true。
   */
  private isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
    return (
      value !== null &&
      (typeof value === 'object' || typeof value === 'function') &&
      typeof (value as { then?: unknown }).then === 'function'
    )
  }

  /**
   * 增加模态对话框嵌套深度并标记抑制状态。
   * @returns 无返回值。
   */
  private begin(): void {
    if (this.releaseTimer) {
      clearTimeout(this.releaseTimer)
      this.releaseTimer = null
    }

    this.depth += 1
    this.suppressed = true
  }

  /**
   * 减少模态对话框嵌套深度并安排延迟释放。
   * @param releaseDelayMs 对话框结束后延迟释放的毫秒数。
   * @returns 无返回值。
   */
  private end(releaseDelayMs: number): void {
    this.depth = Math.max(0, this.depth - 1)
    if (this.depth > 0) return

    if (this.releaseTimer) {
      clearTimeout(this.releaseTimer)
    }

    this.releaseTimer = setTimeout(() => {
      this.suppressed = false
      this.releaseTimer = null
    }, releaseDelayMs)
  }
}

export default new ModalDialogBlurHideSuppression()

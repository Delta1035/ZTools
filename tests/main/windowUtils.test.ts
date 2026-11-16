import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const showOpenDialog = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  dialog: { showOpenDialog },
  BrowserWindow: class BrowserWindow {}
}))

import { openDialog } from '../../src/main/utils/windowUtils'
import modalDialogBlurHideSuppression from '../../src/main/utils/modalDialogBlurHideSuppression'

describe('openDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    showOpenDialog.mockReset()
  })

  afterEach(() => {
    vi.runAllTimers()
    vi.useRealTimers()
  })

  it('在原生对话框等待期间抑制失焦隐藏，并返回所选文件', async () => {
    let resolveDialog: ((value: Electron.OpenDialogReturnValue) => void) | undefined
    showOpenDialog.mockImplementation(
      () =>
        new Promise<Electron.OpenDialogReturnValue>((resolve) => {
          resolveDialog = resolve
        })
    )
    const parentWindow = {
      isDestroyed: vi.fn(() => false),
      show: vi.fn()
    } as unknown as Electron.BrowserWindow

    const resultPromise = openDialog(parentWindow, { properties: ['openFile'] }, '未选择文件')

    expect(modalDialogBlurHideSuppression.isSuppressed()).toBe(true)
    expect(showOpenDialog).toHaveBeenCalledWith(parentWindow, { properties: ['openFile'] })

    resolveDialog?.({ canceled: false, filePaths: ['/tmp/avatar.png'] })
    await expect(resultPromise).resolves.toEqual({
      success: true,
      data: { canceled: false, filePaths: ['/tmp/avatar.png'] }
    })
    expect(parentWindow.show).toHaveBeenCalledOnce()

    vi.advanceTimersByTime(499)
    expect(modalDialogBlurHideSuppression.isSuppressed()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(modalDialogBlurHideSuppression.isSuppressed()).toBe(false)
  })

  it('原生对话框异常时也会释放失焦隐藏抑制', async () => {
    const error = new Error('dialog failed')
    showOpenDialog.mockRejectedValue(error)
    const parentWindow = {
      isDestroyed: vi.fn(() => false),
      show: vi.fn()
    } as unknown as Electron.BrowserWindow

    await expect(openDialog(parentWindow, { properties: ['openFile'] }, '未选择文件')).rejects.toBe(
      error
    )

    expect(modalDialogBlurHideSuppression.isSuppressed()).toBe(true)
    vi.advanceTimersByTime(500)
    expect(modalDialogBlurHideSuppression.isSuppressed()).toBe(false)
    expect(parentWindow.show).not.toHaveBeenCalled()
  })
})

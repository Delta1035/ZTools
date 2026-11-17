import { ref } from 'vue'

export const recordedTime = ref('00:00:00')

let recordSeconds = 0
let recordTimer: ReturnType<typeof setInterval> | null = null
let countdownTimer: ReturnType<typeof setInterval> | null = null

/**
 * 将录制秒数格式化为时分秒。
 * @param seconds 需要格式化的秒数。
 * @returns 固定为 HH:MM:SS 的时间字符串。
 */
function formatSeconds(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = Math.floor(seconds % 60)
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, '0')).join(':')
}

/**
 * 开始更新录制时长。
 * @returns 无返回值。
 */
export function startRecordTimer(): void {
  stopRecordTimer()
  recordSeconds = 0
  recordTimer = setInterval(() => {
    recordSeconds += 1
    recordedTime.value = formatSeconds(recordSeconds)
  }, 1000)
}

/**
 * 暂停录制时长计时，但保留当前累计值。
 * @returns 无返回值。
 */
export function pauseRecordTimer(): void {
  if (recordTimer) clearInterval(recordTimer)
  recordTimer = null
}

/**
 * 恢复录制时长计时。
 * @returns 无返回值。
 */
export function resumeRecordTimer(): void {
  pauseRecordTimer()
  recordTimer = setInterval(() => {
    recordSeconds += 1
    recordedTime.value = formatSeconds(recordSeconds)
  }, 1000)
}

/**
 * 停止并重置录制时长计时。
 * @returns 无返回值。
 */
export function stopRecordTimer(): void {
  if (recordTimer) clearInterval(recordTimer)
  recordTimer = null
  recordSeconds = 0
  recordedTime.value = '00:00:00'
}

/**
 * 执行开始录制前的倒计时。
 * @param seconds 倒计时秒数。
 * @param onTick 每秒减少一次时调用的回调。
 * @returns 倒计时结束后 resolve 的 Promise。
 */
export function runCountdown(seconds: number, onTick: (remaining: number) => void): Promise<void> {
  if (countdownTimer) clearInterval(countdownTimer)
  if (seconds <= 0) return Promise.resolve()

  return new Promise((resolve) => {
    let remaining = seconds
    onTick(remaining)
    countdownTimer = setInterval(() => {
      remaining -= 1
      onTick(remaining)
      if (remaining <= 0) {
        if (countdownTimer) clearInterval(countdownTimer)
        countdownTimer = null
        resolve()
      }
    }, 1000)
  })
}

/**
 * 取消正在进行的录制倒计时。
 * @returns 无返回值。
 */
export function cancelCountdown(): void {
  if (countdownTimer) clearInterval(countdownTimer)
  countdownTimer = null
}

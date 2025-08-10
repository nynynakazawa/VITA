// BaseLogic.javaのTypeScript版
// PPG処理の基底クラス

import { LogicResult, LogicProcessor } from './types'

export abstract class BaseLogic implements LogicProcessor {
  // 定数（Java版と同じ値）
  protected static readonly GREEN_VALUE_WINDOW_SIZE = 20
  protected static readonly CORRECTED_GREEN_VALUE_WINDOW_SIZE = 20
  protected static readonly WINDOW_SIZE = 240
  protected static readonly BPM_HISTORY_SIZE = 20
  protected static readonly REFRACTORY_FRAMES = 8

  // 状態変数
  protected greenValues: number[] = []
  protected recentGreenValues: number[] = []
  protected recentCorrectedGreenValues: number[] = []
  protected smoothedCorrectedGreenValues: number[] = []
  protected window: number[] = new Array(BaseLogic.WINDOW_SIZE).fill(0)
  protected windowIndex = 0
  protected bpmHistory: number[] = []
  protected lastPeakTime = 0
  protected framesSinceLastPeak = BaseLogic.REFRACTORY_FRAMES
  protected bpmValue = 0
  protected IBI = 0

  // Peak/Valley analytics for BP estimation
  protected averageValleyToPeakRelTTP = 0
  protected averagePeakToValleyRelTTP = 0
  protected averageValleyToPeakAmplitude = 0
  protected averagePeakToValleyAmplitude = 0
  protected averageAI = 0

  // スムージング用
  protected smoothedIbis: number[] = []
  protected lastSmoothedIbi = 0

  abstract processGreenValueData(avgG: number): LogicResult

  calculateSmoothedValueRealTime(ibi: number, bpmSd: number): void {
    if (this.smoothedIbis.length >= 10) {
      this.smoothedIbis.shift()
    }
    this.smoothedIbis.push(ibi)
    
    if (this.smoothedIbis.length > 0) {
      this.lastSmoothedIbi = this.smoothedIbis.reduce((a, b) => a + b) / this.smoothedIbis.length
    }
  }

  getLastSmoothedIbi(): number {
    return this.lastSmoothedIbi
  }

  // 心拍検出アルゴリズム（Java版と同じ）
  protected detectHeartRate(): void {
    if (this.smoothedCorrectedGreenValues.length < 10) return

    const currentTime = Date.now()
    const currentValue = this.smoothedCorrectedGreenValues[this.smoothedCorrectedGreenValues.length - 1]
    const prevValue = this.smoothedCorrectedGreenValues[this.smoothedCorrectedGreenValues.length - 2]
    const prevPrevValue = this.smoothedCorrectedGreenValues[this.smoothedCorrectedGreenValues.length - 3]

    // ピーク検出（前の値より大きく、次の値より大きい）
    if (prevValue > prevPrevValue && prevValue > currentValue && this.framesSinceLastPeak >= BaseLogic.REFRACTORY_FRAMES) {
      if (this.lastPeakTime > 0) {
        const timeDiff = currentTime - this.lastPeakTime
        if (timeDiff > 300 && timeDiff < 2000) { // 30-200 BPMの範囲
          const bpm = 60000 / timeDiff // ms to BPM
          
          if (this.bpmHistory.length >= BaseLogic.BPM_HISTORY_SIZE) {
            this.bpmHistory.shift()
          }
          this.bpmHistory.push(bpm)
          
          if (this.bpmHistory.length > 0) {
            this.bpmValue = this.bpmHistory.reduce((a, b) => a + b) / this.bpmHistory.length
            this.IBI = (60.0 / this.bpmValue) * 1000.0
          }
        }
      }
      this.lastPeakTime = currentTime
    }
    this.framesSinceLastPeak++
  }

  // 標準偏差計算
  protected standardDeviation(values: number[]): number {
    if (values.length === 0) return 0
    const mean = values.reduce((a, b) => a + b) / values.length
    const squareSum = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0)
    return Math.sqrt(squareSum / values.length)
  }

  // リセット機能
  reset(): void {
    this.greenValues = []
    this.recentGreenValues = []
    this.recentCorrectedGreenValues = []
    this.smoothedCorrectedGreenValues = []
    this.window.fill(0)
    this.windowIndex = 0
    this.bpmHistory = []
    this.lastPeakTime = 0
    this.framesSinceLastPeak = BaseLogic.REFRACTORY_FRAMES
    this.bpmValue = 0
    this.IBI = 0
    this.smoothedIbis = []
    this.lastSmoothedIbi = 0
    
    // Reset analytics
    this.averageValleyToPeakRelTTP = 0
    this.averagePeakToValleyRelTTP = 0
    this.averageValleyToPeakAmplitude = 0
    this.averagePeakToValleyAmplitude = 0
    this.averageAI = 0
  }

  // Public getters for protected properties
  getAverageValleyToPeakRelTTP(): number {
    return this.averageValleyToPeakRelTTP
  }

  getAveragePeakToValleyRelTTP(): number {
    return this.averagePeakToValleyRelTTP
  }

  getAverageValleyToPeakAmplitude(): number {
    return this.averageValleyToPeakAmplitude
  }

  getAveragePeakToValleyAmplitude(): number {
    return this.averagePeakToValleyAmplitude
  }

  getAverageAI(): number {
    return this.averageAI
  }
}
// Logic1.javaのTypeScript版
// PPG処理のLogic1アルゴリズム

import { BaseLogic } from './BaseLogic'
import { LogicResult } from './types'

export class Logic1 extends BaseLogic {
  processGreenValueData(avgG: number): LogicResult {
    // Logic1特有の処理（smoothingWindowSize1=6, correctedGreenValue*3 など）
    this.greenValues.push(avgG)
    
    if (this.recentGreenValues.length >= BaseLogic.GREEN_VALUE_WINDOW_SIZE) {
      this.recentGreenValues.shift()
    }
    this.recentGreenValues.push(avgG)
    
    const latestGreenValue = this.greenValues[this.greenValues.length - 1] % 30
    const hundGreenValue = (latestGreenValue / 30.0) * 100.0
    const correctedGreenValue = hundGreenValue * 3
    
    if (this.recentCorrectedGreenValues.length >= BaseLogic.CORRECTED_GREEN_VALUE_WINDOW_SIZE) {
      this.recentCorrectedGreenValues.shift()
    }
    this.recentCorrectedGreenValues.push(correctedGreenValue)
    
    if (this.recentCorrectedGreenValues.length >= BaseLogic.CORRECTED_GREEN_VALUE_WINDOW_SIZE) {
      // 第1段階スムージング（Logic1: windowSize=6）
      let smoothedCorrectedGreenValue = 0.0
      const smoothingWindowSize1 = 6
      
      for (let i = 0; i < smoothingWindowSize1; i++) {
        const index = this.recentCorrectedGreenValues.length - 1 - i
        if (index >= 0) {
          smoothedCorrectedGreenValue += this.recentCorrectedGreenValues[index]
        }
      }
      smoothedCorrectedGreenValue /= Math.min(smoothingWindowSize1, this.recentCorrectedGreenValues.length)
      
      if (this.smoothedCorrectedGreenValues.length >= BaseLogic.CORRECTED_GREEN_VALUE_WINDOW_SIZE) {
        this.smoothedCorrectedGreenValues.shift()
      }
      this.smoothedCorrectedGreenValues.push(smoothedCorrectedGreenValue)
      
      // 第2段階スムージング（Logic1: windowSize=4）
      let twiceSmoothedValue = 0.0
      const smoothingWindowSize2 = 4
      
      for (let i = 0; i < smoothingWindowSize2; i++) {
        const index = this.smoothedCorrectedGreenValues.length - 1 - i
        if (index >= 0) {
          twiceSmoothedValue += this.smoothedCorrectedGreenValues[index]
        }
      }
      twiceSmoothedValue /= Math.min(smoothingWindowSize2, this.smoothedCorrectedGreenValues.length)
      
      // ウィンドウバッファに平滑化された値を格納
      this.window[this.windowIndex] = twiceSmoothedValue
      this.windowIndex = (this.windowIndex + 1) % BaseLogic.WINDOW_SIZE
      
      // 心拍検出
      this.detectHeartRate()
      
      // 平滑化された値をreturn
      return {
        correctedGreenValue: twiceSmoothedValue,
        ibi: this.IBI,
        heartRate: this.bpmValue,
        bpmSd: this.standardDeviation(this.bpmHistory)
      }
    }
    
    // 十分なデータがない場合は元の値をreturn
    return {
      correctedGreenValue,
      ibi: this.IBI,
      heartRate: this.bpmValue,
      bpmSd: this.standardDeviation(this.bpmHistory)
    }
  }
}
// PPG処理の型定義（RealTimeIBICのJavaクラスに対応）

export interface LogicResult {
  correctedGreenValue: number
  ibi: number
  heartRate: number
  bpmSd: number
}

export interface LogicProcessor {
  processGreenValueData(avgG: number): LogicResult
  calculateSmoothedValueRealTime(ibi: number, bpmSd: number): void
  getLastSmoothedIbi(): number
}

export type PpgMode = 'Logic1' | 'Logic2'

export interface PpgResult extends LogicResult {
  // RealtimeBPで使用される追加のアナリティクス
  v2pRelTTP: number
  p2vRelTTP: number
  v2pAmplitude: number
  p2vAmplitude: number
}
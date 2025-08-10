// TypeScript版RealtimeBP
// Photoplethysmography (PPG) の形態学的特徴量を用いたリアルタイム血圧推定器

import { BaseLogic } from './BaseLogic'

/**
 * 血圧推定結果のインターフェース
 */
export interface BPResult {
  sbp: number
  dbp: number
  sbpAvg: number
  dbpAvg: number
}

/**
 * 血圧推定リスナーのインターフェース
 */
export interface BPListener {
  onBpUpdated(sbp: number, dbp: number, sbpAvg: number, dbpAvg: number): void
}

/**
 * リアルタイム血圧推定クラス
 */
export class RealtimeBP {
  // 定数
  private static readonly AVG_BEATS = 10

  // 血圧履歴
  private sbpHist: number[] = []
  private dbpHist: number[] = []

  // ISO関連
  private currentISO = 600
  private isDetectionEnabled = true
  private lastValidHr = 0.0

  // フレームレート
  private frameRate = 30

  // 連続検出システム
  private lastUpdateTime = 0

  // リスナー
  private listener: BPListener | null = null

  // 最新値の保持
  private lastSbp = 0.0
  private lastDbp = 0.0
  private lastSbpAvg = 0.0
  private lastDbpAvg = 0.0
  private lastAiRaw = 0.0
  private lastAiAt75 = 0.0
  private lastAiRawPct = 0.0
  private lastAiAt75Pct = 0.0
  private lastRelTTP = 0.0
  private lastValleyToPeakRelTTP = 0.0
  private lastPeakToValleyRelTTP = 0.0

  // 回帰係数
  private static readonly AI_HR_SLOPE_PCT_PER_BPM = -0.39
  
  // SBP回帰係数
  private static readonly C0 = 80
  private static readonly C1 = 0.5
  private static readonly C2 = 0.1
  private static readonly C4 = 0.001
  private static readonly C5 = -5
  private static readonly C6 = 0.1
  private static readonly C7 = -0.1
  
  // DBP回帰係数
  private static readonly D0 = 60
  private static readonly D1 = 0.3
  private static readonly D2 = 0.05
  private static readonly D4 = 0.0005
  private static readonly D5 = -2
  private static readonly D6 = 0.05
  private static readonly D7 = -0.05

  // BaseLogicの参照
  private logicRef: BaseLogic | null = null

  /**
   * フレームレートを設定
   */
  setFrameRate(fps: number): void {
    this.frameRate = fps
    console.log(`[RealtimeBP] frameRate updated: ${fps}`)
  }

  /**
   * リスナーを設定
   */
  setListener(listener: BPListener): void {
    this.listener = listener
  }

  /**
   * ISO値を更新
   */
  updateISO(iso: number): void {
    this.currentISO = iso
  }

  /**
   * BaseLogicの参照を設定
   */
  setLogicRef(logic: BaseLogic): void {
    this.logicRef = logic
    console.log('[RealtimeBP] setLogicRef called')
    
    // 連続検出のコールバックを設定
    if (logic) {
      // TypeScriptでは直接的なコールバック設定は実装に依存
      // 必要に応じてBaseLogicクラスにコールバック機能を追加
    }
  }

  /**
   * 血圧推定のメイン処理
   */
  processBeatData(
    correctedGreenValue: number,
    ibi: number,
    heartRate: number,
    bpmSd: number
  ): BPResult {
    // ISOチェック
    if (this.currentISO < 500) {
      console.log(`[RealtimeBP] Blood pressure estimation skipped: ISO=${this.currentISO}`)
      return {
        sbp: this.lastSbp,
        dbp: this.lastDbp,
        sbpAvg: this.lastSbpAvg,
        dbpAvg: this.lastDbpAvg
      }
    }

    console.log('[RealtimeBP] === processBeatData START ===')
    console.log(`[RealtimeBP] Input: ibi=${ibi}, hr=${heartRate}`)

    // BaseLogicから最新の平均値を取得
    const valleyToPeakRelTTP = this.logicRef?.getAverageValleyToPeakRelTTP() || 0.0
    const peakToValleyRelTTP = this.logicRef?.getAveragePeakToValleyRelTTP() || 0.0
    const averageAI = this.logicRef?.getAverageAI() || 0.0

    // ローカル変数に保存
    this.lastValleyToPeakRelTTP = valleyToPeakRelTTP
    this.lastPeakToValleyRelTTP = peakToValleyRelTTP
    this.lastAiAt75 = averageAI

    console.log(`[RealtimeBP] BaseLogic values: V2P_relTTP=${valleyToPeakRelTTP.toFixed(3)}, P2V_relTTP=${peakToValleyRelTTP.toFixed(3)}, AI=${averageAI.toFixed(3)}%`)

    // 心拍数の計算
    let hr = heartRate
    if (this.logicRef && this.logicRef.getLastSmoothedIbi() > 0) {
      hr = 60000.0 / this.logicRef.getLastSmoothedIbi()
    } else if (ibi > 0) {
      hr = 60000.0 / ibi
    }

    // 有効なHR値を保存
    if (hr > 0) {
      this.lastValidHr = hr
    }

    const isoNorm = this.currentISO / 600.0
    const isoDev = isoNorm - 1.0

    // Sピーク値の取得
    const sPeak = this.logicRef?.getAverageValleyToPeakAmplitude() || 0.0
    const sNorm = sPeak * isoNorm

    // 回帰式による血圧推定
    const sbp = RealtimeBP.C0 + RealtimeBP.C1 * this.lastAiAt75 + RealtimeBP.C2 * hr + 
                RealtimeBP.C4 * sNorm + RealtimeBP.C5 * isoDev +
                RealtimeBP.C6 * this.lastValleyToPeakRelTTP + RealtimeBP.C7 * this.lastPeakToValleyRelTTP

    const dbp = RealtimeBP.D0 + RealtimeBP.D1 * this.lastAiAt75 + RealtimeBP.D2 * hr + 
                RealtimeBP.D4 * sNorm + RealtimeBP.D5 * isoDev +
                RealtimeBP.D6 * this.lastValleyToPeakRelTTP + RealtimeBP.D7 * this.lastPeakToValleyRelTTP

    console.log(`[RealtimeBP] RawBP: SBP=${sbp.toFixed(2)}, DBP=${dbp.toFixed(2)}`)

    // 範囲制限
    const clampedSbp = this.clamp(sbp, 60, 200)
    const clampedDbp = this.clamp(dbp, 40, 150)

    // 保存と平均計算
    this.lastSbp = clampedSbp
    this.lastDbp = clampedDbp
    
    this.sbpHist.push(clampedSbp)
    if (this.sbpHist.length > RealtimeBP.AVG_BEATS) {
      this.sbpHist.shift()
    }
    
    this.dbpHist.push(clampedDbp)
    if (this.dbpHist.length > RealtimeBP.AVG_BEATS) {
      this.dbpHist.shift()
    }

    const sbpAvg = this.robustAverage(this.sbpHist)
    const dbpAvg = this.robustAverage(this.dbpHist)
    this.lastSbpAvg = sbpAvg
    this.lastDbpAvg = dbpAvg

    console.log(`[RealtimeBP] Averaged BP: SBP_avg=${sbpAvg.toFixed(1)}, DBP_avg=${dbpAvg.toFixed(1)}`)

    // リスナー通知
    if (this.listener) {
      this.listener.onBpUpdated(clampedSbp, clampedDbp, sbpAvg, dbpAvg)
      console.log('[RealtimeBP] BP values notified to listener')
    }

    console.log('[RealtimeBP] === processBeatData END ===')

    return {
      sbp: clampedSbp,
      dbp: clampedDbp,
      sbpAvg,
      dbpAvg
    }
  }

  /**
   * 血圧推定値をリセット
   */
  reset(): void {
    // 血圧履歴をクリア
    this.sbpHist = []
    this.dbpHist = []
    
    // 血圧値をリセット
    this.lastSbp = 0.0
    this.lastDbp = 0.0
    this.lastSbpAvg = 0.0
    this.lastDbpAvg = 0.0
    
    // その他の値をリセット
    this.lastAiRaw = 0.0
    this.lastAiAt75 = 0.0
    this.lastAiRawPct = 0.0
    this.lastAiAt75Pct = 0.0
    this.lastRelTTP = 0.0
    this.lastValleyToPeakRelTTP = 0.0
    this.lastPeakToValleyRelTTP = 0.0
    
    // タイムスタンプをリセット
    this.lastUpdateTime = 0
    
    console.log('[RealtimeBP] Blood pressure values reset to 0.00')
  }

  /**
   * ロバスト平均（外れ値を除去した平均）
   */
  private robustAverage(hist: number[]): number {
    if (hist.length === 0) return 0.0

    // ソート済みのコピーを作成
    const sorted = [...hist].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]

    // 偏差を計算
    const deviations = hist.map(v => Math.abs(v - median)).sort((a, b) => a - b)
    const mad = deviations[Math.floor(deviations.length / 2)]

    // 閾値 = 3 × MAD
    const threshold = 3 * mad

    // フィルタリング
    const filtered = hist.filter(v => Math.abs(v - median) <= threshold)

    // フィルタ後の平均を返す
    return filtered.length > 0 
      ? filtered.reduce((sum, v) => sum + v, 0) / filtered.length
      : median
  }

  /**
   * 値を[min, max]でクリップ
   */
  private clamp(value: number, min: number, max: number): number {
    return value < min ? min : (value > max ? max : value)
  }

  // Getter methods
  getLastSbp(): number {
    return this.lastSbp
  }

  getLastDbp(): number {
    return this.lastDbp
  }

  getLastSbpAvg(): number {
    return this.lastSbpAvg
  }

  getLastDbpAvg(): number {
    return this.lastDbpAvg
  }

  // PV analytics getter methods
  getV2pRelTTP(): number {
    return this.lastValleyToPeakRelTTP
  }

  getP2vRelTTP(): number {
    return this.lastPeakToValleyRelTTP
  }

  getV2pAmplitude(): number {
    return this.logicRef?.getAverageValleyToPeakAmplitude() || 0.0
  }

  getP2vAmplitude(): number {
    return this.logicRef?.getAveragePeakToValleyAmplitude() || 0.0
  }
}
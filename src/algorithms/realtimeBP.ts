// JS implementation of RealtimeBP.java logic (simplified, ISO fixed at 600)

export type BPOutput = {
  sbp: number
  dbp: number
  sbpAvg: number
  dbpAvg: number
}

const AVG_BEATS = 10

const C = { C0: 80, C1: 0.5, C2: 0.1, C4: 0.001, C5: -5, C6: 0.1, C7: -0.1 }
const D = { D0: 60, D1: 0.3, D2: 0.05, D4: 0.0005, D5: -2, D6: 0.05, D7: -0.05 }

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

const robustAverage = (arr: number[]): number => {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const deviations = sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b)
  const mad = deviations[Math.floor(deviations.length / 2)]
  const threshold = 3 * mad
  const filtered = sorted.filter((v) => Math.abs(v - median) <= threshold)
  if (filtered.length === 0) return median
  return filtered.reduce((s, v) => s + v, 0) / filtered.length
}

export class RealtimeBP {
  private sbpHist: number[] = []
  private dbpHist: number[] = []

  private lastSbp = 0
  private lastDbp = 0
  private lastSbpAvg = 0
  private lastDbpAvg = 0

  update(params: {
    ibiMs: number
    smoothedIbiMs?: number
    v2pRelTTP: number
    p2vRelTTP: number
    v2pAmplitude: number
    p2vAmplitude: number
    iso?: number // default 600
  }): BPOutput | null {
    const { ibiMs, v2pRelTTP, p2vRelTTP, v2pAmplitude } = params
    if (!ibiMs || ibiMs <= 0) return null

    const iso = params.iso ?? 600
    if (iso < 500) return null

    const hr = 60000 / (params.smoothedIbiMs && params.smoothedIbiMs > 0 ? params.smoothedIbiMs : ibiMs)

    const isoNorm = iso / 600
    const isoDev = isoNorm - 1
    const sNorm = (v2pAmplitude || 0) * isoNorm

    let sbp = C.C0 + C.C1 * (v2pRelTTP || 0) + C.C2 * hr + C.C4 * sNorm + C.C5 * isoDev + C.C6 * (v2pRelTTP || 0) + C.C7 * (p2vRelTTP || 0)
    let dbp = D.D0 + D.D1 * (v2pRelTTP || 0) + D.D2 * hr + D.D4 * sNorm + D.D5 * isoDev + D.D6 * (v2pRelTTP || 0) + D.D7 * (p2vRelTTP || 0)

    sbp = clamp(sbp, 60, 200)
    dbp = clamp(dbp, 40, 150)

    this.lastSbp = sbp
    this.lastDbp = dbp
    this.sbpHist.push(sbp)
    if (this.sbpHist.length > AVG_BEATS) this.sbpHist.shift()
    this.dbpHist.push(dbp)
    if (this.dbpHist.length > AVG_BEATS) this.dbpHist.shift()

    const sbpAvg = robustAverage(this.sbpHist)
    const dbpAvg = robustAverage(this.dbpHist)
    this.lastSbpAvg = sbpAvg
    this.lastDbpAvg = dbpAvg

    return { sbp, dbp, sbpAvg, dbpAvg }
  }

  getLast() {
    return { sbp: this.lastSbp, dbp: this.lastDbp, sbpAvg: this.lastSbpAvg, dbpAvg: this.lastDbpAvg }
  }

  reset() {
    this.sbpHist = []
    this.dbpHist = []
    this.lastSbp = this.lastDbp = this.lastSbpAvg = this.lastDbpAvg = 0
  }
}


// VisionCamera Frame Processor (JS Worklet) implementing Logic1/Logic2 equivalent
// NOTE: This will be swapped to JSI/C++ later. The API surface is kept identical.
import type { Frame } from 'react-native-vision-camera'

export type PpgMode = 'Logic1' | 'Logic2'

export type PpgResult = {
  correctedGreen: number
  ibiMs: number
  heartRate: number
  bpmSd: number
  // Additional analytics used by BP estimator
  v2pRelTTP: number
  p2vRelTTP: number
  v2pAmplitude: number
  p2vAmplitude: number
}

// Internal persistent state in worklet realm
// Ring/window sizes (match Java defaults)
const GREEN_VALUE_WINDOW_SIZE = 20
const CORRECTED_GREEN_VALUE_WINDOW_SIZE = 20
const WINDOW_SIZE = 240
const BPM_HISTORY_SIZE = 20
const REFRACTORY_FRAMES = 8

// Buffers
let greenValues: number[] = []
let recentGreenValues: number[] = []
let recentCorrectedGreenValues: number[] = []
let smoothedCorrectedGreenValues: number[] = []
let windowBuf = new Float32Array(WINDOW_SIZE)
let windowIndex = 0

let bpmHistory: number[] = []
let lastPeakTime = 0
let framesSinceLastPeak = REFRACTORY_FRAMES
let lastIbiValue = -1
let bpmValue = 0
let IBI = 0

// Peak/Valley analytics (to emulate BaseLogic.detectPeakAndValleyAsync)
type PV = { timestamp: number; value: number; index: number }
let valleyToPeakHistory: PV[] = []
let peakToValleyHistory: PV[] = []

let averageValleyToPeakRelTTP = 0
let averagePeakToValleyRelTTP = 0
let averageValleyToPeakAmplitude = 0
let averagePeakToValleyAmplitude = 0

let activeMode: PpgMode = 'Logic1'

export const setPpgMode = (m: PpgMode) => {
  'worklet'
  activeMode = m
}

export const resetPpg = () => {
  'worklet'
  greenValues = []
  recentGreenValues = []
  recentCorrectedGreenValues = []
  smoothedCorrectedGreenValues = []
  windowBuf = new Float32Array(WINDOW_SIZE)
  windowIndex = 0
  bpmHistory = []
  lastPeakTime = 0
  framesSinceLastPeak = REFRACTORY_FRAMES
  lastIbiValue = -1
  bpmValue = 0
  IBI = 0
  valleyToPeakHistory = []
  peakToValleyHistory = []
  averageValleyToPeakRelTTP = 0
  averagePeakToValleyRelTTP = 0
  averageValleyToPeakAmplitude = 0
  averagePeakToValleyAmplitude = 0
}

// Extract green proxy using VisionCamera Frame Processor Plugin (native)
const extractGreen = (frame: Frame): number => {
  'worklet'
  // @ts-ignore
  const proxy = (global as any).VisionCameraProxy
  // iOS uses GreenExtractorPlugin; Android will mirror with the same name
  const res = proxy && typeof proxy.callFrameProcessor === 'function'
    ? proxy.callFrameProcessor(frame, 'GreenExtractorPlugin', [])
    : 0
  return typeof res === 'number' ? res : 0
}

const mean = (arr: number[]): number => {
  'worklet'
  if (arr.length === 0) return 0
  let s = 0
  for (let i = 0; i < arr.length; i++) s += arr[i]
  return s / arr.length
}

const std = (arr: number[]): number => {
  'worklet'
  if (arr.length === 0) return 0
  const m = mean(arr)
  let ss = 0
  for (let i = 0; i < arr.length; i++) ss += (arr[i] - m) * (arr[i] - m)
  return Math.sqrt(ss / arr.length)
}

const clamp = (v: number, lo: number, hi: number) => {
  'worklet'
  return v < lo ? lo : v > hi ? hi : v
}

const detectHeartRate = (): { bpm: number; ibi: number; bpmSd: number } | null => {
  'worklet'
  const currentVal = windowBuf[(windowIndex + WINDOW_SIZE - 1) % WINDOW_SIZE]
  const p1 = windowBuf[(windowIndex + WINDOW_SIZE - 2) % WINDOW_SIZE]
  const p2 = windowBuf[(windowIndex + WINDOW_SIZE - 3) % WINDOW_SIZE]
  const p3 = windowBuf[(windowIndex + WINDOW_SIZE - 4) % WINDOW_SIZE]
  const p4 = windowBuf[(windowIndex + WINDOW_SIZE - 5) % WINDOW_SIZE]

  if (
    framesSinceLastPeak >= REFRACTORY_FRAMES &&
    p1 > p2 &&
    p2 > p3 &&
    p3 > p4 &&
    p1 > currentVal
  ) {
    framesSinceLastPeak = 0
    const now = Date.now()
    if (lastPeakTime !== 0) {
      const intervalSec = (now - lastPeakTime) / 1000
      if (intervalSec > 0.25 && intervalSec < 1.2) {
        const bpm = 60 / intervalSec
        if (bpmHistory.length >= BPM_HISTORY_SIZE) bpmHistory.shift()
        bpmHistory.push(bpm)
        const m = mean(bpmHistory)
        const s = std(bpmHistory)
        if (bpm >= m - m * 0.1 && bpm <= m + m * 0.1) {
          bpmValue = bpm
          IBI = (60 / bpmValue) * 1000
        }
        lastPeakTime = now
        return { bpm: bpmValue, ibi: IBI, bpmSd: s }
      }
    }
    lastPeakTime = now
  }
  framesSinceLastPeak++
  return null
}

const detectPVAnalytics = (ibiMs: number) => {
  'worklet'
  const frameRate = 30
  const N = Math.min(Math.round(ibiMs / (1000 / frameRate)) + 10, WINDOW_SIZE - 5)
  // V2P valley (first half)
  let bestValleyIdx = -1,
    minV = Infinity,
    bestValleyPos = -1
  for (let i = 2; i < N / 2; i++) {
    const idx = (windowIndex + WINDOW_SIZE - 1 - i) % WINDOW_SIZE
    const vprev = windowBuf[(idx - 1 + WINDOW_SIZE) % WINDOW_SIZE]
    const v = windowBuf[idx]
    const vnext = windowBuf[(idx + 1) % WINDOW_SIZE]
    if (v < vprev && v < vnext && v < minV) {
      minV = v
      bestValleyIdx = idx
      bestValleyPos = i
    }
  }
  let v2pValley: PV | null = null
  if (bestValleyIdx !== -1) {
    const now = Date.now()
    const ts = now - bestValleyPos * (1000 / frameRate)
    v2pValley = { timestamp: ts, value: minV, index: bestValleyIdx }
  }
  // V2P peak (second half)
  let bestPeakIdx = -1,
    maxV = -Infinity,
    bestPeakPos = -1
  for (let i = Math.floor(N / 2); i < N - 2; i++) {
    const idx = (windowIndex + WINDOW_SIZE - 1 - i) % WINDOW_SIZE
    const vprev = windowBuf[(idx - 1 + WINDOW_SIZE) % WINDOW_SIZE]
    const v = windowBuf[idx]
    const vnext = windowBuf[(idx + 1) % WINDOW_SIZE]
    if (v > vprev && v > vnext && v > maxV) {
      maxV = v
      bestPeakIdx = idx
      bestPeakPos = i
    }
  }
  let v2pPeak: PV | null = null
  if (bestPeakIdx !== -1) {
    const now = Date.now()
    const ts = now - bestPeakPos * (1000 / frameRate)
    v2pPeak = { timestamp: ts, value: maxV, index: bestPeakIdx }
  }
  if (v2pValley && v2pPeak) {
    const dt = Math.abs(v2pPeak.timestamp - v2pValley.timestamp)
    const amp = Math.abs(v2pPeak.value - v2pValley.value)
    const rel = dt / ibiMs
    averageValleyToPeakRelTTP = rel
    averageValleyToPeakAmplitude = amp
    valleyToPeakHistory.push(v2pValley, v2pPeak)
    if (valleyToPeakHistory.length > 10) valleyToPeakHistory.splice(0, 2)
  }

  // P2V peak (first half)
  bestPeakIdx = -1
  maxV = -Infinity
  bestPeakPos = -1
  for (let i = 2; i < Math.floor(N / 2) - 2; i++) {
    const idx = (windowIndex + WINDOW_SIZE - 1 - i) % WINDOW_SIZE
    const vprev = windowBuf[(idx - 1 + WINDOW_SIZE) % WINDOW_SIZE]
    const v = windowBuf[idx]
    const vnext = windowBuf[(idx + 1) % WINDOW_SIZE]
    if (v > vprev && v > vnext && v > maxV) {
      maxV = v
      bestPeakIdx = idx
      bestPeakPos = i
    }
  }
  let p2vPeak: PV | null = null
  if (bestPeakIdx !== -1) {
    const now = Date.now()
    const ts = now - bestPeakPos * (1000 / frameRate)
    p2vPeak = { timestamp: ts, value: maxV, index: bestPeakIdx }
  }
  // P2V valley (second half)
  bestValleyIdx = -1
  minV = Infinity
  bestValleyPos = -1
  for (let i = Math.floor(N / 2) + 2; i < N - 2; i++) {
    const idx = (windowIndex + WINDOW_SIZE - 1 - i) % WINDOW_SIZE
    const vprev = windowBuf[(idx - 1 + WINDOW_SIZE) % WINDOW_SIZE]
    const v = windowBuf[idx]
    const vnext = windowBuf[(idx + 1) % WINDOW_SIZE]
    if (v < vprev && v < vnext && v < minV) {
      minV = v
      bestValleyIdx = idx
      bestValleyPos = i
    }
  }
  let p2vValley: PV | null = null
  if (bestValleyIdx !== -1) {
    const now = Date.now()
    const ts = now - bestValleyPos * (1000 / frameRate)
    p2vValley = { timestamp: ts, value: minV, index: bestValleyIdx }
  }
  if (p2vPeak && p2vValley) {
    const dt = Math.abs(p2vValley.timestamp - p2vPeak.timestamp)
    const amp = Math.abs(p2vPeak.value - p2vValley.value)
    const rel = dt / ibiMs
    averagePeakToValleyRelTTP = rel
    averagePeakToValleyAmplitude = amp
    peakToValleyHistory.push(p2vPeak, p2vValley)
    if (peakToValleyHistory.length > 10) peakToValleyHistory.splice(0, 2)
  }
}

// Logic1/Logic2 processing per frame
const processGreenValue = (avgG: number): PpgResult => {
  'worklet'
  greenValues.push(avgG)
  recentGreenValues.push(avgG)
  if (recentGreenValues.length > GREEN_VALUE_WINDOW_SIZE) recentGreenValues.shift()

  const latestGreen = greenValues[greenValues.length - 1] % 30
  let hundGreen = (latestGreen / 30) * 100
  let corrected = hundGreen * 3

  recentCorrectedGreenValues.push(corrected)
  if (recentCorrectedGreenValues.length > CORRECTED_GREEN_VALUE_WINDOW_SIZE)
    recentCorrectedGreenValues.shift()

  if (recentCorrectedGreenValues.length >= CORRECTED_GREEN_VALUE_WINDOW_SIZE) {
    // First smoothing
    const smoothingWindow1 = activeMode === 'Logic1' ? 6 : 4
    let s1 = 0
    for (let i = 0; i < smoothingWindow1; i++) {
      const idx = recentCorrectedGreenValues.length - 1 - i
      if (idx >= 0) s1 += recentCorrectedGreenValues[idx]
    }
    const smoothed1 = s1 / Math.min(smoothingWindow1, recentCorrectedGreenValues.length)
    smoothedCorrectedGreenValues.push(smoothed1)
    if (smoothedCorrectedGreenValues.length > CORRECTED_GREEN_VALUE_WINDOW_SIZE)
      smoothedCorrectedGreenValues.shift()

    // Second smoothing
    const smoothingWindow2 = 4
    let s2 = 0
    for (let i = 0; i < smoothingWindow2; i++) {
      const idx = smoothedCorrectedGreenValues.length - 1 - i
      if (idx >= 0) s2 += smoothedCorrectedGreenValues[idx]
    }
    let twice = s2 / Math.min(smoothingWindow2, smoothedCorrectedGreenValues.length)

    if (activeMode === 'Logic2') {
      // Range normalization
      const longWindow = 40
      const startIdx = Math.max(0, smoothedCorrectedGreenValues.length - longWindow)
      let localMin = Infinity
      let localMax = -Infinity
      for (let i = startIdx; i < smoothedCorrectedGreenValues.length; i++) {
        const v = smoothedCorrectedGreenValues[i]
        if (v < localMin) localMin = v
        if (v > localMax) localMax = v
      }
      let range = localMax - localMin
      if (range < 1) range = 1
      twice = clamp(((twice - localMin) / range) * 100, 0, 100)
    }
    corrected = twice
    windowBuf[windowIndex] = corrected
    windowIndex = (windowIndex + 1) % WINDOW_SIZE
  }

  // Heart rate detection
  const hrRes = detectHeartRate()
  if (hrRes) {
    IBI = hrRes.ibi
    bpmValue = hrRes.bpm
  }
  // PV analytics for BP estimator
  if (IBI > 0) detectPVAnalytics(IBI)

  return {
    correctedGreen: corrected,
    ibiMs: IBI,
    heartRate: bpmValue,
    bpmSd: std(bpmHistory),
    v2pRelTTP: averageValleyToPeakRelTTP,
    p2vRelTTP: averagePeakToValleyRelTTP,
    v2pAmplitude: averageValleyToPeakAmplitude,
    p2vAmplitude: averagePeakToValleyAmplitude,
  }
}

export const ppgFrameProcessor = (frame: Frame): PpgResult => {
  'worklet'
  const g = extractGreen(frame)
  return processGreenValue(g)
}


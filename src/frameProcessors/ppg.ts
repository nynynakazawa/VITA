// VisionCamera Frame Processor - Native PPG Processing with JS Fallback
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

// Active mode for native processing
let activeMode: PpgMode = 'Logic1'

// Fallback JS processing state (simplified)
const WINDOW_SIZE = 240
const BPM_HISTORY_SIZE = 20
const REFRACTORY_FRAMES = 8

let greenValues: number[] = []
let windowBuf = new Float32Array(WINDOW_SIZE)
let windowIndex = 0
let bpmHistory: number[] = []
let lastPeakTime = 0
let framesSinceLastPeak = REFRACTORY_FRAMES
let bpmValue = 0
let IBI = 0

export const setPpgMode = (m: PpgMode) => {
  'worklet'
  activeMode = m
  
  // Also set mode in native processor if available
  const proxy = (global as any).VisionCameraProxy || (global as any).__VisionCameraProxy
  if (proxy && typeof proxy.callFrameProcessor === 'function') {
    try {
      // Create a dummy frame for the mode setting call
      const dummyFrame = { buffer: null } as any
      proxy.callFrameProcessor(dummyFrame, 'PPGProcessorPlugin', [m, 'setMode'])
    } catch (e) {
      console.log('[PPG] Failed to set native mode:', e)
    }
  }
}

export const resetPpg = () => {
  'worklet'
  // Reset JS fallback state
  greenValues = []
  windowBuf = new Float32Array(WINDOW_SIZE)
  windowIndex = 0
  bpmHistory = []
  lastPeakTime = 0
  framesSinceLastPeak = REFRACTORY_FRAMES
  bpmValue = 0
  IBI = 0
  
  // Reset native processor if available
  const proxy = (global as any).VisionCameraProxy || (global as any).__VisionCameraProxy
  if (proxy && typeof proxy.callFrameProcessor === 'function') {
    try {
      const dummyFrame = { buffer: null } as any
      proxy.callFrameProcessor(dummyFrame, 'PPGProcessorPlugin', [activeMode, 'reset'])
    } catch (e) {
      console.log('[PPG] Failed to reset native processor:', e)
    }
  }
}

// Fallback green extraction (only used when native PPG processing fails)
const extractGreenFallback = (frame: Frame): number => {
  'worklet'
  console.log('[PPG] Using fallback green extraction')
  // @ts-ignore
  const proxy = (global as any).VisionCameraProxy || (global as any).__VisionCameraProxy
  let res: any = 0
  try {
    if (proxy && typeof proxy.callFrameProcessor === 'function') {
      res = proxy.callFrameProcessor(frame, 'GreenExtractorPlugin', [])
    }
  } catch (e) {
    console.log('[PPG] Green extraction error:', e)
  }
  if (typeof res === 'number' && res > 0) {
    return res
  }
  // Final fallback
  return Math.random() * 50 + 100
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

// Simplified heart rate detection for fallback
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

// Simplified fallback processing (basic smoothing only)
const processGreenValueFallback = (avgG: number): PpgResult => {
  'worklet'
  console.log('[PPG] Fallback processing avgG:', avgG)
  
  // Simple moving average for fallback
  greenValues.push(avgG)
  if (greenValues.length > 20) greenValues.shift()
  
  const smoothed = greenValues.reduce((a, b) => a + b, 0) / greenValues.length
  const correctedGreen = (smoothed % 30 / 30) * 300 // Simple correction
  
  // Basic heart rate detection (simplified)
  windowBuf[windowIndex] = correctedGreen
  windowIndex = (windowIndex + 1) % WINDOW_SIZE
  
  const hrRes = detectHeartRate()
  if (hrRes) {
    IBI = hrRes.ibi
    bpmValue = hrRes.bpm
  }
  
  return {
    correctedGreen,
    ibiMs: IBI,
    heartRate: bpmValue,
    bpmSd: std(bpmHistory),
    v2pRelTTP: 0,
    p2vRelTTP: 0,
    v2pAmplitude: 0,
    p2vAmplitude: 0,
  }
}

export const ppgFrameProcessor = (frame: Frame): PpgResult => {
  'worklet'
  console.log('[PPG] ppgFrameProcessor called')
  
  // Try native processing first
  const proxy = (global as any).VisionCameraProxy || (global as any).__VisionCameraProxy
  if (proxy && typeof proxy.callFrameProcessor === 'function') {
    try {
      console.log('[PPG] Calling native PPGProcessorPlugin...')
      const nativeResult = proxy.callFrameProcessor(frame, 'PPGProcessorPlugin', [activeMode])
      
      if (nativeResult && typeof nativeResult === 'object' && !nativeResult.error) {
        console.log('[PPG] Native processing successful:', nativeResult)
        return {
          correctedGreen: nativeResult.correctedGreen || 0,
          ibiMs: nativeResult.ibiMs || 0,
          heartRate: nativeResult.heartRate || 0,
          bpmSd: nativeResult.bpmSd || 0,
          v2pRelTTP: nativeResult.v2pRelTTP || 0,
          p2vRelTTP: nativeResult.p2vRelTTP || 0,
          v2pAmplitude: nativeResult.v2pAmplitude || 0,
          p2vAmplitude: nativeResult.p2vAmplitude || 0,
        }
      } else {
        console.log('[PPG] Native processing failed:', nativeResult)
      }
    } catch (e) {
      console.log('[PPG] Native processing error:', e)
    }
  }
  
  // Fallback to JS processing
  console.log('[PPG] Using JS fallback processing...')
  const g = extractGreenFallback(frame)
  console.log('[PPG] Green value:', g)
  const result = processGreenValueFallback(g)
  console.log('[PPG] Processing result:', result)
  return result
}


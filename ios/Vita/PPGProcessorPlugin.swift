import Foundation
import AVFoundation
import VisionCamera

// PPG Processing Result Structure
struct PPGResult {
  let correctedGreen: Double
  let ibiMs: Double
  let heartRate: Double
  let bpmSd: Double
  let v2pRelTTP: Double
  let p2vRelTTP: Double
  let v2pAmplitude: Double
  let p2vAmplitude: Double
}

// PPG Processor Class (Singleton for state persistence)
class PPGProcessor {
  static let shared = PPGProcessor()
  
  // Constants (matching Java)
  private let GREEN_VALUE_WINDOW_SIZE = 20
  private let CORRECTED_GREEN_VALUE_WINDOW_SIZE = 20
  private let WINDOW_SIZE = 240
  private let BPM_HISTORY_SIZE = 20
  private let REFRACTORY_FRAMES = 8
  
  // State variables
  private var greenValues: [Double] = []
  private var recentGreenValues: [Double] = []
  private var recentCorrectedGreenValues: [Double] = []
  private var smoothedCorrectedGreenValues: [Double] = []
  private var windowBuf: [Double] = Array(repeating: 0, count: 240)
  private var windowIndex = 0
  private var bpmHistory: [Double] = []
  private var lastPeakTime: TimeInterval = 0
  private var framesSinceLastPeak = 8
  private var bpmValue: Double = 0
  private var IBI: Double = 0
  private var activeMode: String = "Logic1"
  
  // Peak/Valley analytics
  private var averageValleyToPeakRelTTP: Double = 0
  private var averagePeakToValleyRelTTP: Double = 0
  private var averageValleyToPeakAmplitude: Double = 0
  private var averagePeakToValleyAmplitude: Double = 0
  
  private init() {}
  
  func setMode(_ mode: String) {
    activeMode = mode
  }
  
  func reset() {
    greenValues.removeAll()
    recentGreenValues.removeAll()
    recentCorrectedGreenValues.removeAll()
    smoothedCorrectedGreenValues.removeAll()
    windowBuf = Array(repeating: 0, count: WINDOW_SIZE)
    windowIndex = 0
    bpmHistory.removeAll()
    lastPeakTime = 0
    framesSinceLastPeak = REFRACTORY_FRAMES
    bpmValue = 0
    IBI = 0
    averageValleyToPeakRelTTP = 0
    averagePeakToValleyRelTTP = 0
    averageValleyToPeakAmplitude = 0
    averagePeakToValleyAmplitude = 0
  }
  
  func processGreenValue(_ avgG: Double) -> PPGResult {
    print("[PPGProcessor] Processing avgG: \(avgG)")
    
    // Add to green values history
    greenValues.append(avgG)
    recentGreenValues.append(avgG)
    if recentGreenValues.count > GREEN_VALUE_WINDOW_SIZE {
      recentGreenValues.removeFirst()
    }
    
    // Initial correction (same as Java: latestGreen % 30)
    let latestGreen = greenValues.last!.truncatingRemainder(dividingBy: 30)
    let hundGreen = (latestGreen / 30.0) * 100.0
    var correctedGreenValue = hundGreen * 3.0
    print("[PPGProcessor] Initial corrected: \(correctedGreenValue)")
    
    // Add to recent corrected values
    recentCorrectedGreenValues.append(correctedGreenValue)
    if recentCorrectedGreenValues.count > CORRECTED_GREEN_VALUE_WINDOW_SIZE {
      recentCorrectedGreenValues.removeFirst()
    }
    
    // Only proceed with smoothing if we have enough samples
    if recentCorrectedGreenValues.count >= CORRECTED_GREEN_VALUE_WINDOW_SIZE {
      print("[PPGProcessor] Starting smoothing process...")
      
      // First smoothing (Logic1: window=6, Logic2: window=4)
      let smoothingWindow1 = activeMode == "Logic1" ? 6 : 4
      var s1: Double = 0
      for i in 0..<smoothingWindow1 {
        let idx = recentCorrectedGreenValues.count - 1 - i
        if idx >= 0 {
          s1 += recentCorrectedGreenValues[idx]
        }
      }
      let smoothed1 = s1 / Double(min(smoothingWindow1, recentCorrectedGreenValues.count))
      print("[PPGProcessor] First smoothed: \(smoothed1)")
      
      // Add to smoothed history
      smoothedCorrectedGreenValues.append(smoothed1)
      if smoothedCorrectedGreenValues.count > CORRECTED_GREEN_VALUE_WINDOW_SIZE {
        smoothedCorrectedGreenValues.removeFirst()
      }
      
      // Second smoothing (always window=4)
      let smoothingWindow2 = 4
      var s2: Double = 0
      for i in 0..<smoothingWindow2 {
        let idx = smoothedCorrectedGreenValues.count - 1 - i
        if idx >= 0 {
          s2 += smoothedCorrectedGreenValues[idx]
        }
      }
      var twiceSmoothedValue = s2 / Double(min(smoothingWindow2, smoothedCorrectedGreenValues.count))
      print("[PPGProcessor] Second smoothed: \(twiceSmoothedValue)")
      
      // Logic2: Range normalization
      if activeMode == "Logic2" {
        let longWindow = 40
        let startIdx = max(0, smoothedCorrectedGreenValues.count - longWindow)
        var localMin = Double.infinity
        var localMax = -Double.infinity
        for i in startIdx..<smoothedCorrectedGreenValues.count {
          let v = smoothedCorrectedGreenValues[i]
          if v < localMin { localMin = v }
          if v > localMax { localMax = v }
        }
        var range = localMax - localMin
        if range < 1.0 { range = 1.0 }
        twiceSmoothedValue = max(0, min(100, ((twiceSmoothedValue - localMin) / range) * 100.0))
        print("[PPGProcessor] Logic2 normalized: \(twiceSmoothedValue)")
      }
      
      // Final corrected value
      correctedGreenValue = twiceSmoothedValue
      
      // Store in window buffer for heart rate detection
      windowBuf[windowIndex] = correctedGreenValue
      windowIndex = (windowIndex + 1) % WINDOW_SIZE
      print("[PPGProcessor] Final corrected stored in window: \(correctedGreenValue)")
    } else {
      print("[PPGProcessor] Not enough samples for smoothing, samples: \(recentCorrectedGreenValues.count)")
    }
    
    // Heart rate detection
    detectHeartRate()
    
    let result = PPGResult(
      correctedGreen: correctedGreenValue,
      ibiMs: IBI,
      heartRate: bpmValue,
      bpmSd: standardDeviation(bpmHistory),
      v2pRelTTP: averageValleyToPeakRelTTP,
      p2vRelTTP: averagePeakToValleyRelTTP,
      v2pAmplitude: averageValleyToPeakAmplitude,
      p2vAmplitude: averagePeakToValleyAmplitude
    )
    print("[PPGProcessor] Final result: \(result)")
    return result
  }
  
  private func detectHeartRate() {
    guard windowBuf.count >= 5 else { return }
    
    let currentVal = windowBuf[(windowIndex + WINDOW_SIZE - 1) % WINDOW_SIZE]
    let p1 = windowBuf[(windowIndex + WINDOW_SIZE - 2) % WINDOW_SIZE]
    let p2 = windowBuf[(windowIndex + WINDOW_SIZE - 3) % WINDOW_SIZE]
    let p3 = windowBuf[(windowIndex + WINDOW_SIZE - 4) % WINDOW_SIZE]
    let p4 = windowBuf[(windowIndex + WINDOW_SIZE - 5) % WINDOW_SIZE]
    
    if framesSinceLastPeak >= REFRACTORY_FRAMES &&
       p1 > p2 && p2 > p3 && p3 > p4 && p1 > currentVal {
      
      framesSinceLastPeak = 0
      let now = Date().timeIntervalSince1970
      
      if lastPeakTime != 0 {
        let interval = now - lastPeakTime
        if interval > 0.25 && interval < 1.2 {
          let bpm = 60.0 / interval
          if bpmHistory.count >= BPM_HISTORY_SIZE {
            bpmHistory.removeFirst()
          }
          bpmHistory.append(bpm)
          
          let meanBpm = bpmHistory.reduce(0, +) / Double(bpmHistory.count)
          if bpm >= meanBpm - meanBpm * 0.1 && bpm <= meanBpm + meanBpm * 0.1 {
            bpmValue = bpm
            IBI = (60.0 / bpmValue) * 1000.0
            print("[PPGProcessor] Heart rate detected - BPM: \(bpmValue), IBI: \(IBI)")
          }
        }
      }
      lastPeakTime = now
    }
    framesSinceLastPeak += 1
  }
  
  private func standardDeviation(_ values: [Double]) -> Double {
    guard values.count > 0 else { return 0 }
    let mean = values.reduce(0, +) / Double(values.count)
    let squareSum = values.reduce(0) { $0 + pow($1 - mean, 2) }
    return sqrt(squareSum / Double(values.count))
  }
}

@objc(PPGProcessorPlugin)
public class PPGProcessorPlugin: FrameProcessorPlugin {
  @objc
  public static func callback(_ frame: Frame, withArguments arguments: [Any]?) -> Any? {
    // Extract mode and action from arguments
    let mode = arguments?.first as? String ?? "Logic1"
    let action = arguments?.count ?? 0 > 1 ? arguments?[1] as? String : nil
    
    if action == "setMode" {
      PPGProcessor.shared.setMode(mode)
      return ["success": true]
    }
    
    if action == "reset" {
      PPGProcessor.shared.reset()
      return ["success": true]
    }
    
    // Extract green value from frame
    let sampleBuffer: CMSampleBuffer = frame.buffer
    guard let pixelBuffer: CVPixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { 
      return ["error": "No pixel buffer"] 
    }

    CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }

    let width = CVPixelBufferGetWidth(pixelBuffer)
    let height = CVPixelBufferGetHeight(pixelBuffer)
    let pixelFormat = CVPixelBufferGetPixelFormatType(pixelBuffer)

    // Outer region bounds in full-res coordinates
    let sx = width / 4
    let ex = width * 3 / 4
    let sy = height / 4
    let ey = height * 3 / 4

    var sum: Int = 0
    var count: Int = 0

    switch pixelFormat {
    case kCVPixelFormatType_420YpCbCr8BiPlanarFullRange, kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange:
      // NV12: plane 1 is interleaved CbCr at 1/2 resolution
      let chromaWidth = CVPixelBufferGetWidthOfPlane(pixelBuffer, 1)
      let chromaHeight = CVPixelBufferGetHeightOfPlane(pixelBuffer, 1)
      guard let chromaBase = CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, 1) else { 
        return ["error": "No chroma base"] 
      }
      let chromaBytesPerRow = CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, 1)
      let sxC = sx / 2
      let exC = ex / 2
      let syC = sy / 2
      let eyC = ey / 2
      for y in 0..<chromaHeight {
        for x in 0..<chromaWidth {
          if y < syC || y >= eyC || x < sxC || x >= exC {
            let rowPtr = chromaBase.advanced(by: y * chromaBytesPerRow)
            let cbIndex = x * 2 // even bytes are Cb (U)
            let value = rowPtr.load(fromByteOffset: cbIndex, as: UInt8.self)
            sum += Int(value)
            count += 1
          }
        }
      }
    case kCVPixelFormatType_32BGRA:
      // BGRA: take Green channel average in the outer region
      guard let base = CVPixelBufferGetBaseAddress(pixelBuffer) else { 
        return ["error": "No base address"] 
      }
      let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
      for y in 0..<height {
        for x in 0..<width {
          if y < sy || y >= ey || x < sx || x >= ex {
            let offset = y * bytesPerRow + x * 4
            // BGRA order -> G at +1
            let g = base.load(fromByteOffset: offset + 1, as: UInt8.self)
            sum += Int(g)
            count += 1
          }
        }
      }
    default:
      return ["error": "Unsupported pixel format"]
    }

    if count == 0 { 
      return ["error": "No pixels found"] 
    }
    
    let avgGreen = Double(sum) / Double(count)
    
    // Process through PPG algorithm
    let result = PPGProcessor.shared.processGreenValue(avgGreen)
    
    // Return as dictionary
    return [
      "correctedGreen": result.correctedGreen,
      "ibiMs": result.ibiMs,
      "heartRate": result.heartRate,
      "bpmSd": result.bpmSd,
      "v2pRelTTP": result.v2pRelTTP,
      "p2vRelTTP": result.p2vRelTTP,
      "v2pAmplitude": result.v2pAmplitude,
      "p2vAmplitude": result.p2vAmplitude
    ]
  }
}
import Foundation
import AVFoundation
import VisionCamera

@objc(GreenExtractorPlugin)
public class GreenExtractorPlugin: FrameProcessorPlugin {
  @objc
  public static func callback(_ frame: Frame, withArguments arguments: [Any]?) -> Any? {
    let sampleBuffer: CMSampleBuffer = frame.buffer
    guard let pixelBuffer: CVPixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return 0 }

    CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }

    let width = CVPixelBufferGetWidth(pixelBuffer)
    let height = CVPixelBufferGetHeight(pixelBuffer)

    // Plane 1: CbCr (NV12) interleaved, subsampled 4:2:0
    let chromaWidth = CVPixelBufferGetWidthOfPlane(pixelBuffer, 1)
    let chromaHeight = CVPixelBufferGetHeightOfPlane(pixelBuffer, 1)
    guard let chromaBase = CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, 1) else { return 0 }
    let chromaBytesPerRow = CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, 1)

    // Map outer region in luma to chroma plane coordinates
    let sx = width / 4
    let ex = width * 3 / 4
    let sy = height / 4
    let ey = height * 3 / 4
    let sxC = sx / 2
    let exC = ex / 2
    let syC = sy / 2
    let eyC = ey / 2

    var sum: Int = 0
    var count: Int = 0

    // Iterate chroma plane; Cb and Cr are interleaved (Cb,Cr,Cb,Cr...)
    // We take Cb (U) at even byte indices.
    for y in 0..<chromaHeight {
      for x in 0..<chromaWidth {
        // determine if this chroma sample lies in outer region
        if y < syC || y >= eyC || x < sxC || x >= exC {
          let rowPtr = chromaBase.advanced(by: y * chromaBytesPerRow)
          let cbIndex = x * 2 // even bytes are Cb (U)
          let value = rowPtr.load(fromByteOffset: cbIndex, as: UInt8.self)
          sum += Int(value)
          count += 1
        }
      }
    }

    if count == 0 { return 0 }
    return Double(sum) / Double(count)
  }
}


package com.vita.green

import com.mrousavy.camera.frameprocessor.Frame
import com.mrousavy.camera.frameprocessor.FrameProcessorPlugin
import android.media.Image
import java.nio.ByteBuffer

class GreenExtractorPlugin : FrameProcessorPlugin("GreenExtractorPlugin") {
  override fun callback(frame: Frame, params: Array<Any>?): Any? {
    val image = frame.image
    if (image == null) return 0.0
    val img: Image = image
    val uPlane = img.planes[1].buffer
    val width = img.width
    val height = img.height
    val sx = width / 4
    val ex = width * 3 / 4
    val sy = height / 4
    val ey = height * 3 / 4

    var sum = 0L
    var count = 0L

    // U plane in YUV_420_888 has pixel stride/row stride
    val rowStride = img.planes[1].rowStride
    val pixelStride = img.planes[1].pixelStride // often 2 for NV21/I420

    for (y in 0 until height/2) {
      for (x in 0 until width/2) {
        if (y < sy/2 || y >= ey/2 || x < sx/2 || x >= ex/2) {
          val index = y * rowStride + x * pixelStride
          if (index < uPlane.capacity()) {
            val value = uPlane.get(index).toInt() and 0xFF
            sum += value
            count += 1
          }
        }
      }
    }
    return if (count > 0) sum.toDouble() / count.toDouble() else 0.0
  }
}

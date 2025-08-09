package com.vita.ppg

import com.mrousavy.camera.frameprocessor.Frame
import com.mrousavy.camera.frameprocessor.FrameProcessorPlugin
import android.media.Image
import android.util.Log
import java.nio.ByteBuffer
import kotlin.math.*

data class PPGResult(
    val correctedGreen: Double,
    val ibiMs: Double,
    val heartRate: Double,
    val bpmSd: Double,
    val v2pRelTTP: Double,
    val p2vRelTTP: Double,
    val v2pAmplitude: Double,
    val p2vAmplitude: Double
)

class PPGProcessor private constructor() {
    companion object {
        @JvmStatic
        val instance = PPGProcessor()
        
        // Constants (matching Java)
        private const val GREEN_VALUE_WINDOW_SIZE = 20
        private const val CORRECTED_GREEN_VALUE_WINDOW_SIZE = 20
        private const val WINDOW_SIZE = 240
        private const val BPM_HISTORY_SIZE = 20
        private const val REFRACTORY_FRAMES = 8
    }
    
    // State variables
    private val greenValues = mutableListOf<Double>()
    private val recentGreenValues = mutableListOf<Double>()
    private val recentCorrectedGreenValues = mutableListOf<Double>()
    private val smoothedCorrectedGreenValues = mutableListOf<Double>()
    private val windowBuf = DoubleArray(WINDOW_SIZE)
    private var windowIndex = 0
    private val bpmHistory = mutableListOf<Double>()
    private var lastPeakTime = 0L
    private var framesSinceLastPeak = REFRACTORY_FRAMES
    private var bpmValue = 0.0
    private var IBI = 0.0
    private var activeMode = "Logic1"
    
    // Peak/Valley analytics
    private var averageValleyToPeakRelTTP = 0.0
    private var averagePeakToValleyRelTTP = 0.0
    private var averageValleyToPeakAmplitude = 0.0
    private var averagePeakToValleyAmplitude = 0.0
    
    fun setMode(mode: String) {
        activeMode = mode
    }
    
    fun reset() {
        greenValues.clear()
        recentGreenValues.clear()
        recentCorrectedGreenValues.clear()
        smoothedCorrectedGreenValues.clear()
        windowBuf.fill(0.0)
        windowIndex = 0
        bpmHistory.clear()
        lastPeakTime = 0
        framesSinceLastPeak = REFRACTORY_FRAMES
        bpmValue = 0.0
        IBI = 0.0
        averageValleyToPeakRelTTP = 0.0
        averagePeakToValleyRelTTP = 0.0
        averageValleyToPeakAmplitude = 0.0
        averagePeakToValleyAmplitude = 0.0
    }
    
    fun processGreenValue(avgG: Double): PPGResult {
        Log.d("PPGProcessor", "Processing avgG: $avgG")
        
        // Add to green values history
        greenValues.add(avgG)
        recentGreenValues.add(avgG)
        if (recentGreenValues.size > GREEN_VALUE_WINDOW_SIZE) {
            recentGreenValues.removeAt(0)
        }
        
        // Initial correction (same as Java: latestGreen % 30)
        val latestGreen = greenValues.last() % 30
        val hundGreen = (latestGreen / 30.0) * 100.0
        var correctedGreenValue = hundGreen * 3.0
        Log.d("PPGProcessor", "Initial corrected: $correctedGreenValue")
        
        // Add to recent corrected values
        recentCorrectedGreenValues.add(correctedGreenValue)
        if (recentCorrectedGreenValues.size > CORRECTED_GREEN_VALUE_WINDOW_SIZE) {
            recentCorrectedGreenValues.removeAt(0)
        }
        
        // Only proceed with smoothing if we have enough samples
        if (recentCorrectedGreenValues.size >= CORRECTED_GREEN_VALUE_WINDOW_SIZE) {
            Log.d("PPGProcessor", "Starting smoothing process...")
            
            // First smoothing (Logic1: window=6, Logic2: window=4)
            val smoothingWindow1 = if (activeMode == "Logic1") 6 else 4
            var s1 = 0.0
            for (i in 0 until smoothingWindow1) {
                val idx = recentCorrectedGreenValues.size - 1 - i
                if (idx >= 0) {
                    s1 += recentCorrectedGreenValues[idx]
                }
            }
            val smoothed1 = s1 / minOf(smoothingWindow1, recentCorrectedGreenValues.size)
            Log.d("PPGProcessor", "First smoothed: $smoothed1")
            
            // Add to smoothed history
            smoothedCorrectedGreenValues.add(smoothed1)
            if (smoothedCorrectedGreenValues.size > CORRECTED_GREEN_VALUE_WINDOW_SIZE) {
                smoothedCorrectedGreenValues.removeAt(0)
            }
            
            // Second smoothing (always window=4)
            val smoothingWindow2 = 4
            var s2 = 0.0
            for (i in 0 until smoothingWindow2) {
                val idx = smoothedCorrectedGreenValues.size - 1 - i
                if (idx >= 0) {
                    s2 += smoothedCorrectedGreenValues[idx]
                }
            }
            var twiceSmoothedValue = s2 / minOf(smoothingWindow2, smoothedCorrectedGreenValues.size)
            Log.d("PPGProcessor", "Second smoothed: $twiceSmoothedValue")
            
            // Logic2: Range normalization
            if (activeMode == "Logic2") {
                val longWindow = 40
                val startIdx = maxOf(0, smoothedCorrectedGreenValues.size - longWindow)
                var localMin = Double.POSITIVE_INFINITY
                var localMax = Double.NEGATIVE_INFINITY
                for (i in startIdx until smoothedCorrectedGreenValues.size) {
                    val v = smoothedCorrectedGreenValues[i]
                    if (v < localMin) localMin = v
                    if (v > localMax) localMax = v
                }
                var range = localMax - localMin
                if (range < 1.0) range = 1.0
                twiceSmoothedValue = maxOf(0.0, minOf(100.0, ((twiceSmoothedValue - localMin) / range) * 100.0))
                Log.d("PPGProcessor", "Logic2 normalized: $twiceSmoothedValue")
            }
            
            // Final corrected value
            correctedGreenValue = twiceSmoothedValue
            
            // Store in window buffer for heart rate detection
            windowBuf[windowIndex] = correctedGreenValue
            windowIndex = (windowIndex + 1) % WINDOW_SIZE
            Log.d("PPGProcessor", "Final corrected stored in window: $correctedGreenValue")
        } else {
            Log.d("PPGProcessor", "Not enough samples for smoothing, samples: ${recentCorrectedGreenValues.size}")
        }
        
        // Heart rate detection
        detectHeartRate()
        
        val result = PPGResult(
            correctedGreen = correctedGreenValue,
            ibiMs = IBI,
            heartRate = bpmValue,
            bpmSd = standardDeviation(bpmHistory),
            v2pRelTTP = averageValleyToPeakRelTTP,
            p2vRelTTP = averagePeakToValleyRelTTP,
            v2pAmplitude = averageValleyToPeakAmplitude,
            p2vAmplitude = averagePeakToValleyAmplitude
        )
        Log.d("PPGProcessor", "Final result: $result")
        return result
    }
    
    private fun detectHeartRate() {
        if (windowBuf.size < 5) return
        
        val currentVal = windowBuf[(windowIndex + WINDOW_SIZE - 1) % WINDOW_SIZE]
        val p1 = windowBuf[(windowIndex + WINDOW_SIZE - 2) % WINDOW_SIZE]
        val p2 = windowBuf[(windowIndex + WINDOW_SIZE - 3) % WINDOW_SIZE]
        val p3 = windowBuf[(windowIndex + WINDOW_SIZE - 4) % WINDOW_SIZE]
        val p4 = windowBuf[(windowIndex + WINDOW_SIZE - 5) % WINDOW_SIZE]
        
        if (framesSinceLastPeak >= REFRACTORY_FRAMES &&
            p1 > p2 && p2 > p3 && p3 > p4 && p1 > currentVal) {
            
            framesSinceLastPeak = 0
            val now = System.currentTimeMillis()
            
            if (lastPeakTime != 0L) {
                val interval = (now - lastPeakTime) / 1000.0
                if (interval > 0.25 && interval < 1.2) {
                    val bpm = 60.0 / interval
                    if (bpmHistory.size >= BPM_HISTORY_SIZE) {
                        bpmHistory.removeAt(0)
                    }
                    bpmHistory.add(bpm)
                    
                    val meanBpm = bpmHistory.average()
                    if (bpm >= meanBpm - meanBpm * 0.1 && bpm <= meanBpm + meanBpm * 0.1) {
                        bpmValue = bpm
                        IBI = (60.0 / bpmValue) * 1000.0
                        Log.d("PPGProcessor", "Heart rate detected - BPM: $bpmValue, IBI: $IBI")
                    }
                }
            }
            lastPeakTime = now
        }
        framesSinceLastPeak++
    }
    
    private fun standardDeviation(values: List<Double>): Double {
        if (values.isEmpty()) return 0.0
        val mean = values.average()
        val squareSum = values.sumOf { (it - mean).pow(2) }
        return sqrt(squareSum / values.size)
    }
}

class PPGProcessorPlugin : FrameProcessorPlugin("PPGProcessorPlugin") {
    override fun callback(frame: Frame, params: Array<Any>?): Any? {
        // Extract mode and action from arguments
        val mode = if (params != null && params.isNotEmpty()) params[0] as? String ?: "Logic1" else "Logic1"
        val action = if (params != null && params.size > 1) params[1] as? String else null
        
        if (action == "setMode") {
            PPGProcessor.instance.setMode(mode)
            return mapOf("success" to true)
        }
        
        if (action == "reset") {
            PPGProcessor.instance.reset()
            return mapOf("success" to true)
        }
        
        // Extract green value from frame
        val image = frame.image ?: return mapOf("error" to "No image")
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
        
        if (count == 0L) {
            return mapOf("error" to "No pixels found")
        }
        
        val avgGreen = sum.toDouble() / count.toDouble()
        
        // Process through PPG algorithm
        val result = PPGProcessor.instance.processGreenValue(avgGreen)
        
        // Return as map
        return mapOf(
            "correctedGreen" to result.correctedGreen,
            "ibiMs" to result.ibiMs,
            "heartRate" to result.heartRate,
            "bpmSd" to result.bpmSd,
            "v2pRelTTP" to result.v2pRelTTP,
            "p2vRelTTP" to result.p2vRelTTP,
            "v2pAmplitude" to result.v2pAmplitude,
            "p2vAmplitude" to result.p2vAmplitude
        )
    }
}
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native'
import { Camera, useCameraDevice, useFrameProcessor } from 'react-native-vision-camera'
import { Worklets } from 'react-native-worklets-core'
import { ppgFrameProcessor, setPpgMode, resetPpg, type PpgResult } from '../frameProcessors/ppg'
import LineChart from '../components/LineChart'
import { RealtimeBP } from '../algorithms/realtimeBP'
import ModeSelectionSheet from '../components/ModeSelectionSheet'
import { TempoPlayer } from '../modules/media/player'
import { saveCsv, saveIbiCsv, saveGreenCsv } from '../utils/csv'
import { pulse } from '../modules/haptics/haptics'

const Label: React.FC<{ title: string; value: string }> = ({ title, value }) => (
  <View style={styles.labelRow}>
    <Text style={styles.labelText}>{title}</Text>
    <Text style={styles.labelText}>{value}</Text>
  </View>
)

export const MainScreen: React.FC = () => {
  const device = useCameraDevice('front')
  const [mode, setMode] = useState<number>(-1)
  const [logic, setLogic] = useState<'Logic1' | 'Logic2'>('Logic1')
  const [recording, setRecording] = useState(false)
  const [name, setName] = useState('')

  const [metrics, setMetrics] = useState<PpgResult | undefined>()
  const [showModes, setShowModes] = useState(false)
  const [chartValues, setChartValues] = useState<number[]>([])
  const bpRef = useRef(new RealtimeBP())
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const randomStimuliTimerRef = useRef<NodeJS.Timeout | null>(null)
  const playerRef = useRef(new TempoPlayer())
  const beatTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const metricsRef = useRef<PpgResult | undefined>(undefined)
  const rlTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const rlActiveRef = useRef(false)
  const beforeIbiRef = useRef(800)

  // camera info (static capabilities)
  const [camInfo, setCamInfo] = useState<{ minISO?: number; maxISO?: number; minExp?: number; maxExp?: number; fov?: number } | undefined>()

  // recording buffers
  const recValuesRef = useRef<number[]>([])
  const recIbiRef = useRef<number[]>([])
  const recSdRef = useRef<number[]>([])
  const recSmIbiRef = useRef<number[]>([])
  const recSmBpmRef = useRef<number[]>([])
  const recValTsRef = useRef<number[]>([])
  const recIbiTsRef = useRef<number[]>([])

  const updateFromFrame = useCallback((m: PpgResult) => {
    setMetrics(m)
    metricsRef.current = m
    setChartValues((prev) => {
      const next = prev.length >= 200 ? prev.slice(1) : prev.slice()
      next.push(m.correctedGreen)
      return next
    })
    if (recording) {
      recValuesRef.current.push(m.correctedGreen)
      recValTsRef.current.push(Date.now())
      recIbiRef.current.push(m.ibiMs)
      recSdRef.current.push(m.bpmSd)
      recIbiTsRef.current.push(Date.now())
      // Simple smoothed placeholders (can be replaced by C++ smoother later)
      recSmIbiRef.current.push(m.ibiMs)
      recSmBpmRef.current.push(m.heartRate)
    }
  }, [])

  // JS側でWorklet→JSブリッジ関数を生成（1引数のみ）
  const runUpdateOnJS = useMemo(() => {
    return Worklets.createRunOnJS((m: PpgResult) => {
      updateFromFrame(m)
    })
    // updateFromFrameが変わったら作り直す
  }, [updateFromFrame])

  useEffect(() => {
    ;(async () => {
      const status = await Camera.getCameraPermissionStatus()
      if (status !== 'granted') {
        await Camera.requestCameraPermission()
      }
      // derive some device capabilities (best effort)
      if (device && device.formats && device.formats.length > 0) {
        const fmt = device.formats[0]
        setCamInfo({
          minISO: (fmt as any).minISO,
          maxISO: (fmt as any).maxISO,
          minExp: (fmt as any).minExposureDuration,
          maxExp: (fmt as any).maxExposureDuration,
          fov: (fmt as any).fieldOfView,
        })
      }
    })()
  }, [])

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet'
    const res = ppgFrameProcessor(frame)
    // JSスレッドへディスパッチ（1引数関数）
    // @ts-ignore
    runUpdateOnJS(res)
  }, [runUpdateOnJS])

  const saveAllCsv = useCallback(async () => {
    try {
      const now = new Date()
      const hh = String(now.getHours()).padStart(2, '0')
      const mm = String(now.getMinutes()).padStart(2, '0')
      const ss = String(now.getSeconds()).padStart(2, '0')
      const stamp = `${hh}_${mm}_${ss}`
      const fileBase = `${name}${mode}_${stamp}`
      const bpLast = bpRef.current.getLast()
      const rows = recIbiRef.current.map((v, i) => ({
        ibi: v || 0,
        bpmSd: recSdRef.current[i] || 0,
        smIbi: recSmIbiRef.current[i] || 0,
        smBpm: recSmBpmRef.current[i] || 0,
        sbp: bpLast.sbp || 0,
        dbp: bpLast.dbp || 0,
        sbpAvg: bpLast.sbpAvg || 0,
        dbpAvg: bpLast.dbpAvg || 0,
        timestamp: recIbiTsRef.current[i] || Date.now(),
      }))
      await saveIbiCsv(fileBase, rows)
      await saveGreenCsv(fileBase, recValuesRef.current, recValTsRef.current)
    } catch {}
  }, [mode, name])

  const onStart = useCallback(() => {
    setRecording(true)
    resetPpg()
    bpRef.current.reset()
    // clear buffers
    recValuesRef.current = []
    recIbiRef.current = []
    recSdRef.current = []
    recSmIbiRef.current = []
    recSmBpmRef.current = []
    recValTsRef.current = []
    recIbiTsRef.current = []
    // 5 minutes timer
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setRecording(false)
      await saveAllCsv()
    }, 5 * 60 * 1000)
  }, [saveAllCsv])
  const onReset = useCallback(() => {
    setRecording(false)
    resetPpg()
    bpRef.current.reset()
    if (timerRef.current) clearTimeout(timerRef.current)
    saveAllCsv()
  }, [saveAllCsv])

  const onSelectMode = useCallback((m: number) => {
    setMode(m)
    setShowModes(false)
    // start/stop random stimuli
    if (randomStimuliTimerRef.current) {
      clearInterval(randomStimuliTimerRef.current)
      randomStimuliTimerRef.current = null
    }
    // stop beat schedule and audio
    if (beatTimeoutRef.current) {
      clearTimeout(beatTimeoutRef.current)
      beatTimeoutRef.current = null
    }
    playerRef.current.stop?.().catch(() => {})
    // stop RL
    rlActiveRef.current = false
    if (rlTimeoutRef.current) {
      clearTimeout(rlTimeoutRef.current)
      rlTimeoutRef.current = null
    }
    if (m === 2) {
      randomStimuliTimerRef.current = setInterval(() => {
        const ibi = metrics?.ibiMs ?? 800
        const unit = Math.max(50, ibi / 4)
        // 8-bit random stimuli: vibrate short pulses at positions
        const mask = Math.floor(Math.random() * 256)
        for (let i = 0; i < 8; i++) {
          if ((mask >> i) & 1) {
            setTimeout(() => pulse('medium'), unit * i)
          }
        }
      }, 2000)
    } else if (m >= 3 && m <= 8) {
      // Map offset ratio and (optional) track selection
      let offset = 0
      if (m === 3) offset = +0.10
      if (m === 4) offset = -0.10
      if (m === 5) offset = +0.20
      if (m === 6) offset = +0.20
      if (m === 7) offset = -0.10
      if (m === 8) offset = -0.10
      // schedule metronome-like haptics based on HR with offset
      const schedule = () => {
        const bpm = metricsRef.current?.heartRate && metricsRef.current!.heartRate > 0 ? metricsRef.current!.heartRate : 60
        const target = Math.max(30, Math.min(240, bpm * (1 + offset)))
        const delay = 60000 / target
        pulse('medium')
        beatTimeoutRef.current = setTimeout(schedule, delay)
      }
      schedule()
      // attempt to start simple looped audio from a public sample
      ;(async () => {
        try {
          await playerRef.current.loadAsync('https://cdn.pixabay.com/download/audio/2022/03/15/audio_0a0e27797e.mp3?filename=drum-loop-1-110-bpm-29111.mp3', 120)
          await playerRef.current.start()
        } catch {}
      })()
    } else if (m === 9 || m === 10) {
      // simple RL loop (epsilon-greedy random actions; reward based on IBI direction)
      rlActiveRef.current = true
      beforeIbiRef.current = 800
      const loop = () => {
        if (!rlActiveRef.current) return
        const ibi = metricsRef.current?.ibiMs ?? 0
        if (ibi <= 0) {
          rlTimeoutRef.current = setTimeout(loop, 300)
          return
        }
        // actions (a1..a4) random for now
        const a1 = Math.random() < 0.5 ? 0 : 1
        const a2 = Math.random() < 0.5 ? 0 : 1
        const a3 = Math.floor(Math.random() * 2)
        const a4 = Math.floor(Math.random() * 16)
        // map to 8-bit stimuli like Java dec2bin
        const temp3 = [a3 % 2, Math.floor(a3 / 2) % 2]
        const temp4 = [a4 & 1, (a4 >> 1) & 1, (a4 >> 2) & 1, (a4 >> 3) & 1]
        const stimuli = [a1, temp4[0], temp3[0], temp4[1], a2, temp4[2], temp3[1], temp4[3]]
        // present stimuli
        const unit = Math.max(50, ibi / 4)
        for (let i = 0; i < 8; i++) {
          if (stimuli[i]) setTimeout(() => pulse('medium'), unit * i)
        }
        // reward (mode 9: prefer shorter IBI; mode 10: prefer longer IBI)
        const reward = (m === 9 ? (ibi < beforeIbiRef.current ? 2 : 0) : (ibi > beforeIbiRef.current ? 2 : 0))
        beforeIbiRef.current = ibi
        // next step
        rlTimeoutRef.current = setTimeout(loop, 800)
      }
      loop()
    }
  }, [])

  const onSelectLogic = useCallback((l: 'Logic1' | 'Logic2') => {
    setLogic(l)
    setPpgMode(l)
  }, [])

  if (!device) return <View style={{ flex: 1, backgroundColor: '#1e3333' }} />

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Biometric Monitor</Text>
      </View>

      <View style={styles.rowCenter}> 
        <Text style={styles.title}>RealTime-HR/BP</Text>
      </View>

      <View style={styles.rowCenter}>
        <Text style={styles.modeLabel}>Select Processing Mode:</Text>
        <Pressable onPress={() => onSelectLogic(logic === 'Logic1' ? 'Logic2' : 'Logic1')} style={styles.buttonOutlineSmall}>
          <Text style={styles.buttonSmallText}>{logic}</Text>
        </Pressable>
      </View>

      <View style={styles.rowCenter}>
        <TextInput
          placeholder="Enter FileName"
          placeholderTextColor="#78CCCC"
          value={name}
          onChangeText={setName}
          style={styles.input}
        />
        <Text style={styles.modeValue}>mode : {mode}</Text>
      </View>

      <View style={styles.cameraWrap}>
        <Camera
          device={device}
          isActive={true}
          pixelFormat="yuv"
          fps={30}
          frameProcessor={frameProcessor}
        />
      </View>

      <Text style={styles.sectionTitle}>キャリブレーション中</Text>

      <View style={styles.chartWrap}>
        <LineChart values={chartValues} height={160} />
      </View>

      {(() => {
        if (!metrics) return null
        bpRef.current.update({
          ibiMs: metrics.ibiMs,
          v2pRelTTP: metrics.v2pRelTTP,
          p2vRelTTP: metrics.p2vRelTTP,
          v2pAmplitude: metrics.v2pAmplitude,
          p2vAmplitude: metrics.p2vAmplitude,
        })
        return null
      })()}

      <View style={styles.metricsWrap}>
        <Label title="Value" value={metrics ? metrics.correctedGreen.toFixed(2) : '--'} />
        <Label title="BPM SD" value={metrics ? metrics.bpmSd.toFixed(2) : '--'} />
        <Label title="IBI" value={metrics ? metrics.ibiMs.toFixed(2) : '--'} />
        <Label title="HeartRate" value={metrics ? metrics.heartRate.toFixed(2) : '--'} />
        <Label title="IBI(Smooth)" value={metrics ? metrics.ibiMs.toFixed(2) : '--'} />
        <Label title="HR(Smooth)" value={metrics ? metrics.heartRate.toFixed(2) : '--'} />
        {(() => {
          const last = bpRef.current.getLast()
          return (
            <>
              <Label title="SBP" value={last.sbp ? last.sbp.toFixed(1) : '--'} />
              <Label title="DBP" value={last.dbp ? last.dbp.toFixed(1) : '--'} />
              <Label title="SBP(Average)" value={last.sbpAvg ? last.sbpAvg.toFixed(1) : '--'} />
              <Label title="DBP(Average)" value={last.dbpAvg ? last.dbpAvg.toFixed(1) : '--'} />
              {camInfo && (
                <>
                  <Label title="ISO(min-max)" value={`${camInfo.minISO ?? '-'} - ${camInfo.maxISO ?? '-'}`} />
                  <Label title="Exposure(min-max)" value={`${camInfo.minExp ?? '-'} - ${camInfo.maxExp ?? '-'}`} />
                  <Label title="FOV" value={`${camInfo.fov ?? '-'}`} />
                </>
              )}
            </>
          )
        })()}
      </View>

      <View style={styles.actions}>
        <Pressable onPress={() => setShowModes(true)} style={[styles.buttonOutline, { marginRight: 8 }]}>
          <Text style={styles.buttonText}>Mode</Text>
        </Pressable>
        <Pressable onPress={onStart} style={[styles.buttonOutline, { marginHorizontal: 8 }]}>
          <Text style={styles.buttonText}>Start</Text>
        </Pressable>
        <Pressable onPress={onReset} style={[styles.buttonOutline, { marginLeft: 8 }]}>
          <Text style={styles.buttonText}>Reset</Text>
        </Pressable>
      </View>

      {showModes && (
        <ModeSelectionSheet
          onSelect={onSelectMode}
          onClose={() => setShowModes(false)}
        />
      )}
    </View>
  )
}

export default MainScreen

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1e3333' },
  header: { height: 56, justifyContent: 'center', paddingHorizontal: 16 },
  headerTitle: { color: '#78CCCC', fontSize: 20 },
  rowCenter: { paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center' },
  title: { color: '#78CCCC', fontSize: 30, marginRight: 8 },
  modeLabel: { color: '#78CCCC', fontSize: 20, marginRight: 8 },
  buttonOutlineSmall: { paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#78CCCC', borderRadius: 8 },
  buttonSmallText: { color: '#78CCCC' },
  input: { color: '#78CCCC', fontSize: 20, borderBottomWidth: 1, borderBottomColor: '#78CCCC', marginRight: 16, flex: 1 },
  modeValue: { color: '#78CCCC', fontSize: 20 },
  cameraWrap: { height: 280, marginHorizontal: 16, borderRadius: 8, overflow: 'hidden', backgroundColor: 'black' },
  sectionTitle: { color: '#78CCCC', fontSize: 20, marginTop: 16, paddingHorizontal: 16 },
  chartWrap: { paddingHorizontal: 16, marginTop: 8 },
  metricsWrap: { paddingHorizontal: 16, marginTop: 8 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  labelText: { color: '#78CCCC', fontSize: 16 },
  actions: { paddingHorizontal: 16, marginTop: 16, flexDirection: 'row' },
  buttonOutline: { flex: 1, alignItems: 'center', paddingVertical: 12, borderWidth: 1, borderColor: '#78CCCC', borderRadius: 8 },
  buttonText: { color: '#78CCCC', fontSize: 20 },
})

function computeNextBeatDelayMs(metrics: PpgResult | undefined, offset: number): number {
  const baseBpm = metrics?.heartRate && metrics.heartRate > 0 ? metrics.heartRate : 60
  const target = Math.max(30, Math.min(240, baseBpm * (1 + offset)))
  return 60000 / target
}

function startBeatSchedule(offset: number) {
  // Access refs via closure
  // @ts-ignore
  const beatTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null> = globalThis.__beatTimeoutRef || null
}

async function saveAllCsv(baseName: string, mode: number, bpLast: { sbp: number; dbp: number; sbpAvg: number; dbpAvg: number }) {
  try {
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const ss = String(now.getSeconds()).padStart(2, '0')
    const stamp = `${hh}_${mm}_${ss}`
    const name = `${baseName}${mode}_${stamp}`
    // Access buffers via global refs
    // These are closures in component scope; in a real app we'd inject via params
    // @ts-ignore
    const values = recValuesRef.current as number[]
    // @ts-ignore
    const valTs = recValTsRef.current as number[]
    // @ts-ignore
    const ibi = recIbiRef.current as number[]
    // @ts-ignore
    const sd = recSdRef.current as number[]
    // @ts-ignore
    const smIbi = recSmIbiRef.current as number[]
    // @ts-ignore
    const smBpm = recSmBpmRef.current as number[]
    // @ts-ignore
    const ibiTs = recIbiTsRef.current as number[]

    const rows = ibi.map((v, i) => ({
      ibi: v || 0,
      bpmSd: sd[i] || 0,
      smIbi: smIbi[i] || 0,
      smBpm: smBpm[i] || 0,
      sbp: bpLast.sbp || 0,
      dbp: bpLast.dbp || 0,
      sbpAvg: bpLast.sbpAvg || 0,
      dbpAvg: bpLast.dbpAvg || 0,
      timestamp: ibiTs[i] || Date.now(),
    }))
    await saveIbiCsv(name, rows)
    await saveGreenCsv(name, values, valTs)
  } catch {}
}
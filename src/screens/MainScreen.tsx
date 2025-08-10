import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Pressable, TextInput, StyleSheet, ScrollView, SafeAreaView, StatusBar, Platform } from 'react-native'
import { Camera, useCameraDevice, useFrameProcessor } from 'react-native-vision-camera'
import { Worklets } from 'react-native-worklets-core'
import { ppgFrameProcessor, setPpgMode, resetPpg, processPpgData, type PpgResult } from '../frameProcessors/ppg'
import LineChart from '../components/LineChart'
import ModeSelectionSheet from '../components/ModeSelectionSheet'
import { AudioHapticFeedback } from '../modules/feedback/AudioHapticFeedback'
import { saveCsv, saveIbiCsv, saveGreenCsv } from '../utils/csv'

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
  const audioHapticRef = useRef(new AudioHapticFeedback())
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
    console.log('[MainScreen] updateFromFrame called with:', m)
    setMetrics(m)
    metricsRef.current = m
    setChartValues((prev) => {
      const next = prev.length >= 200 ? prev.slice(1) : prev.slice()
      next.push(m.correctedGreenValue)
      return next
    })
    
    // 音楽・ハプティックフィードバック更新
    if (m.heartRate > 0) {
      audioHapticRef.current.updateTempo(m.heartRate)
    }
    
    if (recording) {
      recValuesRef.current.push(m.correctedGreenValue)
      recValTsRef.current.push(Date.now())
      recIbiRef.current.push(m.ibi)
      recSdRef.current.push(m.bpmSd)
      recIbiTsRef.current.push(Date.now())
      // Simple smoothed placeholders (can be replaced by C++ smoother later)
      recSmIbiRef.current.push(m.ibi)
      recSmBpmRef.current.push(m.heartRate)
    }
  }, [recording])

  // JS側でWorklet→JSブリッジ関数を生成（緑色値を受け取る）
  const runUpdateOnJS = useMemo(() => {
    return Worklets.createRunOnJS((greenValue: number) => {
      // JSスレッドでPPG処理を実行
      const ppgResult = processPpgData(greenValue)
      updateFromFrame(ppgResult)
    })
    // updateFromFrameが変わったら作り直す
  }, [updateFromFrame])

  useEffect(() => {
    ;(async () => {
      const status = await Camera.getCameraPermissionStatus()
      if (status !== 'granted') {
        await Camera.requestCameraPermission()
      }
      // 常時処理を有効化（録画は別途Startで制御）
      resetPpg()
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
  }, [device])

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet'
    console.log('[MainScreen] frameProcessor called')
    const greenValue = ppgFrameProcessor(frame)
    // JSスレッドへディスパッチ（緑色値を送信）
    // @ts-ignore
    runUpdateOnJS(greenValue)
  }, [runUpdateOnJS])

  const saveAllCsv = useCallback(async () => {
    try {
      const now = new Date()
      const hh = String(now.getHours()).padStart(2, '0')
      const mm = String(now.getMinutes()).padStart(2, '0')
      const ss = String(now.getSeconds()).padStart(2, '0')
      const stamp = `${hh}_${mm}_${ss}`
      const fileBase = `${name}${mode}_${stamp}`
      const rows = recIbiRef.current.map((v, i) => ({
        ibi: v || 0,
        bpmSd: recSdRef.current[i] || 0,
        smIbi: recSmIbiRef.current[i] || 0,
        smBpm: recSmBpmRef.current[i] || 0,
        sbp: 120.0,
        dbp: 80.0,
        sbpAvg: 120.0,
        dbpAvg: 80.0,
        timestamp: recIbiTsRef.current[i] || Date.now(),
      }))
      await saveIbiCsv(fileBase, rows)
      await saveGreenCsv(fileBase, recValuesRef.current, recValTsRef.current)
    } catch {}
  }, [mode, name])

  const onStart = useCallback(() => {
    setRecording(true)
    resetPpg()
    // clear buffers
    recValuesRef.current = []
    recIbiRef.current = []
    recSdRef.current = []
    recSmIbiRef.current = []
    recSmBpmRef.current = []
    recValTsRef.current = []
    recIbiTsRef.current = []
  }, [])

  const onReset = useCallback(() => {
    setRecording(false)
    resetPpg()
    saveAllCsv()
  }, [saveAllCsv])

  const onSelectLogic = useCallback((l: 'Logic1' | 'Logic2') => {
    setLogic(l)
    setPpgMode(l)
  }, [])

  if (!device) return <View style={{ flex: 1, backgroundColor: '#1e3333' }} />

  return (
    <>
      <View style={[styles.statusBarBackground, Platform.OS === 'ios' && styles.iosStatusBar]} />
      <SafeAreaView style={styles.root}>
        <StatusBar 
          backgroundColor={Platform.OS === 'android' ? '#00FF00' : 'transparent'} 
          barStyle="dark-content" 
          translucent={true}
        />
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Biometric Monitor</Text>
        </View>
        <ScrollView contentContainerStyle={styles.scrollContent}>
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

          <View style={styles.mainContent}>
            <View style={styles.card}>
              <View style={styles.cameraWrap}>
                <Camera
                  device={device}
                  isActive={true}
                  fps={30}
                  frameProcessor={frameProcessor}
                  onError={(e) => {
                    console.log('Camera error', e)
                  }}
                  style={StyleSheet.absoluteFill}
                />
              </View>
            </View>

            <View style={styles.chartCard}>
              <LineChart values={chartValues} height={240} />
            </View>
          </View>

          <View style={styles.metricsCard}>
            <Label title="Value" value={metrics ? metrics.correctedGreenValue.toFixed(2) : '--'} />
            <Label title="BPM SD" value={metrics ? metrics.bpmSd.toFixed(2) : '--'} />
            <Label title="IBI" value={metrics ? metrics.ibi.toFixed(2) : '--'} />
            <Label title="HeartRate" value={metrics ? metrics.heartRate.toFixed(2) : '--'} />
            <Label title="IBI(Smooth)" value={metrics ? metrics.ibi.toFixed(2) : '--'} />
            <Label title="HR(Smooth)" value={metrics ? metrics.heartRate.toFixed(2) : '--'} />
            <Label title="SBP" value={metrics ? '120.0' : '--'} />
            <Label title="DBP" value={metrics ? '80.0' : '--'} />
            <Label title="v2pRelTTP" value={metrics ? metrics.v2pRelTTP.toFixed(3) : '--'} />
            <Label title="p2vRelTTP" value={metrics ? metrics.p2vRelTTP.toFixed(3) : '--'} />
            <Label title="v2pAmplitude" value={metrics ? metrics.v2pAmplitude.toFixed(3) : '--'} />
            <Label title="p2vAmplitude" value={metrics ? metrics.p2vAmplitude.toFixed(3) : '--'} />
          </View>

          <View style={styles.buttonContainer}>
            <View style={styles.actions}>
              <Pressable onPress={onStart} style={[styles.buttonOutline, recording && styles.buttonPrimary]}>
                <Text style={[styles.buttonText, recording && styles.buttonTextPrimary]}>Start</Text>
              </Pressable>
              <View style={{ width: 16 }} />
              <Pressable onPress={onReset} style={styles.buttonOutline}>
                <Text style={styles.buttonText}>Reset</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
  )
}

const STATUSBAR_HEIGHT = Platform.OS === 'ios' ? 20 : StatusBar.currentHeight || 0

const styles = StyleSheet.create({
  statusBarBackground: {
    height: STATUSBAR_HEIGHT,
    backgroundColor: '#00FF00',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1
  },
  mainContent: {
    marginHorizontal: 16,
    marginVertical: 8,
  },
  buttonContainer: {
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: '#122626',
    borderRadius: 16,
    padding: 16,
  },
  iosStatusBar: {
    height: 50  // iOSでは通知バー領域を広めに確保
  },
  root: { 
    flex: 1, 
    backgroundColor: '#0F1E1E' 
  },
  header: { 
    height: 56, 
    justifyContent: 'center', 
    paddingHorizontal: 16, 
    borderBottomWidth: StyleSheet.hairlineWidth, 
    borderBottomColor: '#2A3A3A' 
  },
  headerTitle: { 
    color: '#78CCCC', 
    fontSize: 20, 
    fontWeight: '600' 
  },
  appBar: { 
    height: 56, 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    paddingHorizontal: 16 
  },
  appBarTitle: { 
    color: '#78CCCC', 
    fontSize: 20, 
    fontWeight: '700' 
  },
  chip: { 
    paddingHorizontal: 12, 
    paddingVertical: 6, 
    borderRadius: 16, 
    borderWidth: 1, 
    borderColor: '#2A4A4A', 
    backgroundColor: '#122626' 
  },
  chipText: { 
    color: '#78CCCC', 
    fontSize: 14 
  },
  scrollContent: { 
    paddingBottom: 24 
  },
  rowCenter: { 
    paddingHorizontal: 16, 
    marginVertical: 8, 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between' 
  },
  title: { 
    color: '#78CCCC', 
    fontSize: 24, 
    fontWeight: '700' 
  },
  modeLabel: { 
    color: '#78CCCC', 
    fontSize: 16 
  },
  buttonOutlineSmall: { 
    paddingHorizontal: 12, 
    paddingVertical: 6, 
    borderRadius: 16, 
    borderWidth: 1, 
    borderColor: '#2A4A4A', 
    backgroundColor: '#122626' 
  },
  buttonSmallText: { 
    color: '#78CCCC', 
    fontSize: 14 
  },
  input: { 
    flex: 1, 
    height: 40, 
    paddingHorizontal: 12, 
    borderRadius: 8, 
    borderWidth: 1, 
    borderColor: '#2A4A4A', 
    backgroundColor: '#122626', 
    color: '#78CCCC', 
    fontSize: 16 
  },
  modeValue: { 
    color: '#78CCCC', 
    fontSize: 16, 
    marginLeft: 16 
  },
  card: { 
    marginHorizontal: 16, 
    marginVertical: 8, 
    borderRadius: 16, 
    borderWidth: 1, 
    borderColor: '#2A4A4A', 
    backgroundColor: '#122626', 
    overflow: 'hidden' 
  },
  cameraWrap: { 
    height: 240 
  },
  metricsCard: { 
    margin: 16, 
    padding: 16, 
    borderRadius: 16, 
    borderWidth: 1, 
    borderColor: '#2A4A4A', 
    backgroundColor: '#122626' 
  },
  labelRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    marginBottom: 8 
  },
  labelText: { 
    color: '#78CCCC', 
    fontSize: 14 
  },
  chartCard: { 
    margin: 16, 
    padding: 16, 
    borderRadius: 16, 
    borderWidth: 1, 
    borderColor: '#2A4A4A', 
    backgroundColor: '#122626' 
  },
  actions: { 
    paddingHorizontal: 16, 
    marginTop: 16, 
    flexDirection: 'row', 
    paddingBottom: 24 
  },
  buttonOutline: { 
    flex: 1, 
    alignItems: 'center', 
    paddingVertical: 12, 
    borderWidth: 1, 
    borderColor: '#2A4A4A', 
    borderRadius: 14, 
    backgroundColor: '#0D1A1A' 
  },
  buttonText: { 
    color: '#78CCCC', 
    fontSize: 18, 
    fontWeight: '600' 
  },
  buttonPrimary: { 
    backgroundColor: '#143232', 
    borderColor: '#1E4848' 
  },
  buttonTextPrimary: { 
    color: '#9EF2F2' 
  }
})

export default MainScreen
import React, { useCallback, useRef, useState } from 'react'
import { View, Text, Pressable } from 'react-native'

export const PressureAnalyzeScreen: React.FC = () => {
  const [count, setCount] = useState(8)
  const [phase, setPhase] = useState(0)

  const next = useCallback(() => {
    // Simple placeholder matching activity_pressure_analyze.xml
    setPhase((p) => (p + 1) % 3)
    setCount(8)
  }, [])

  return (
    <View className="flex-1 bg-[#1e3333] items-center justify-center p-6">
      <Pressable onPress={next} className="w-[300px] items-center py-3 border border-[#78CCCC] rounded">
        <Text className="text-[#78CCCC] text-[20px]">
          {phase === 0 ? '軽くカメラに\n指を乗せてください' : phase === 1 ? '中程度に押してください' : '強く押してください'}
        </Text>
      </Pressable>
      <Text className="text-white text-[40px] mt-2">{count}</Text>
    </View>
  )
}

export default PressureAnalyzeScreen


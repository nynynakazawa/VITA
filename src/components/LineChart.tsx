import React, { useMemo } from 'react'
import { View } from 'react-native'
import Svg, { Path } from 'react-native-svg'

type Props = { values: number[]; height?: number }

export const LineChart: React.FC<Props> = ({ values, height = 160 }) => {
  const path = useMemo(() => {
    if (!values.length) return ''
    const W = 320
    const H = height
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = Math.max(1, max - min)
    const step = W / Math.max(1, values.length - 1)
    const points = values.map((v, i) => {
      const x = i * step
      const y = H - ((v - min) / range) * H
      return `${i === 0 ? 'M' : 'L'}${x},${y}`
    })
    return points.join(' ')
  }, [values, height])

  return (
    <View style={{ width: '100%', height }}>
      <Svg width="100%" height="100%" viewBox={`0 0 320 ${height}`}>
        <Path d={path} stroke="#78CCCC" strokeWidth={2} fill="none" />
      </Svg>
    </View>
  )
}

export default LineChart


import React, { useMemo } from 'react'
import { View } from 'react-native'
import Svg, { Path, Line, Text } from 'react-native-svg'

type Props = { values: number[]; height?: number }

export const LineChart: React.FC<Props> = ({ values, height = 160 }) => {
  const { path, yAxisLabels } = useMemo(() => {
    if (!values.length) return { path: '', yAxisLabels: [] }
    
    // チャートの寸法
    const W = 320
    const H = height
    const PADDING_LEFT = 40 // 縦軸のラベル用の余白
    const CHART_WIDTH = W - PADDING_LEFT
    
    // データの範囲を計算
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = Math.max(1, max - min)
    
    // 縦軸のラベルを生成（5分割）
    const yLabels = Array.from({ length: 6 }, (_, i) => {
      const value = min + (range * i) / 5
      return {
        value: Math.round(value),
        y: H - (i / 5) * H
      }
    })
    
    // パスを生成
    const step = CHART_WIDTH / Math.max(1, values.length - 1)
    const points = values.map((v, i) => {
      const x = PADDING_LEFT + i * step
      const y = H - ((v - min) / range) * H
      return `${i === 0 ? 'M' : 'L'}${x},${y}`
    })
    
    return {
      path: points.join(' '),
      yAxisLabels: yLabels
    }
  }, [values, height])

  return (
    <View style={{ width: '100%', height }}>
      <Svg width="100%" height="100%" viewBox={`0 0 320 ${height}`}>
        {/* 縦軸の線 */}
        <Line
          x1="40"
          y1="0"
          x2="40"
          y2={height}
          stroke="#78CCCC"
          strokeWidth="1"
        />
        
        {/* 縦軸のラベルと目盛り線 */}
        {yAxisLabels.map((label, i) => (
          <React.Fragment key={i}>
            <Text
              x="35"
              y={label.y + 4}
              fontSize="10"
              fill="#78CCCC"
              textAnchor="end"
            >
              {label.value}
            </Text>
            <Line
              x1="37"
              y1={label.y}
              x2="43"
              y2={label.y}
              stroke="#78CCCC"
              strokeWidth="1"
            />
          </React.Fragment>
        ))}
        
        {/* データの線 */}
        <Path
          d={path}
          stroke="#78CCCC"
          strokeWidth={2}
          fill="none"
        />
      </Svg>
    </View>
  )
}

export default LineChart
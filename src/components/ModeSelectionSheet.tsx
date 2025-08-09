import React from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'

type Props = { onSelect: (mode: number) => void; onClose: () => void }

const rows = [
  { id: 1, label: 'Mode 1 (None)' },
  { id: 2, label: 'Mode 2 (Random)' },
  { id: 3, label: 'Mode 3 (Awake Dram)' },
  { id: 4, label: 'Mode 4 (Relax Dram)' },
  { id: 5, label: 'Mode 5 (Awake musicA)' },
  { id: 6, label: 'Mode 6 (Awake musicB)' },
  { id: 7, label: 'Mode 7 (Relax musicC)' },
  { id: 8, label: 'Mode 8 (Relax MusicD)' },
  { id: 9, label: 'Mode 9 (Awake PER)' },
  { id: 10, label: 'Mode 10 (Relax PER)' },
]

export const ModeSelectionSheet: React.FC<Props> = ({ onSelect, onClose }) => {
  return (
    <View style={styles.root}>
      {rows.map((r) => (
        <Pressable key={r.id} style={styles.row} onPress={() => onSelect(r.id)}>
          <Text style={styles.rowText}>{r.label}</Text>
        </Pressable>
      ))}
      <Pressable style={styles.back} onPress={onClose}>
        <Text style={styles.backText}>back</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { position: 'absolute', inset: 0 as any, backgroundColor: '#1e3333', padding: 24 },
  row: { paddingVertical: 8 },
  rowText: { color: '#ffffff', fontSize: 16 },
  back: { paddingVertical: 12, marginTop: 16, borderWidth: 1, borderColor: '#78CCCC', borderRadius: 8, alignItems: 'center' },
  backText: { color: '#78CCCC' },
})

export default ModeSelectionSheet


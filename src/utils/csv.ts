import * as FileSystem from 'expo-file-system'

export const saveCsv = async (name: string, headers: string[], rows: (string | number)[][]) => {
  const dir = FileSystem.documentDirectory || FileSystem.cacheDirectory!
  const file = dir + `${name}.csv`
  const content = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
  await FileSystem.writeAsStringAsync(file, content)
  return file
}

export type IbiCsvRow = {
  ibi: number
  bpmSd: number
  smIbi: number
  smBpm: number
  sbp: number
  dbp: number
  sbpAvg: number
  dbpAvg: number
  timestamp: number
}

export const saveIbiCsv = async (name: string, rows: IbiCsvRow[]) => {
  const headers = ['IBI', 'bpmSD', 'Smoothed IBI', 'Smoothed BPM', 'SBP', 'DBP', 'SBP_Avg', 'DBP_Avg', 'Timestamp']
  const csvRows = rows.map((r) => [
    r.ibi.toFixed(2),
    r.bpmSd.toFixed(2),
    r.smIbi.toFixed(2),
    r.smBpm.toFixed(2),
    r.sbp.toFixed(2),
    r.dbp.toFixed(2),
    r.sbpAvg.toFixed(2),
    r.dbpAvg.toFixed(2),
    new Date(r.timestamp).toLocaleTimeString('ja-JP', { hour12: false }) + '.' + String(r.timestamp % 1000).padStart(3, '0'),
  ])
  return saveCsv(`${name}_IBI_data`, headers, csvRows)
}

export const saveGreenCsv = async (name: string, values: number[], ts: number[]) => {
  const headers = ['Green', 'Timestamp']
  const rows = values.map((v, i) => [
    v.toFixed(2),
    new Date(ts[i]).toLocaleTimeString('ja-JP', { hour12: false }) + '.' + String(ts[i] % 1000).padStart(3, '0'),
  ])
  return saveCsv(`${name}_Green`, headers, rows)
}


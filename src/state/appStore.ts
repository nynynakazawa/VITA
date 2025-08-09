import { useState } from 'react'

export const useAppStore = () => {
  const [mode, setMode] = useState(-1)
  const [recording, setRecording] = useState(false)
  return { mode, setMode, recording, setRecording }
}


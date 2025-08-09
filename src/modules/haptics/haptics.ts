import * as Haptics from 'expo-haptics'
import { Platform, Vibration } from 'react-native'

export const pulse = async (strength: 'light' | 'medium' | 'heavy' = 'medium') => {
  if (Platform.OS === 'ios') {
    const map = {
      light: Haptics.ImpactFeedbackStyle.Light,
      medium: Haptics.ImpactFeedbackStyle.Medium,
      heavy: Haptics.ImpactFeedbackStyle.Heavy,
    }
    await Haptics.impactAsync(map[strength])
  } else {
    Vibration.vibrate(35)
  }
}


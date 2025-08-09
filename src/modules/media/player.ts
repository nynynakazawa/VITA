import { Audio, AVPlaybackStatusSuccess } from 'expo-av'

export class TempoPlayer {
  private sound: Audio.Sound | null = null
  private baseTempo = 120
  private isLooping = true

  async loadAsync(assetModule: number | string, baseTempo = 120) {
    this.baseTempo = baseTempo
    if (this.sound) await this.sound.unloadAsync()
    const { sound } = await Audio.Sound.createAsync(
      // @ts-ignore allow string or module id
      typeof assetModule === 'string' ? { uri: assetModule } : assetModule,
      { shouldPlay: false, isLooping: this.isLooping },
    )
    this.sound = sound
  }

  async setTempo(targetTempo: number) {
    if (!this.sound) return
    const speed = Math.max(0.5, Math.min(4.0, targetTempo / this.baseTempo))
    await this.sound.setRateAsync(speed, true)
  }

  async start() {
    if (!this.sound) return
    await this.sound.setIsLoopingAsync(true)
    await this.sound.playAsync()
  }

  async stop() {
    if (!this.sound) return
    try { await this.sound.stopAsync() } catch {}
    try { await this.sound.unloadAsync() } catch {}
    this.sound = null
  }
}


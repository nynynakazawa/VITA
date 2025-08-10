// MidiHaptic.javaのTypeScript版
// 音楽再生とハプティックフィードバックを同期

import { Audio } from 'expo-av'
import * as Haptics from 'expo-haptics'

export class AudioHapticFeedback {
  private sound: Audio.Sound | null = null
  private isPlaying = false
  private currentBPM = 70
  private hapticInterval: NodeJS.Timeout | null = null
  
  // 音楽ファイルのリスト（RealTimeIBICと同じ）
  // 注意: 実際の音楽ファイルが配置されるまでの一時的な実装
  private musicFiles: any[] = []

  private selectedMusicIndex = 0

  constructor() {
    this.setupAudio()
    this.initializeMusicFiles()
  }

  private initializeMusicFiles(): void {
    // 音楽ファイルが利用可能な場合のみ読み込み
    // 実際のMP3ファイルが配置されるまでは空の配列を使用
    try {
      // 将来的にファイルが配置された場合の実装例：
      // this.musicFiles = [
      //   require('../../../assets/audio/musica.mp3'),
      //   require('../../../assets/audio/musicb.mp3'), 
      //   require('../../../assets/audio/musicc.mp3'),
      //   require('../../../assets/audio/musicd.mp3'),
      // ]
      console.log('[AudioHaptic] Music files not yet configured - haptic-only mode')
    } catch (error) {
      console.log('[AudioHaptic] Music files not available, using haptic-only mode')
    }
  }

  private async setupAudio() {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      })
    } catch (error) {
      console.error('Audio setup failed:', error)
    }
  }

  async selectMusic(index: number): Promise<void> {
    if (this.musicFiles.length === 0) {
      console.log('[AudioHaptic] No music files available - haptic-only mode')
      return
    }
    
    if (index >= 0 && index < this.musicFiles.length) {
      this.selectedMusicIndex = index
      
      // 現在再生中の音楽を停止
      if (this.isPlaying) {
        await this.stop()
      }
    }
  }

  async play(): Promise<void> {
    try {
      // 音楽ファイルが利用できない場合は、ハプティックのみ再生
      if (this.musicFiles.length === 0) {
        console.log('[AudioHaptic] Music files not available - starting haptic-only mode')
        this.isPlaying = true
        this.startHapticFeedback()
        return
      }

      // 既存の音楽を停止
      if (this.sound) {
        await this.sound.unloadAsync()
      }

      // 新しい音楽を読み込み
      const { sound } = await Audio.Sound.createAsync(
        this.musicFiles[this.selectedMusicIndex],
        {
          shouldPlay: true,
          isLooping: true,
          volume: 0.7,
        }
      )

      this.sound = sound
      this.isPlaying = true

      // ハプティックフィードバックを開始
      this.startHapticFeedback()

      console.log('[AudioHaptic] Music started playing')
    } catch (error) {
      console.error('Failed to play music:', error)
      // 音楽再生に失敗した場合は、ハプティックのみ再生
      console.log('[AudioHaptic] Falling back to haptic-only mode')
      this.isPlaying = true
      this.startHapticFeedback()
    }
  }

  async stop(): Promise<void> {
    try {
      if (this.sound) {
        await this.sound.stopAsync()
        await this.sound.unloadAsync()
        this.sound = null
      }

      this.isPlaying = false
      this.stopHapticFeedback()

      console.log('[AudioHaptic] Music stopped')
    } catch (error) {
      console.error('Failed to stop music:', error)
    }
  }

  async pause(): Promise<void> {
    try {
      if (this.sound && this.isPlaying) {
        await this.sound.pauseAsync()
        this.stopHapticFeedback()
      }
    } catch (error) {
      console.error('Failed to pause music:', error)
    }
  }

  async resume(): Promise<void> {
    try {
      if (this.sound && !this.isPlaying) {
        await this.sound.playAsync()
        this.startHapticFeedback()
      }
    } catch (error) {
      console.error('Failed to resume music:', error)
    }
  }

  // BPMに基づいてテンポを調整
  updateTempo(bpm: number): void {
    if (bpm > 0 && bpm !== this.currentBPM) {
      this.currentBPM = bpm
      
      // ハプティックフィードバックの間隔を調整
      if (this.isPlaying) {
        this.stopHapticFeedback()
        this.startHapticFeedback()
      }

      console.log(`[AudioHaptic] Tempo updated to ${bpm} BPM`)
    }
  }

  private startHapticFeedback(): void {
    this.stopHapticFeedback()
    
    // BPMに基づいてハプティック間隔を計算（ミリ秒）
    const intervalMs = (60 / this.currentBPM) * 1000
    
    this.hapticInterval = setInterval(() => {
      // ハプティックパターンを生成
      this.generateHapticPattern()
    }, intervalMs)
  }

  private stopHapticFeedback(): void {
    if (this.hapticInterval) {
      clearInterval(this.hapticInterval)
      this.hapticInterval = null
    }
  }

  private async generateHapticPattern(): Promise<void> {
    try {
      // BPMに基づいて異なる強度のハプティックを生成
      if (this.currentBPM < 60) {
        // 低心拍数：軽いハプティック
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      } else if (this.currentBPM < 100) {
        // 中程度心拍数：中程度のハプティック
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      } else {
        // 高心拍数：強いハプティック
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
      }
    } catch (error) {
      console.error('Haptic feedback failed:', error)
    }
  }

  // 血圧に基づくハプティックパターン
  async generateBPBasedHaptic(sbp: number, dbp: number): Promise<void> {
    try {
      if (sbp > 140 || dbp > 90) {
        // 高血圧：警告パターン
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      } else if (sbp < 90 || dbp < 60) {
        // 低血圧：エラーパターン
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      } else {
        // 正常血圧：成功パターン
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      }
    } catch (error) {
      console.error('BP-based haptic feedback failed:', error)
    }
  }

  // ゲッター
  getIsPlaying(): boolean {
    return this.isPlaying
  }

  getCurrentBPM(): number {
    return this.currentBPM
  }

  getSelectedMusicIndex(): number {
    return this.selectedMusicIndex
  }

  // クリーンアップ
  async cleanup(): Promise<void> {
    await this.stop()
  }
}
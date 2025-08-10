# Audio Files

このディレクトリには、PPG処理と同期する音楽ファイルが含まれます。

## 必要なファイル

RealTimeIBICプロジェクトの以下のMIDIファイルをMP3形式に変換して配置：
- `musica.mp3` (bass.mid相当)
- `musicb.mp3` (drum.mid相当) 
- `musicc.mp3` (musica.mid相当)
- `musicd.mp3` (musicb.mid相当)

## 現在の状況

音楽ファイルが配置されるまで、アプリはハプティックフィードバックのみで動作します。
MIDIファイルは `RealTimeIBIC/app/src/main/res/raw/` ディレクトリにあります。

## ファイル変換方法

1. MIDIファイルをMP3に変換（オンラインコンバーターまたはDAWソフトウェア使用）
2. このディレクトリに配置
3. AudioHapticFeedback.tsのinitializeMusicFiles()メソッドのコメントアウト部分を有効化
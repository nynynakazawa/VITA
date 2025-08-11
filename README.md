## Vita — RealTime-IBI-BP Cross-Platform (Expo + TypeScript)

### 概要
Android アプリ「RealTime-IBI-BP」をベースにしたクロスプラットフォーム版です。Expo と TypeScript を用いて iOS / Android の両方で動作するように実装しています。

- **技術スタック**: Expo (React Native), TypeScript, react-native-vision-camera, react-native-worklets-core, expo-file-system など
- **アルゴリズムの将来方針**: コアの生体信号処理アルゴリズムは将来的に **Swift (iOS)** と **Kotlin (Android)** のネイティブコードで実装し、高精度・低レイテンシ化を図ります（現状は TypeScript 実装で動作）。

### できること
- **スマホ内蔵カメラでの PPG 取得** とリアルタイム処理
- **心拍数 (HR)**、**IBI**、bpmSD、位相/振幅関連のメトリクスの推定表示
- **緑成分の時系列グラフ描画**（リアルタイム）
- **オーディオ/ハプティックのテンポ連動フィードバック**
- **CSV 保存**（IBI 系と Green 値の 2 種類）
- **処理ロジックの切り替え**（`Logic1` / `Logic2`）

### スクリーン構成（抜粋）
- `src/screens/MainScreen.tsx`: カメラ映像、リアルタイムメトリクス、グラフ、Start/Reset 操作
- `src/frameProcessors/ppg.ts`: フレーム処理・PPG 前処理
- `src/algorithms/*`: ロジック（`Logic1`, `Logic2`, `RealtimeBP` など）
- `src/utils/csv.ts`: CSV 出力

### セットアップ
#### 前提
- Node.js / npm（または pnpm / yarn）
- Xcode（iOS）/ Android Studio（Android）
- Java 17 系（Android ビルド環境によって）

#### インストール
```bash
git clone <このリポジトリのURL>
cd Vita
npm install
```

#### 実行（開発）
Vision Camera を使うため、開発用クライアント（Dev Client）での実行を推奨します。

```bash
# iOS
npx expo run:ios

# Android
npx expo run:android
```

上記コマンドはネイティブプロジェクトをビルドしてインストールします。すでに `ios/` と `android/` があるため、`expo prebuild` は不要です。

#### パーミッション
- カメラ使用許可が必要です。初回起動時に OS のダイアログで許可してください。

### 使い方
1. 起動後、上部のテキスト入力に保存用の任意ファイル名を入力します。
2. 「Select Processing Mode」から `Logic1` / `Logic2` を切り替えできます。
3. 「Start」を押すと計測/処理を開始し、グラフとメトリクスがリアルタイム更新されます。
4. 「Reset」を押すと処理を停止し、バッファに溜めたデータを **CSV に保存** します。

### CSV 出力仕様
保存ファイル名は `入力名 + mode + _HH_MM_SS` をベースにし、以下 2 種類を出力します。

- `..._IBI_data.csv`
  - 列: `IBI, bpmSD, Smoothed IBI, Smoothed BPM, SBP, DBP, SBP_Avg, DBP_Avg, Timestamp`
  - タイムスタンプは端末ローカル時刻（`HH:MM:SS.mmm`）

- `..._Green.csv`
  - 列: `Green, Timestamp`
  - タイムスタンプは同上

保存先は `expo-file-system` のドキュメント/キャッシュ配下（端末）です。

### ビルド / 配布
Expo EAS を利用する場合：
```bash
npm install -g eas-cli
eas build:configure
eas build -p ios   # iOS
eas build -p android  # Android
```

### 既存 Android 版について
リポジトリ内の `RealTimeIBIC/` は元の Android プロジェクトです。本クロスプラットフォーム版は `src/` 配下で共通ロジックを実装しつつ、将来的にはアルゴリズム部のみを **Swift/Kotlin のネイティブ** 実装へ移行する計画です。

### 注意事項
- 本アプリは研究/開発目的であり、医療機器ではありません。診断や治療目的で使用しないでください。

### ライセンス
TBD（プロジェクトの方針に合わせて設定してください）


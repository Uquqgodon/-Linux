# Linux Alarm Drill

Linux のコマンド問題を解かないと止まらない、個人利用向けの目覚ましアラームです。

## 使い方

1. `index.html` をブラウザで開く。
2. アラーム時刻、停止に必要な正解数、出題範囲を設定する。
3. 指定時刻になるとアラーム音が鳴り、問題が表示される。
4. 設定した数だけ正解すると音が止まる。

ブラウザの自動再生制限を避けるため、アラームを設定するときに一度ページを操作してください。

## スマホアプリとして使う

このアプリは PWA として構成しています。HTTPS または `localhost` で配信すると、対応ブラウザからホーム画面へ追加できます。

- Android Chrome: ページ内の `インストール` ボタン、またはブラウザメニューのインストール操作を使う。
- iPhone Safari: 共有メニューからホーム画面へ追加する。

スマホのロック中やバックグラウンド中は、Web アプリのタイマーや音声再生が OS によって止められることがあります。実用時はアプリを前面に出し、必要なら画面スリープ抑制を有効にしてください。

## ローカル配信

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

ブラウザで `http://127.0.0.1:4173/index.html` を開きます。

## 問題の追加

問題は `questions.js` の `window.LINUX_ALARM_QUESTIONS` に追加します。

### 単一選択

```js
{
  id: "unique-id",
  category: "field",
  level: "現場頻出",
  type: "single",
  text: "問題文",
  options: ["選択肢A", "選択肢B", "選択肢C", "選択肢D"],
  answer: [0],
  hint: "ヒント",
}
```

### 複数選択

```js
{
  id: "unique-id",
  category: "lpic1",
  level: "LPIC-1",
  type: "multi",
  text: "問題文",
  options: ["選択肢A", "選択肢B", "選択肢C", "選択肢D"],
  answer: [0, 2],
  hint: "ヒント",
}
```

### コマンド入力

```js
{
  id: "unique-id",
  category: "lpic2",
  level: "LPIC-2",
  type: "command",
  text: "問題文",
  answers: ["systemctl status sshd"],
  match: "orderedTokens",
  hint: "ヒント",
}
```

`match` は次のどちらかです。

- `normalized`: 空白や引用符を軽く正規化したうえで完全一致。
- `orderedTokens`: 正答のトークン順を守っているかを判定。オプションの追加を少し許容したいとき向け。

## 初期問題カテゴリ

- `field`: 現場頻出
- `lpic1`: LPIC-1
- `lpic2`: LPIC-2
- `deep`: マニアック

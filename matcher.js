// コマンド入力・記述式の正誤判定。
// ブラウザでは window.AlarmMatcher、Node では module.exports として使える。
(function (root) {
  "use strict";

  // スマホ入力で混ざりやすい文字を半角 ASCII に寄せる。
  function normalizeCommand(value) {
    return String(value == null ? "" : value)
      .normalize("NFKC") // 全角英数字・全角スペースを半角に
      .replace(/[“”„″]/g, '"')
      .replace(/[‘’‚′]/g, "'")
      .replace(/[—–―]/g, "--") // iOS のスマート句読点で -- が — に変換される対策
      .replace(/ー/g, "-") // 日本語入力のままハイフンを打った場合
      .replace(/〜/g, "~")
      .replace(/ /g, " ")
      .replace(/\s*(>>|<<|\|\||&&|[|<>])\s*/g, " $1 ") // リダイレクトやパイプの前後の空白を統一
      .trim()
      .replace(/^[$#]\s+/, "") // 貼り付けたプロンプト記号
      .replace(/^sudo\s+/, "")
      .replace(/\s+/g, " ");
  }

  // 引用符の中の空白では区切らないトークン分割。
  function splitTokens(value) {
    const tokens = [];
    let current = "";
    let quote = "";
    for (const char of value) {
      if ((char === "'" || char === '"') && (!quote || quote === char)) {
        quote = quote ? "" : char;
        current += char;
        continue;
      }
      if (char === " " && !quote) {
        if (current) tokens.push(current);
        current = "";
        continue;
      }
      current += char;
    }
    if (current) tokens.push(current);
    // '^#' と "^#" と ^# は同じものとして比較する
    return tokens.map((token) => token.replace(/["']/g, "")).filter(Boolean);
  }

  function canonicalTokens(value, ignoreCase) {
    const normalized = normalizeCommand(value);
    return splitTokens(ignoreCase ? normalized.toLowerCase() : normalized);
  }

  function matches(input, answer, mode, ignoreCase) {
    const got = canonicalTokens(input, ignoreCase);
    const want = canonicalTokens(answer, ignoreCase);
    if (got.length === 0 || want.length === 0) return false;

    // スマホの自動大文字化で先頭だけ大文字になったケースは許容する
    if (!ignoreCase && got[0] !== want[0] && got[0].toLowerCase() === want[0]) {
      got[0] = want[0];
    }

    if (got.length === want.length && got.every((token, index) => token === want[index])) return true;
    if (mode !== "orderedTokens") return false;

    // 正答のトークンが同じ順番ですべて含まれていれば正解（追加オプションは許容）。
    // ただしコマンド名（先頭トークン）は一致している必要がある。
    if (got[0] !== want[0]) return false;
    let index = 0;
    for (const token of got) {
      if (token === want[index]) index += 1;
      if (index === want.length) return true;
    }
    return false;
  }

  function matchesAny(input, answers, mode, ignoreCase) {
    return (answers || []).some((answer) => matches(input, answer, mode, ignoreCase));
  }

  const api = { normalizeCommand, splitTokens, matches, matchesAny };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AlarmMatcher = api;
})(typeof window !== "undefined" ? window : globalThis);

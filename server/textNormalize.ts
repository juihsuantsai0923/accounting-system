/**
 * 把全形字元轉成半形，再去除頭尾空白。
 *
 * 很常見的踩雷情境：中文輸入法（尤其手機）還停留在全形模式時，使用者打的
 * email 裡的 "@"、數字、句點看起來跟半形一模一樣，實際上是全形字元
 * （例如 "＠" U+FF20 而不是 "@" U+0040），這種 email 會被 zod 的
 * .email() 格式驗證擋下來，錯誤訊息只會顯示「Invalid email」，
 * 讓人完全看不出問題出在全形／半形，容易誤以為系統壞掉。
 */
export function toHalfWidth(input: string): string {
  return input
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ")
    .trim();
}

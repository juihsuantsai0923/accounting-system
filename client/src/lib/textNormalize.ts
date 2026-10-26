/**
 * 把全形字元轉成半形，再去除頭尾空白（跟 server/textNormalize.ts 邏輯一致）。
 * 用在 email 輸入框上：中文輸入法還停留在全形模式時，"@" 或數字會被打成
 * 看起來一樣、但其實是全形的字元，導致 email 格式驗證失敗，錯誤訊息又看不出
 * 問題出在哪。這裡在送出前先自動轉正，順便更新輸入框讓使用者看到修正後的內容。
 */
export function toHalfWidth(input: string): string {
  return input
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ")
    .trim();
}

/**
 * Leviax（澈點科學）品牌標誌：直接套用官方 logo 圖檔（client/public/leviax-icon.png，
 * 只有圖案、去掉「澈點科學」文字，適合放在導覽列這種窄小空間旁邊再接文字）。
 * 圖檔放在 public 目錄，build 時會原封不動複製到輸出資料夾，路徑固定是 /leviax-icon.png。
 */
export default function LeviaxLogo({ className = "h-8 w-8" }: { className?: string }) {
  return <img src="/leviax-icon.png" alt="Leviax" className={`${className} object-contain`} />;
}

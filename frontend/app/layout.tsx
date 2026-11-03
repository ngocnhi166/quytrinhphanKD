import type { Metadata } from "next";
import { Lora } from "next/font/google";
import "./globals.css";
export const metadata: Metadata = {
  title: "SCOPE T12 · Phân tích dữ liệu",
  description: "Không gian phân tích dữ liệu với ChatGPT trên trình duyệt của bạn.",
};
// Georgia lacks stacked Vietnamese diacritics (ế, ộ…), which then render detached; Lora carries them.
const serif = Lora({ subsets: ["latin", "vietnamese"], style: ["normal", "italic"], variable: "--font-serif" });
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="vi" className={serif.variable}><body>{children}</body></html>;
}

import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "T12 Studio · Phân tích dữ liệu",
  description: "Không gian phân tích dữ liệu với ChatGPT trên trình duyệt của bạn.",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="vi"><body>{children}</body></html>;
}

import { Outfit, Work_Sans } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-outfit",
  display: "swap",
});

const workSans = Work_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-work-sans",
  display: "swap",
});

export const metadata = {
  title: "Fresh Takes — Pocket FM",
  description: "Weekly releases, POD output, and production at a glance",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${outfit.variable} ${workSans.variable}`}>{children}</body>
    </html>
  );
}

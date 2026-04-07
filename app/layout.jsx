import { Roboto } from "next/font/google";
import "./globals.css";

const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-roboto",
  display: "swap",
});

export const metadata = {
  title: "Fresh Takes — Pocket FM",
  description: "Weekly releases, POD output, and production at a glance",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${roboto.variable} ${roboto.className}`}>{children}</body>
    </html>
  );
}

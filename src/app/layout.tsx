import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/layout/Sidebar";

export const metadata: Metadata = {
  title: "Polymarket Terminal",
  description: "Advanced Polymarket trading terminal",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-bg-primary text-text-primary font-mono">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 md:ml-56">{children}</main>
        </div>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import ToastProvider from "@/components/dashboard/Toast";
import ProvidersProvider from "@/lib/providers-store";
import TerminalLogProvider from "@/lib/terminal-log-store";
import ProjectProvider from "@/lib/project-store";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MLForge Studio",
  description: "AI CMO dashboard",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <ToastProvider>
          <ProvidersProvider>
            <TerminalLogProvider>
              <ProjectProvider>{children}</ProjectProvider>
            </TerminalLogProvider>
          </ProvidersProvider>
        </ToastProvider>
      </body>
    </html>
  );
}

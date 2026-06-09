import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "@/src/components/layout/AppShell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Finances Panel",
  description: "EUR-first personal finances dashboard",
};

// Applies theme + sensitive state synchronously before paint to avoid FOUC.
const bootScript = `(() => {
  try {
    var d = document.documentElement;
    var t = localStorage.getItem('theme');
    if (t !== 'light' && t !== 'dark') {
      t = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    d.setAttribute('data-theme', t);
    var s = localStorage.getItem('sensitive');
    d.setAttribute('data-sensitive', s === 'hidden' ? 'hidden' : 'visible');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.setAttribute('data-sensitive', 'visible');
  }
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Inline boot script via dangerouslySetInnerHTML, not next/script:
            `beforeInteractive` does not support inline children, and React
            warns on (and never executes) scripts rendered with text children
            during client navigation. This renders into the server HTML head,
            runs before first paint, and is inert on client navs — by then
            the data attributes are already set. */}
        <script id="theme-boot" dangerouslySetInnerHTML={{ __html: bootScript }} />
      </head>
      <body className="min-h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { linkPreviewMetadata } from "../lib/link-preview";
import "./globals.css";
import "../components/tabletop.css";
export const metadata: Metadata = {
  ...linkPreviewMetadata(
    "Amberly Games",
    "Scrabble scores, player histories, and memorable game nights at Amberly.",
  ),
  metadataBase: new URL(
    process.env.SCRABBLE_APP_ORIGIN ?? "http://127.0.0.1:3000",
  ),
  applicationName: "Amberly Games",
  appleWebApp: {
    title: "Amberly Games",
    capable: true,
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      {
        url: "/icons/amberly-board-v2-32.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "/icon.svg?v=amberly-board-2",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
    apple: {
      url: "/icons/amberly-board-v2-180.png",
      sizes: "180x180",
      type: "image/png",
    },
  },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#184d3c",
  interactiveWidget: "resizes-content",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";

const image = {
  url: "/social/amberly-games-v1.jpg",
  width: 1200,
  height: 630,
  type: "image/jpeg",
  alt: "Amberly Games — wooden Scrabble tiles and a golden trail across the board.",
};

// Public brand artwork only. Watch credentials stay in the URL fragment;
// generating a link preview never looks up a game or exposes its players.
export function linkPreviewMetadata(
  title: string,
  description: string,
): Metadata {
  return {
    title,
    description,
    openGraph: {
      type: "website",
      siteName: "Amberly Games",
      locale: "en_CA",
      title,
      description,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: image.url, alt: image.alt }],
    },
  };
}

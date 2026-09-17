import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Amberly Games",
    short_name: "Amberly Games",
    description: "Scrabble scores and game nights at Amberly.",
    id: "/family",
    start_url: "/family",
    scope: "/",
    display: "standalone",
    background_color: "#faf9f3",
    theme_color: "#184d3c",
    icons: [
      {
        src: "/icons/amberly-board-v2-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/amberly-board-v2-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/amberly-board-v2-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

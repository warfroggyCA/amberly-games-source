# Rich table scene assets — September 15, 2026

The user chose to restore the richer original concept, with coffee, greenery, warm lighting and edge objects. The old simplified `public/tabletop/tabletop.webp` is preserved. These two new background plates are edited from the approved reference, with all game graphics removed; the actual board, bag, tiles, crowns and controls remain live UI.

- Reference: `/path/to/local/Documents/Codex/amberly-motion-preview/public/qa/reference.png`.
- Landscape: `public/tabletop/table-scene-v2.webp`, 1536 × 1024, 334,190 bytes.
- Portrait: `public/tabletop/table-scene-phone-v2.webp`, 887 × 1774, 305,330 bytes.
- Created with the built-in image-generation tool. Sharp only encoded the resulting PNGs to WebP at quality 85; no semantic image edits were performed in code.
- Portrait selection uses the viewport aspect ratio (at most 3:4), including tall phones and portrait tablets. The game and viewer share the artwork. Light backing protects navigation, reading pages and toolbar text; the landscape toolbar stays transparent across the board.

## Final generation prompts

Both requests used the reference above and this base prompt:

> Use case: precise-object-edit. Input image is the approved Amberly tabletop concept. Produce a production BACKGROUND PLATE ONLY for this actual game, matching the rich photorealistic tactile warm-light look. REMOVE the entire Scrabble board, its frame, ALL letters/tiles, ALL words/numbers/logos/player avatars/crowns/control icons, the score notepad, the cloth bag, sparkles and paths; replace removed areas seamlessly with the same warm cream tabletop surface. KEEP the beautiful coffee mug and wood serving tray, greenery, candlelight and deep green books/ceramics at the outside edges. Broad quiet central space and quiet header/toolbar areas for live UI, with natural soft contact shadows and richer warm color, no washed-out white veil. NO text, no board, no bag, no loose letter tiles or other fake interface graphics. Background should feel like an inviting dimensional real tabletop, not a flat repeated fabric pattern.

Landscape suffix:

> LANDSCAPE COMPOSITION, 1536 by 1024. Coffee and wood tray partially cropped at far upper-left edge, foliage at the top-left edge, deep green dish at lower-left corner, warm candle at far right edge, books and greenery at lower-right corner. Keep props in outer 15% at sides, keep central 70% clear. Preserve the source scene's materials and atmosphere.

Portrait suffix:

> PORTRAIT PHONE COMPOSITION, 1024 by 2048. This is a responsive companion to the same original scene, thoughtfully recomposed for a tall phone screen. Coffee mug on a curved wood tray partially cropped at far upper-left below the top quiet header band, foliage partly entering upper corners, candle edge to right, dark green books and foliage clipped into lower-right and a green dish edge in lower-left. Keep ALL center and the bottom 8% clear of objects for game UI, and the middle half vertically entirely clear full-width for a large square board. Rich warm light and dimensional edge props should still be visible around a center board without competing with small text. No UI, no lettering, no board, no bag.

The generator returned the portrait at 887 × 1774; it was retained without resampling.

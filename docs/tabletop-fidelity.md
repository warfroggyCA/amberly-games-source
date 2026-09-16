# Amberly tabletop fidelity update — September 15, 2026

This local visual update follows the approved bottle-table concept. It replaces coffee, books and greenery with a simple warm table, one black LARQ bottle and two blue water bottles in a consistent near-overhead view. The reference's slight tilt informs prop artwork; the interactive grid stays square to preserve accurate touch targets and placement geometry.

## Live elements

- Rich wooden frame uses a nine-slice border image, scaled to 2.2% of the fitted board (6–16px), leaving outside board dimensions unchanged. Only the source perimeter is painted: the generated center is not alpha and must never be used as a filled overlay.
- Crown is a shared SVG with individual gradient IDs, highlights and gold rims. Its dimensions and leader-selection rules are unchanged.
- The canvas trail has a brighter gold ribbon, fine stars and a longer fade. A maximum of 220 particles and device-pixel ratio capped at two bound decoration work. The score badge can also leave a trail while moving toward the player's total.
- The confirmed score is a freestanding luminous number with its word underneath, positioned by the existing obstacle-aware placement helper. Provisional score validity still uses red/green; only confirmation changes real totals.
- Scorer and spectator share the visual components. Motion stays optional: reduced-motion, interrupt, resize and hidden-page behavior retains the authoritative tiles and scores. No journal, API, authentication, database or record-rule changes.
- Existing CSS background variable and aspect-ratio selection separate art from the board. A future background picker is possible but is not implemented in this update.

## Assets

Built-in image-generation tool; Sharp only encodes PNG output to WebP, without semantic changes. Previous production assets are retained.

- `public/tabletop/table-bottles-v4.webp`: 1536×1024, 31,846 bytes.
- `public/tabletop/table-bottles-phone-v4.webp`: 887×1774, 15,998 bytes. Its smaller peripheral bottles leave narrow-phone branding and controls readable. The initial larger-prop portrait was rejected after browser inspection.
- `public/tabletop/board-frame-v3.webp`: 1254×1254, 234,944 bytes. CSS slices 70 pixels from each side; no center fill.
- Approved near-overhead reference: `/path/to/local/.codex/generated_images/01a09d72-eaef-7bd1-a690-a8eb904bf456/exec-3ff71199-764d-4a61-891e-f61730eb895d.png`.

## Final generation prompts

### Landscape table

Use case: precise-object-edit. Produce a production BACKGROUND PLATE ONLY for the Amberly game from the supplied approved concept. Keep only its simple softly textured warm cream tabletop, black LARQ spout water bottle and two translucent blue plastic water bottles. REMOVE the board and wooden frame, all letter tiles, bag, score pad, names, scores, avatars, crowns, gold trails, logos and controls. Replace them seamlessly with the empty tabletop. No printed words, no interface, no coffee, books, plants, candles, other props. All bottles share the scene's same nearly top-down camera (only about two degrees off vertical), circular-looking caps with a restrained shoulder edge for recognition, consistent soft shadows and photoreal materials. The center is completely clear for a real board. LANDSCAPE 1536x1024. Black LARQ close to far upper-left side, two blue bottles at the far bottom-left and bottom-right sides as in the reference. Props confined to outer 12 percent side gutters, small realistic scale, partially crop at outer edges to leave the top header band and bottom toolbar band clear. Preserve subtle warm material depth without a uniform linen weave.

### Initial portrait table

Use case: precise-object-edit. Produce a production BACKGROUND PLATE ONLY for the Amberly game from the supplied approved concept. Keep only its simple softly textured warm cream tabletop, black LARQ spout water bottle and two translucent blue plastic water bottles. REMOVE the board and wooden frame, all letter tiles, bag, score pad, names, scores, avatars, crowns, gold trails, logos and controls. Replace them seamlessly with the empty tabletop. No printed words, no interface, no coffee, books, plants, candles, other props. All bottles share the scene's same nearly top-down camera (only about two degrees off vertical), circular-looking caps with a restrained shoulder edge for recognition, consistent soft shadows and photoreal materials. The center is completely clear for a real board. PORTRAIT 1024x2048. Compose for a phone: black LARQ tucked partly outside the upper-left edge in the 12-24 percent height band, one blue bottle partly outside the upper-right edge near 24 percent height, the other partly outside the lower-right edge around 82 percent height. ALL of the middle half of the image must be clear tabletop across its entire width for a large square game board. Keep the top 8 percent and bottom 10 percent completely clear for controls. Bottles modest in scale, no large objects behind names. Preserve the same tabletop and realistic near-overhead camera.

### Final portrait refinement

Use case: precise-object-edit. Refine this portrait BACKGROUND PLATE ONLY for a phone game. Keep the exact simple warm cream tabletop texture and same three near-overhead bottles. Make the edge props substantially smaller and tuck them farther offscreen so ALL foreground UI stays legible: the black LARQ bottle should be centered at x=1% of canvas width, y=18% of canvas height, with total diameter only 12% of canvas width (much of it cropped off the left edge). The first blue water bottle is centered at x=99%, y=23%, also diameter 12% of width, cropped off the right edge. The second blue water bottle is centered at x=99%, y=82%, same size and cropping. Bottle caps remain circular-looking, with only a restrained shoulder edge; keep coherent near-overhead perspective and soft shadows. Top 12% and bottom 10% completely empty cream tabletop. Middle 30%-72% of height completely empty across full width. This must be a quiet game background with small peripheral reminders of real table bottles, not huge prominent product shots. Preserve warm material depth. No UI, no text except physical LARQ logo, no board, letters, crowns, sparkles, bag, coffee, books, foliage, or extra objects. Output portrait 1024x2048.

### Frame

Use case: background-extraction. Create one isolated production UI game-board FRAME asset based on the reference frame's rich polished honey-brown hardwood, fine natural wood grain, sculpted bevel, rounded outside corners, mitered joints, warm upper-left highlight and dark recessed inner lip. Precisely SQUARE straight-down orthographic frame with axis-aligned parallel edges and no perspective trapezoid. Canvas 1024x1024. Frame fills the full canvas bounds, a uniform 40px-thick wooden rail around all four sides, with center opening from x40 y40 to x984 y984 genuinely transparent alpha. No board cells, no text, no symbols, no tabletop, no letters, no outer background, no shadow extending outside canvas. All rendering is restricted to the 40px perimeter. This will be used as a nine-slice CSS border image, so each long rail should have attractive wood grain and a clear multi-step bevel that stretches cleanly; corner joints confined to 40x40px corners. Do not draw a filled wooden square; center must be transparent. Photorealistic restrained varnish, rich natural wood tone matching the reference.


### Final landscape refinement

Use case: precise-object-edit. Change ONLY the position of the black LARQ bottle in this landscape production background plate. Keep its exact size, near-overhead camera, appearance, realistic shape and lighting. Move the entire black bottle and its attached soft shadow DOWN by 210 pixels (about 20% of the canvas height), so its top begins around y=320 pixels and the bottle occupies the far-left middle-upper gutter, NOT the header area. Keep x position essentially unchanged, or slightly farther left by 15 pixels. Seamlessly restore the vacated upper-left area with the SAME warm cream table surface. Preserve both blue water bottles exactly in their existing bottom-corner positions, preserve their perspective and shadows, and keep the entire center clear. This change creates an empty top band safe for brand text when the image is cropped to a wide screen. No text except physical LARQ mark, no board, logo, game graphics, bag, coffee, plants, or additional objects. Landscape 1536x1024, same crop and materials.

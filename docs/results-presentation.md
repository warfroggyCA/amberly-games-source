# Results presentation

Approved September 26, 2026. This describes the implementation on `codex/results-portraits-drawer`, not the currently deployed Preview. See `release-status.md` for the running revision.

Scrabble's finalized result banner uses each winning player's current saved profile photo in a gold circular frame with a crown above it. Tied winners retain separate portraits; a missing or unreadable photo uses the crown. The saved game names and scores remain authoritative. Historical game records are not rewritten when profiles change.

The shareable PNG includes the same available portraits. Only validated, stored JPEG data URLs are accepted; no external photo URL is fetched. Image decoding failures fall back to the original crown artwork, and all required artwork failures retain the existing retry UI. Guest viewers retain their existing privacy boundary and crown-only artwork when profiles are not supplied. The photo itself is included in the file the user elects to share.

Share result uses an upward-arrow share icon. Viewing link retains the chain icon and a visible label on the finalized scorer screen. Scorer actions mount once, in the active-game header or the finalized-game heading.

Scores open in an overlay drawer for both active and historical games. Phones use the full screen; larger displays use a right-side drawer. The board does not resize or move when the drawer opens. The native dialog keeps keyboard focus inside, supports Escape, and restores focus to the opener, including Safari touch interaction. The Close control stays visible while scores scroll. Signed-in and guest spectator score dialogs use the same drawer treatment.

No database, authentication, scoring, timer, or historical-data migration is required. Crokinole's existing result artwork is retained.

Regression coverage: `tests/browser/result-portraits-drawer.spec.ts` checks one viewing-link control, portrait rendering, actual PNG pixels, failed-photo fallback, ties, drawer position, unchanged board bounds, tab switching, and focus restoration across the four browser projects. Existing result sharing, scoring, timer/correction, and keyboard viewport tests cover nearby workflows. Physical iPhone/iPad acceptance remains distinct from browser emulation.

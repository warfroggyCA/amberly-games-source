# Viewing and sharing results

The shared Games hub labels an active game's action **Resume game** for its designated scorer and **View current game** for other signed-in members. Viewing does not transfer scoring ownership. Both game cards offer **Start game** for setup; Resume/View appears only for an unfinished game. Scrabble starts with empty seats and retains the roster for selection. Cancelling setup returns to Games without changing existing games.

Scrabble and Crokinole show a dismissible crown badge when an open game transitions to a completed result. Historical results offer **Share result** without automatically reopening the celebration. Ties name all winners. Solo Scrabble has no competitive badge, and Crokinole games ended early declare no winner.

The badge prepares a PNG locally before the user presses Share, preserving mobile browser share activation. Where file sharing is supported, the device share sheet handles messaging. Otherwise **Save image** provides a downloadable PNG. Cancelling sharing is silent; a failed share retains the save option. No invitation, spectator token, current URL, or account email is included. The badge uses recorded participant names and final scores; it is a snapshot and does not update after a later correction.

The same badge component serves scorers, signed-in viewers, and public Scrabble viewers. It follows existing game visibility permissions and adds no API or database writes.

## Matched victory artwork

Both games use the approved emerald/gold board-and-crown artwork in `public/results/`. Real names are composed onto walnut tiles (Scrabble) or light natural-wood discs with dark letters (Crokinole), and scores follow the ribbon curve. The displayed image and shared file are the same locally generated PNG. Long team names wrap; very long names use full-name lettering rather than illegibly tiny pieces. Ties show every winner and a single shared points total, without “EACH”. Every badge uses “GAME NIGHT WINNER”, including ties.

Artwork loads only when the badge opens. Loading has a timeout, retry, cancellation on dismissal, and object-URL cleanup. A changed result regenerates the badge before sharing, so an earlier image cannot be shared with corrected result text. Browser-side rendering contains no invitation or viewing URL.

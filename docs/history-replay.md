# Recorded Scrabble replay

Open **Replay** on a Scrabble history row, or **Replay game** after opening a recorded game. The viewer offers Play/Pause, Previous/Next and a keyboard-accessible position slider. It uses the existing spectator board, player perspective, physical blank rendering, tile arrivals, score overlay and bingo celebration.

Replay projects prefixes of the already hydrated game journal using the domain's existing projector. Undo removes the effective turn; a correction recalculates earlier placements and dependent scores at its recorded event; finalization applies the recorded ending adjustments. A seek is local display state and never executes a game command. Access continues to come from the existing authorized game store. Removed games lose their replay board on refresh. Archiving a player does not rewrite their participation.

Playback uses a steady presentation pace, not the original wall-clock duration. Missing original timing is labelled; rack draws and exchanged letters are not invented or displayed. Pass and exchange are explicit steps, including the recorded exchange count. Missing, inconsistent or gapped journals show Replay unavailable instead of a reconstructed story. Replay is silent and does not mount live scoring controls.

Pause settles the current recorded frame. Previous and slider seeks settle immediately; Next and Play animate a recorded placement. Seeking, pausing, hiding the page, closing and removal cancel pending playback. Animation callbacks are tied to a playback generation so a previous seek cannot advance the current one. Reduced motion retains the same recorded states and readable score overlay without tile flight.

Validation covers authoritative prefix equality, physical blanks, corrections, undo, exchange/pass, final totals, repeated and backward seeks, invalid journals, no game writes, player perspective, pause/background/close cancellation, restart, automatic playback and silent cues. Browser coverage includes Chromium, iPhone/iPad WebKit and landscape. These are synthetic fixtures and browser emulation, not physical-device or family-game acceptance.

# System appearance

Amberly follows the device/browser light or dark preference on first render and when that preference changes while the app is open. CSS media queries set root colour roles, so body portals, native dialogs and route-loaded components share the appearance. Static colour-scheme and media-qualified theme-colour metadata are server-rendered. No JavaScript theme bootstrapping, account migration, local-storage preference, or new toggle is introduced. The inventory found no existing explicit theme preference to override.

The light palette remains the approved mahogany design through component fallbacks. Dark mode uses forest-charcoal surfaces, warm readable text and separate success, warning, error, information and comparison roles. Board premium squares keep distinct word/letter hues; mahogany tile faces, blank faces, portraits and player-selected Crokinole disc colours remain recognizable. No board, tile, layout or scoring geometry is reduced. Only the decorative table photograph receives an overlay, never the entire interface.

## Coverage inventory

| Surface                        | Implementation and evidence                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root, local lobby and sign-in  | Root tokens, application panels, buttons, inputs, alerts, first rendering with JavaScript disabled, initial light/dark and live switches                                        |
| Family lobby and Scrabble room | Family shell, play cards, room lists and status indicators; light/dark route captures                                                                                           |
| Scrabble scorer and spectator  | Board premiums, rack fields, blank tiles, selected cell, direction caret, draft/error feedback, score drawer, review dialog, word details, coaching, bingo and body portals     |
| Gym and game chooser           | Board/rack, keyboard entry, empty/invalid status, full-size desktop height constraint, lookup, comparison colours, help, saved practice history and review                      |
| Crokinole setup and room       | Setup, editable scores, preserved disc colours, live switch with open entry dialog, round review/corrections, standings and completed results                                   |
| Family players and access      | Player cards, avatars, invitations, member-permission dialogs, on/off switch contrast, save-error/retry states                                                                  |
| History and record book        | Filters, history rows, record cards, highlights, rivalries, journal, portraits, standings, empty states                                                                         |
| Settings                       | Equipment/tile sets, quantities, Crokinole defaults and palette controls inherit semantic surface/text/focus roles                                                              |
| Menus, forms and overlays      | Shared root roles, explicit secondary buttons, native control colour-scheme, visible focus, placeholders, sound controls, modal panels, tooltips and animations                 |
| Error/loading/empty states     | Shared shell and message colours; sign-in error, missing watch link, not-found and empty record book captured; existing asynchronous journey tests exercise loading transitions |

Route inventory: `/`, `/family`, `/family/scrabble`, `/family/players`, `/family/history`, `/family/records`, `/family/settings`, `/family/crokinole/new`, `/family/crokinole/[gameId]`, `/gym-lab`, `/gym-lab/games`, `/watch`, root error and not-found. API endpoints return data and require no visual theme. There are no theme changes to authentication, account settings, migrations or game rules.

## Validation

`tests/browser/system-theme.spec.ts` exercises both appearance preferences on desktop Chromium, iPhone WebKit, iPad WebKit and landscape iPhone WebKit. It checks no-JavaScript initial appearance, live preference changes, open dialogs, preserved drafts and persisted games after reload, route-loaded CSS, width overflow, Crokinole score entry and disc identity, spectator details, and the 396px desktop Gym board with Check move bottom at or above the 800px viewport boundary.

`npm run test:browser:dark` reuses gameplay tests for scoring, spectators, Crokinole, record book, Gym keyboard/status/history/word lookup, coaching, bingo, member permissions, sound controls and player onboarding. The normal browser suite continues to run the original default appearance and the two-mode matrix. The protected Verify browser shards also run the dedicated dark regression suite, without retries or removed assertions.

Rendered solid text is measured at 4.5:1 (3:1 for large text). Checked/unchecked permission-switch pseudo-element contrast is measured separately at 3:1 in dark mode. These checks found and corrected avatar, secondary-button and switch-thumb contrast problems. Independent read-only code and screenshot review also found and corrected input, sign-in action, direction indicator and semantic warning/word-status issues.

All browser data comes from local preview storage or mocked family APIs. No live game writes, credentials, account changes or production deployment are part of this work.

## Review images

[Light lobby](system-dark-mode/desktop-chromium-light--family.png) · [Dark lobby](system-dark-mode/desktop-chromium-dark--family.png)

[Light mobile Gym](system-dark-mode/iphone-webkit-light-gym-board.png) · [Dark mobile Gym](system-dark-mode/iphone-webkit-dark-gym-board.png)

[Dark turn dialog](system-dark-mode/iphone-webkit-dark-turn-dialog.png) · [Crokinole entry](system-dark-mode/desktop-chromium-dark-crokinole-entry.png) · [Record book](system-dark-mode/desktop-chromium-dark--family-records.png) · [Mobile history](system-dark-mode/iphone-webkit-dark--family-history.png)

[Populated record highlights](system-dark-mode/desktop-chromium-dark-record-highlights.png) · [Saved practice review](system-dark-mode/iphone-webkit-dark-practice-review.png) · [Member permissions](system-dark-mode/desktop-chromium-dark-member-permissions.png)

## Limits and release gate

Automated contrast sampling excludes photographs/gradients, native input values, disabled controls and decorative/aria-hidden labels; these need visual review. Screenshots represent selected states, not every dialog permutation. WebKit device emulation is not physical iPhone/iPad acceptance. OS-managed installed-app splash screens use the existing static manifest colours; the rendered app and supported browser chrome use the system preference. Forced-colours/high-contrast themes are not a new supported override in this change.

Production merge and deployment remain on hold for release approval. Exact-head protected Verify and the repository release checklist must pass before release; local test results alone do not waive that gate.

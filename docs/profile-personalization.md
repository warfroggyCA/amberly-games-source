# Shared profile personalization

The shared Players editor supports an optional nickname and local photo framing for Scrabble and Crokinole. A nickname is a display name, not an account identifier; permissions and membership links still use player/user IDs. Real names remain stored separately and are available through player-label titles and accessible labels. Clearing the nickname restores the real name. New games snapshot the display name; recorded game identities are not rewritten by profile changes.

Photo uploads retain the existing JPEG/PNG/WebP and 8 MB limits. The browser previews the original file with a circular crop, drag positioning, zoom and keyboard-accessible fine-position sliders. Applying the crop creates a 256-pixel square JPEG; only that image is sent when the profile is saved. Cancel preserves the previous photo and other typed fields. Adjusting an already saved photo uses its saved pixels; upload the original again to recover previously cropped areas.

## Release prerequisite

Apply `20260917182443_player_nicknames.sql` before deploying the nickname-aware server. This is an additive nullable column and constraint on the existing private players table. Existing rows, RLS, grants and membership permissions remain unchanged. No hosted migration or deployment was performed during implementation. An application rollback may leave the unused optional column in place.

## Verification

Profile validation/crop geometry unit tests, local database profile permissions and snapshot tests, and browser upload/crop/cancel/save/reload checks cover the change. Browser coverage includes desktop Chromium, iPhone WebKit portrait/landscape and iPad WebKit, plus shared navigation/draft regression tests. Physical-device acceptance remains separate.

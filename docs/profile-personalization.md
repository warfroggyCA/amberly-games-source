# Shared profile personalization

The shared Players editor supports an optional nickname and local photo framing for Scrabble and Crokinole. A nickname is a display name, not an account identifier; permissions and membership links still use player/user IDs. Real names remain stored separately and are available through player-label titles and accessible labels. Clearing the nickname restores the real name. New games snapshot the display name; recorded game identities are not rewritten by profile changes.

Photo uploads retain the existing JPEG/PNG/WebP and 8 MB limits. The browser previews the original file with a circular crop, drag positioning, zoom and keyboard-accessible fine-position sliders. Dragging allows fractional-pixel placement beyond every edge; pinch and slider zoom range from 0.25 to 4. Applying the crop creates a 256-pixel square PNG when any pixel is transparent, or JPEG when fully opaque; only that image is sent when the profile is saved. Empty crop areas remain transparent. The editor frame is transient and is not persisted. Cancel preserves the previous photo and other typed fields. Adjusting an already saved photo uses its saved pixels; upload the original again to recover previously cropped areas or transparency already flattened into an older JPEG.

## Release prerequisite

Apply `20260917182443_player_nicknames.sql` before deploying the nickname-aware server. This is an additive nullable column and constraint on the existing private players table. Existing rows, RLS, grants and membership permissions remain unchanged. No hosted migration or deployment was performed during implementation. An application rollback may leave the unused optional column in place.

## Verification

Profile validation/crop geometry unit tests, local database profile permissions and snapshot tests, and browser upload/crop/cancel/save/reload checks cover the change. Browser coverage includes desktop Chromium, iPhone WebKit portrait/landscape and iPad WebKit, plus shared navigation/draft regression tests. Physical-device acceptance remains separate.

Transparent profile support requires migration `20260927123000_transparent_profile_photos.sql` before publication. It transactionally widens the existing bounded photo constraint to JPEG or PNG without rewriting any rows; server decoding still requires a single image no larger than 256 by 256 pixels and 200 KB. Retain PNG support on rollback once a PNG has been saved: older clients reject PNG profile data and should be refreshed after release. A hosted backup, migration rehearsal/application and deployment are separate from local verification.

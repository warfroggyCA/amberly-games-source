# Shared Amberly controls

Scrabble and Crokinole share `AmberlyHeader`, `AmberlyNavigation`, and
`PlayerAvatar`. The main menu consistently links to Games, History, Players,
and Settings. Game-specific controls remain with the game: Scrabble retains its
detailed history alongside the hub's cross-game history.

Player photos are read from the shared player profiles. Names and historical
scoring records remain unchanged. Crokinole displays both partners in doubles,
with the assigned disc colour around each identity. A missing photo falls back
to the player's first initial. Signed-in Scrabble observers receive the available
shared profiles; anonymous viewing links retain their existing data contract.

Navigation retains the existing save/recovery protections. Permissions,
confirmations, authentication, and scoring calculations are unchanged. No
migration is required.

Browser coverage exercises shared navigation from both games, draft retention
through Settings, photo/initial fallback, and doubles identities on desktop,
iPhone portrait/landscape, and iPad profiles. Physical-device acceptance remains
a separate release check.

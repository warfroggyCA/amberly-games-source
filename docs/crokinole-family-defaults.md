# Crokinole family rules and defaults

New family defaults are four individual players, **Net score — winner only**, first to **300**. The family may change the format, scoring method, target or round count in Settings → Crokinole rules & family defaults. The existing `manageEquipment` permission governs changes; other members can read them. Settings are shared through the existing family palette record and revision, not browser-local preferences. Conflicting changes must reload before saving.

Winner-only entry records already-netted points supplied by the table. Exactly zero or one participant may have a positive score in a round. Zero for everyone records a tied/no-score round. The app does not infer a cancellation algorithm or subtract opponents again. The internal `rawScore` field retains the entered amount; `scoringMode: net_winner_only` identifies its meaning. Other scoring modes keep their calculations.

Round entry displays zero for missing fields, while an explicitly cleared/invalid field still requires correction. Only edited drafts count as unfinished input. Saved rounds and corrections contain every participant, including zeros. History shows net points for this method.

Existing match definitions, journals, scoring and rematches remain unchanged. A new game uses family defaults rather than silently copying the last match. The rules guide is available in setup, active play and family settings, with worked examples, supported formats, tie/end conditions, counting and correction instructions, and external playing-rule references.

## Release

Apply the additive migration `20260917132437_crokinole_family_defaults.sql` before deploying the code. It adds one nullable JSON column to the existing private palette table; existing row policies, permissions and revision protection remain in force. Missing defaults use the family seed. No existing matches are converted. No hosted migration or publication is included in the local implementation verification.

Do not roll back to a reader that lacks `net_winner_only` after games using that method exist. Rollback must retain the new mode reader and shared defaults. The prior deployed release cannot read those new game definitions.

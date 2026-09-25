# Strategy coaching feedback

Strategy keeps the existing `sampled-reply-rack-v1` evaluator and its bounded search. It remains a one-opponent-reply heuristic, not exact strategy rank or winning odds. Scored attempts and historical evaluator payloads are unchanged.

The main comparison and All moves now share:

- An indeterminate preparation state, then a real work-progress bar. Shortlist discovery occupies the first half; fresh paired validation occupies the second half. This is sample progress, not a time estimate. No option counter is presented in the main loading state.
- Plain-language trade-offs for points now, average sampled opponent reply, and the approximate rack-value difference after both players draw. This last term is not physical game points.
- Explicit disagreement/tie wording when fresh samples do not all favour the alternative, and shortlist coverage limits when the requested move wins discovery.

Cancellation still terminates the worker and preserves the draft. Closing All moves cancels its worker. Request IDs reject obsolete worker replies. Main-view errors now preserve the actual failure reason rather than describing every failure as a timeout. Failed/capped simulations still abort the comparison; they are never silently omitted from an average.

## Measurements and validation

Five deterministic full-dictionary cases were measured during development. Initial Node coaching times were approximately 0.55, 0.52, 7.71, 0.58 and 1.55 seconds. A proposed cache of shared sampled worlds returned identical results but did not improve timing (0.58, 0.53, 7.80, 0.57 and 1.65 seconds); it was discarded. These are local measurements, not iPad timing or a performance guarantee. No evaluation samples were reduced to make the progress indicator look faster.

Unit tests cover progress endpoints/monotonicity, budget failure, immutable/reproducible comparisons and explanation signs/uncertainty. Browser checks cover cancellation, preserved drafts, a controlled intermediate progress event and completed comparisons through both entry points on desktop and iPhone/iPad profiles. Physical-device timing remains to be measured.

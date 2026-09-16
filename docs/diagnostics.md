# Diagnostics and service bounds

Server failures produce structured `amberly.failure` log events with a generated incident ID, fixed area name, timestamp and (when available) a five-character PostgreSQL error classification. Error messages, stack contents, request headers, names, emails, words, request bodies, URL query strings and watch tokens are not included. Shared HTTP failures and official-word failures also attach an `X-Incident-Id` response header when available.

The Next server-error hook covers uncaught server failures. Browser error boundaries and unhandled errors send a fixed event only, bounded to three reports per page. The same-origin report endpoint accepts only that exact event and bounds logging to 30 reports per minute per instance. It performs no account or history mutation. Reports are best effort and never block scoring.

This is a first-party diagnostic baseline, **not** an external alerting/analytics service. Provider log retention still applies. A browser-only report identifies a failure, not its full stack/root cause. A persistent alerting destination and retention policy remain an operator decision.

Official-word requests have a five-minute, 256-entry in-memory cache, coalesce simultaneous identical lookups, and allow at most four distinct upstream requests at once and thirty starts per minute per server instance. Cached verdicts keep their original verification timestamp. Errors and ambiguous pages are not cached as verdicts. Each upstream call still has the existing eight-second timeout, fixed URL, no-redirect policy, response-size limit and exact-word parser.

These bounds reduce accidental repeated calls and per-instance resource use. They do not constitute a distributed abuse-prevention system; serverless instances do not share this cache or quota. No distributed store or provider firewall rule is provisioned implicitly. If traffic grows beyond private family use, configure a reviewed shared limiter/provider rule with measured limits.

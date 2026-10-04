<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

For cloud work involving Library image references or review-artifact delivery,
run [the fresh-session Library preflight](docs/cloud-library-preflight.md) before
image-dependent implementation. Keep private references and transfer credentials
out of public source and logs.

Future implementation defaults to the saved Codex Cloud environment. The October 4
Mac completion was an explicit exception; obtain a new user exception before
further Mac feature work. Follow [cloud continuation](docs/cloud-continuation.md)
and preserve existing checkouts and private inputs.

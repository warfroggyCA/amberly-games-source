# CI lint containment

The Linux verification runner uses `node scripts/lint-ci.mjs` with a Node process-group
supervisor. It runs the same installed ESLint CLI, configuration and repository
scope as `npm run lint`, retaining stdout, stderr, warnings and normal exit codes.
Local `npm run lint` remains unchanged and portable.

The lint process has a 120-second deadline. The supervisor reports a timeout to
stderr, sends TERM to its process group, and sends KILL after five more seconds
if needed. Timeout or forced termination fails the step (124 for a deadline, or the child’s nonzero status for other failures);
missing tooling and ordinary lint errors also fail. The enclosing CI step has a
three-minute limit as a secondary guard. No error is ignored or retried into a
pass. Three recent successful CI lint steps took 20, 20 and 21 seconds; 120 seconds
allows more than five times that observed maximum, not a guaranteed percentile.
If the tool exits successfully but leaves descendants running, cleanup still
runs and the supervisor reports a failure. Interruptions also stop the process
group. CI disables core dumps so a heap failure cannot create a large core file.

Node's old-space heap limit is 512 MiB for this process only. This is not a total
RSS, native-allocation, child-process or runner memory limit. Process-group cleanup
does not contain hostile executable code that deliberately creates a new session;
the scope is excessive work in the development parser, not a general sandbox.

SEC-1 (the unpatched development `braces` advisory) remains open. These controls
limit the duration and part of the memory consumption of a failed lint process;
they do not repair the parser or prove every adversarial pattern harmless. Next
lint coverage, the blocking production dependency audit and the visible full
dependency audit report remain unchanged. A maintained compatible dependency fix
still needs its own review and tests. No application or production limits change.

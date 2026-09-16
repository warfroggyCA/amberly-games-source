/** Operator-only initial bootstrap; never imported by the app or run automatically. */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { databaseTls } from "../src/server/database-tls.ts";

const args = process.argv.slice(2);
if (args.includes("--help") || !args.length) {
  console.log(
    "Usage: SCRABBLE_OWNER_DATABASE_URL=<operator connection> node scripts/bootstrap-family.mjs --family-id <UUID> --family-name <name> --owner-user-id <verified Auth UUID> --owner-email owner@example.test --player-name Doug [--apply]",
  );
  console.log(
    "Without --apply, verifies the exact existing Supabase Auth identity and prints the proposed bootstrap. Never chooses the first signup. Does not create logins, send invitations or set passwords.",
  );
  process.exit(0);
}
function arg(name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}
const familyId = arg("--family-id");
const familyName = arg("--family-name");
const userId = arg("--owner-user-id");
const ownerEmail = arg("--owner-email")?.toLowerCase();
const playerName = arg("--player-name");
const id = (value) =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const text = (value, max) =>
  typeof value === "string" &&
  value.trim() === value &&
  value.length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001f\u007f]/.test(value);
if (
  !id(familyId) ||
  !id(userId) ||
  !text(familyName, 80) ||
  !text(playerName, 60) ||
  !text(ownerEmail, 254) ||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)
)
  throw new Error(
    "Specify the exact family UUID, verified Auth UUID/email, family name and player name.",
  );
const connection = process.env.SCRABBLE_OWNER_DATABASE_URL;
if (!connection)
  throw new Error(
    "Supply an operator-only connection in SCRABBLE_OWNER_DATABASE_URL. Never use it as SCRABBLE_DATABASE_URL.",
  );
const url = new URL(connection);
const sql = postgres(connection, {
  max: 1,
  prepare: false,
  ssl: databaseTls(url),
  connect_timeout: 10,
  onnotice: () => undefined,
});
try {
  await sql.begin(async (tx) => {
    await tx`select set_config('statement_timeout','15000',true),set_config('lock_timeout','5000',true)`;
    const users =
      await tx`select id,email,email_confirmed_at,banned_until,deleted_at from auth.users where id=${userId}::uuid and lower(email)=${ownerEmail} for share`;
    const owner = users[0];
    const banEnds = owner?.banned_until
      ? new Date(owner.banned_until).getTime()
      : null;
    if (
      !owner ||
      !owner.email_confirmed_at ||
      owner.deleted_at ||
      (banEnds !== null && (!Number.isFinite(banEnds) || banEnds > Date.now()))
    )
      throw new Error(
        "The exact selected Auth account must exist, have this verified email, and be neither deleted nor currently banned. No family changes made.",
      );
    await tx`select pg_advisory_xact_lock(hashtextextended(${`scrabble-bootstrap:${familyId}`},0))`;
    const families =
      await tx`select id,name from scrabble.families where id=${familyId}::uuid for update`;
    if (families.length) {
      const owners =
        await tx`select 1 from scrabble.memberships where family_id=${familyId}::uuid and user_id=${userId}::uuid and email=${ownerEmail} and role='superadmin' and active`;
      if (!owners.length || families[0].name !== familyName)
        throw new Error(
          "This family already exists with different details or access. Bootstrap never repairs, reassigns or elevates existing accounts.",
        );
      console.log(
        "This verified owner and family are already configured; no changes made.",
      );
      return;
    }
    if (!args.includes("--apply")) {
      console.log(
        JSON.stringify(
          {
            action: "create-family",
            familyId,
            familyName,
            verifiedOwner: { userId, email: ownerEmail },
            playerName,
            apply: false,
          },
          null,
          2,
        ),
      );
      return;
    }
    const playerId = `player-${randomUUID()}`;
    await tx`insert into scrabble.families(id,name) values(${familyId}::uuid,${familyName})`;
    await tx`insert into scrabble.players(family_id,id,name) values(${familyId}::uuid,${playerId},${playerName})`;
    await tx`insert into scrabble.memberships(family_id,user_id,email,role,player_id) values(${familyId}::uuid,${userId}::uuid,${ownerEmail},'superadmin',${playerId})`;
    await tx`insert into scrabble.audit(family_id,id,actor_id,action,subject,after_value) values(${familyId}::uuid,${randomUUID()}::uuid,${userId}::uuid,'family.bootstrapped',${familyId},${tx.json({ familyName, verifiedOwnerUserId: userId, email: ownerEmail, playerId })})`;
    console.log(
      `Created family ${familyId} with the explicitly verified owner. Keep operator credentials outside the application environment.`,
    );
  });
} finally {
  await sql.end();
}

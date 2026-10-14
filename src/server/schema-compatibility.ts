import type postgres from "postgres";
import { SharedRepositoryError } from "./shared-repository";

/** No cache: a restored/rolled-back database must be checked on its next use. */
export async function requireCurrentSchema(tx: postgres.TransactionSql) {
  const [schema] =
    await tx`select to_regprocedure('scrabble.application_schema_v2()') is not null and to_regprocedure('scrabble.application_schema_v3()') is not null as ready`;
  if (!schema.ready)
    throw new SharedRepositoryError(
      "SCHEMA_BEHIND",
      "Family storage needs an operator update. No changes were saved.",
      503,
    );
}

/** Only recovery writers require the compatible guest projection; old games remain available. */
export async function requireClockRecoverySchema(tx: postgres.TransactionSql) {
  const [schema] =
    await tx`select to_regprocedure('scrabble.application_schema_v4()') is not null as ready`;
  if (!schema.ready)
    throw new SharedRepositoryError(
      "CLOCK_RECOVERY_UNAVAILABLE",
      "Stopping timing needs an operator update. Your game and current entry are unchanged.",
      409,
    );
}

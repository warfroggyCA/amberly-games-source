import type postgres from "postgres";
import { SharedRepositoryError } from "./shared-repository";

/** No cache: a restored/rolled-back database must be checked on its next use. */
export async function requireCurrentSchema(tx: postgres.TransactionSql) {
  const [schema] =
    await tx`select to_regprocedure('scrabble.application_schema_v2()') is not null as ready`;
  if (!schema.ready)
    throw new SharedRepositoryError(
      "SCHEMA_BEHIND",
      "Family storage needs an operator update. No changes were saved.",
      503,
    );
}

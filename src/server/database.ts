import "server-only";
import postgres from "postgres";
import { databaseTls } from "./database-tls";
import {
  createSharedRepository,
  SharedRepositoryError,
} from "./shared-repository";

let repository: ReturnType<typeof createSharedRepository> | undefined;
/** Dedicated non-owner login; SET LOCAL ROLE restricts every application transaction. */
export function getSharedRepository() {
  if (repository) return repository;
  const connection = process.env.SCRABBLE_DATABASE_URL;
  if (!connection)
    throw new SharedRepositoryError(
      "SHARED_NOT_CONFIGURED",
      "Shared family storage is not configured yet.",
      503,
    );
  let address: URL;
  try {
    address = new URL(connection);
  } catch {
    throw new SharedRepositoryError(
      "SHARED_NOT_CONFIGURED",
      "The shared database configuration is invalid.",
      503,
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(address.protocol) ||
    ["postgres", "supabase_admin", "service_role"].includes(
      decodeURIComponent(address.username),
    )
  )
    throw new SharedRepositoryError(
      "SHARED_NOT_CONFIGURED",
      "Configure a dedicated restricted database login.",
      503,
    );
  let ssl: ReturnType<typeof databaseTls>;
  try {
    ssl = databaseTls(address);
  } catch {
    throw new SharedRepositoryError(
      "SHARED_NOT_CONFIGURED",
      "The shared database TLS configuration is invalid.",
      503,
    );
  }
  repository = createSharedRepository(
    postgres(connection, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      ssl,
      connection: { application_name: "scrabble-shared-server" },
    }),
  );
  return repository;
}

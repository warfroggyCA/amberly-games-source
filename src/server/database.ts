import { createGymRepository } from "./gym-repository";
import "server-only";
import { createGameSummaryRepository } from "./game-summary-repository";
import postgres from "postgres";
import { databaseTls } from "./database-tls";
import {
  createSharedRepository,
  SharedRepositoryError,
} from "./shared-repository";

import { createCrokinoleRepository } from "./crokinole-repository";
let crokinoleRepository:
  ReturnType<typeof createCrokinoleRepository> | undefined;
let connectionPool: postgres.Sql | undefined;
export function getCrokinoleRepository() {
  if (!crokinoleRepository) {
    getSharedRepository();
    crokinoleRepository = createCrokinoleRepository(connectionPool!);
  }
  return crokinoleRepository;
}

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
  connectionPool = postgres(connection, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    ssl,
    connection: { application_name: "scrabble-shared-server" },
  });
  repository = createSharedRepository(connectionPool);
  return repository;
}

export function getGameSummaryRepository() {
  getSharedRepository();
  return createGameSummaryRepository(connectionPool!);
}

export function getGymRepository() {
  getSharedRepository();
  return createGymRepository(connectionPool!);
}

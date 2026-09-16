import { HttpError } from "./shared-http";
export function configuredFamilyId() {
  const id = process.env.SCRABBLE_FAMILY_ID;
  if (
    !id ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    throw new HttpError(
      503,
      "The family workspace has not been configured yet.",
    );
  return id;
}

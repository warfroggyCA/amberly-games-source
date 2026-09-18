import type { FamilyMember } from "./shared-contract";

/** Defaults preserve existing members' access; additional trust is opt-in. */
export const MEMBER_PERMISSIONS = [
  {
    key: "startGames",
    label: "Start games",
    description: "Create shared games that count toward records.",
    group: "Everyday play",
    defaultValue: true,
  },
  {
    key: "scoreGames",
    label: "Keep score",
    description:
      "Enter, correct and finish scores in games where they are the designated scorer.",
    group: "Everyday play",
    defaultValue: true,
  },
  {
    key: "addPlayers",
    label: "Add players",
    description: "Add new people to the shared player roster.",
    group: "Everyday play",
    defaultValue: true,
  },
  {
    key: "editOwnProfile",
    label: "Edit their profile",
    description: "Change the name, photo and bio of their linked player.",
    group: "Everyday play",
    defaultValue: true,
  },
  {
    key: "manageEquipment",
    label: "Manage equipment",
    description:
      "Update Scrabble tile sets and Crokinole disc colours for future games.",
    group: "Everyday play",
    defaultValue: true,
  },
  {
    key: "shareGames",
    label: "Share viewing links",
    description: "Create, replace or close links for games they score.",
    group: "Everyday play",
    defaultValue: true,
  },
  {
    key: "editAllProfiles",
    label: "Edit anyone’s profile",
    description: "Manage names, photos and bios across the roster.",
    group: "Extra trust",
    defaultValue: false,
  },
  {
    key: "takeOverScoring",
    label: "Take over scoring",
    description:
      "Become another game’s scorer, with a recorded reason. Also requires Keep score.",
    group: "Extra trust",
    defaultValue: false,
  },
  {
    key: "resolveConcerns",
    label: "Review game concerns",
    description:
      "Decide whether a disputed game counts toward records. Original scores stay intact.",
    group: "Extra trust",
    defaultValue: false,
  },
  {
    key: "inviteMembers",
    label: "Invite people",
    description:
      "Allow emails to join as members and revoke pending invitations. Cannot change anyone’s permissions.",
    group: "Extra trust",
    defaultValue: false,
  },
  {
    key: "exportHistory",
    label: "Export the shared archive",
    description:
      "Download shared game history. Private tests and the internal audit archive remain superadmin-only.",
    group: "Extra trust",
    defaultValue: false,
  },
] as const;
export type MemberPermission = (typeof MEMBER_PERMISSIONS)[number]["key"];
export type MemberPermissions = Partial<Record<MemberPermission, boolean>>;
export function isMemberPermissions(
  value: unknown,
): value is MemberPermissions {
  return (
    !!value &&
    typeof value === "object" &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([key, enabled]) =>
        typeof enabled === "boolean" &&
        MEMBER_PERMISSIONS.some((p) => p.key === key),
    )
  );
}
export function hasPermission(
  member: FamilyMember | undefined,
  key: MemberPermission,
): boolean {
  if (!member?.active) return false;
  if (member.role === "superadmin") return true;
  return (
    member.permissions?.[key] ??
    MEMBER_PERMISSIONS.find((p) => p.key === key)!.defaultValue
  );
}
export function memberPermissionDefaults(): Record<MemberPermission, boolean> {
  return Object.fromEntries(
    MEMBER_PERMISSIONS.map((p) => [p.key, p.defaultValue]),
  ) as Record<MemberPermission, boolean>;
}

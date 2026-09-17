import { describe, expect, it } from "vitest";
import {
  hasPermission,
  isMemberPermissions,
  MEMBER_PERMISSIONS,
} from "../src/lib/member-permissions";
import type { FamilyMember } from "../src/lib/shared-contract";
const member: FamilyMember = {
  userId: "a",
  email: "a@example.test",
  role: "member",
  active: true,
  playerId: null,
};
describe("member permission policy", () => {
  it("preserves defaults for legacy accounts and makes every override explicit", () => {
    for (const p of MEMBER_PERMISSIONS) {
      expect(hasPermission(member, p.key)).toBe(p.defaultValue);
      expect(
        hasPermission({ ...member, permissions: { [p.key]: false } }, p.key),
      ).toBe(false);
      expect(
        hasPermission({ ...member, permissions: { [p.key]: true } }, p.key),
      ).toBe(true);
      expect(
        hasPermission(
          { ...member, active: false, permissions: { [p.key]: true } },
          p.key,
        ),
      ).toBe(false);
      expect(
        hasPermission(
          { ...member, role: "superadmin", permissions: { [p.key]: false } },
          p.key,
        ),
      ).toBe(true);
    }
  });
  it.each([
    null,
    [],
    { deleteHistory: true },
    { scoreGames: "false" },
    { scoreGames: null },
  ])("rejects malformed permission settings %j", (value) => {
    expect(isMemberPermissions(value)).toBe(false);
  });
});

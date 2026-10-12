/** Build-time product switch only. Never gate journal readers or mode metadata. */
export const wordBuddyAvailable =
  process.env.NEXT_PUBLIC_AMBERLY_WORD_BUDDY_ENABLED !== "false";

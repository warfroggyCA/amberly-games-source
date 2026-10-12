/** Build-time tools switch. Never gate immutable definitions or journal readers. */
export const coachingAvailable =
  process.env.NEXT_PUBLIC_AMBERLY_COACHING_ENABLED !== "false";

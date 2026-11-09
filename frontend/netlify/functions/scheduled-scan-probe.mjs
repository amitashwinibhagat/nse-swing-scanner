import { runScheduledWindow } from "../lib/dispatch-scan.mjs";

/**
 * TEMPORARY one-shot probe (added 2026-11-09, delete after the test).
 *
 * Proves the punctual scheduler end-to-end: that Netlify fires the function on
 * the configured minute, that the dispatch reaches GitHub with HTTP 204 on the
 * FIRST attempt, and that scan.yml then attributes the run to
 * `external-scheduler` for the named window.
 *
 * It exists because the morning/evening functions 422'd on every tick for two
 * days without anyone noticing. `force` is deliberate: today's 10:30 window is
 * already covered, so without it the run would be suppressed and the probe
 * would prove only half the path.
 *
 * Scheduled inline (not in netlify.toml) so the CI cron guard, which asserts
 * netlify.toml holds exactly the two real windows, stays green.
 */
export default async () => {
  await runScheduledWindow("10:30", { force: true });
};

export const config = { schedule: "43 11 9 11 *" };

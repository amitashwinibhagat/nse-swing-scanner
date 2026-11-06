import { runScheduledWindow } from "../lib/dispatch-scan.mjs";

/**
 * Morning scan (03:30 UTC = 09:00 IST, pre-open).
 *
 * Netlify scheduled function — see netlify.toml `[functions."scheduled-scan-morning"]`.
 * Invoked by Netlify's scheduler, not by URL; there is no HTTP surface.
 */
export default async () => {
  await runScheduledWindow("03:30");
};

export const config = { schedule: "30 3 * * 1-5" };

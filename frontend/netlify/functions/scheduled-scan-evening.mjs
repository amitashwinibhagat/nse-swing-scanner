import { runScheduledWindow } from "../lib/dispatch-scan.mjs";

/**
 * Evening scan (10:30 UTC = 16:00 IST, post-close).
 *
 * Netlify scheduled function — see netlify.toml `[functions."scheduled-scan-evening"]`.
 * Invoked by Netlify's scheduler, not by URL; there is no HTTP surface.
 */
export default async () => {
  await runScheduledWindow("10:30");
};

export const config = { schedule: "30 10 * * 1-5" };

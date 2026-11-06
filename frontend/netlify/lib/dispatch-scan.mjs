/**
 * Punctual scan dispatch.
 *
 * Why this exists
 * ---------------
 * GitHub Actions `schedule` on this repo is not "approximately on time" — it is
 * hours late. Measured over 45 scheduled runs: median delay 5.4 h, 37 of 45 more
 * than 4 h late, worst 10 h. A cron cannot fire *early*, so the run that lands
 * at 11:16 UTC is the 03:30 cron. The "09:00 IST scan" therefore completed
 * around 16:46 IST, after the 15:30 close.
 *
 * Netlify's scheduled functions run on Netlify's own scheduler (UTC), which is
 * not subject to GitHub's runner queue. They fire on time, and this module
 * turns that tick into a `repository_dispatch` for the scan workflow, naming the
 * window explicitly so `scan_status.json` attributes it correctly.
 *
 * The GitHub crons stay in place as a fallback (if Netlify is down, a scan still
 * happens — late). To stop the two from both running for the same window, the
 * workflow skips itself when the last committed scan is already newer than the
 * window occurrence it was triggered for. See "Resolve schedule context" in
 * .github/workflows/scan.yml.
 */

const GITHUB_API = "https://api.github.com";

/** Overridable for forks; defaults match this repo. */
export const CONFIG = {
  repo: process.env.GITHUB_REPO || "amitashwinibhagat/nse-swing-scanner",
  ref: process.env.GITHUB_REF_NAME_DEFAULT || "main",
  eventType: "scheduled-scan",
};

function token() {
  const value = process.env.GITHUB_DISPATCH_TOKEN;
  if (!value) {
    throw new Error(
      "GITHUB_DISPATCH_TOKEN is not set — the scheduled scan cannot dispatch the workflow",
    );
  }
  return value;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ask GitHub to run scan.yml for a specific window.
 *
 * Retries on network errors and 5xx; does not retry 401/403/404, which mean the
 * token or repo is wrong and will not fix themselves in 5 seconds.
 *
 * @param {string} window  "03:30" or "10:30" (UTC, must match SCAN_WINDOWS_UTC)
 * @param {{attempts?: number}} [opts]
 * @returns {Promise<{ok: boolean, status: number, window: string, attempts: number}>}
 */
export async function dispatchScan(window, { attempts = 3 } = {}) {
  // Resolve the token BEFORE the retry loop. A missing/blank token is a
  // configuration error: retrying it three times with backoff just delays the
  // failure and hides the real reason behind a generic "status 0".
  const authToken = token();

  const url = `${GITHUB_API}/repos/${CONFIG.repo}/actions/workflows/scan.yml/dispatches`;
  let lastStatus = 0;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          "User-Agent": "nse-swing-scanner-netlify-scheduler",
        },
        body: JSON.stringify({
          ref: CONFIG.ref,
          // The workflow reads `client_payload.window` to attribute the run.
          // Without it the run is treated as ad-hoc and gets no healthcheck.
          client_payload: { window, source: "netlify-schedule" },
        }),
      });

      lastStatus = res.status;
      if (res.status === 204) {
        return { ok: true, status: res.status, window, attempts: attempt };
      }

      // 401/403/404: configuration problem, retrying cannot help.
      if ([401, 403, 404].includes(res.status)) {
        let detail = "";
        try {
          const body = await res.json();
          detail = body?.message ? `: ${body.message}` : "";
        } catch {
          /* body was not JSON */
        }
        console.error(
          `dispatch-scan: GitHub rejected the dispatch (${res.status})${detail}. ` +
            "Check GITHUB_DISPATCH_TOKEN scope (Actions: write) and GITHUB_REPO.",
        );
        return { ok: false, status: res.status, window, attempts: attempt };
      }

      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts) {
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }

  console.error(
    `dispatch-scan: giving up dispatching window ${window} after ${attempts} attempts`,
    lastError,
  );
  return { ok: false, status: lastStatus, window, attempts };
}

/**
 * Netlify scheduled-function entrypoint body, shared by both window functions.
 *
 * Scheduled functions cannot be invoked over HTTP (Netlify does not expose a
 * URL for them), so there is no unauthenticated surface here.
 */
export async function runScheduledWindow(window) {
  const result = await dispatchScan(window);
  if (!result.ok) {
    // Throwing marks the invocation failed, which Netlify surfaces in the
    // function log and in the deploy's function summary. A silent failure here
    // is what let the original cron drift go unnoticed for weeks.
    throw new Error(
      `scan dispatch failed for window ${window} (status ${result.status})`,
    );
  }
  console.log(
    `dispatch-scan: queued scan.yml for window ${window} ` +
      `(attempt ${result.attempts})`,
  );
  return result;
}

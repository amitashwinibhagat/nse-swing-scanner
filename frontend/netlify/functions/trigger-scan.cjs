const crypto = require("node:crypto");

/**
 * Constant-time comparison of two strings.
 *
 * `provided !== expected` short-circuits on the first differing byte, which
 * leaks the shared secret's prefix to anyone willing to time the endpoint.
 * Both values are hashed first so `timingSafeEqual` gets equal-length buffers
 * regardless of what the caller sent.
 */
function secretsMatch(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// Best-effort in-process throttle. Netlify functions are ephemeral, so this is
// not a hard guarantee — but it turns "unlimited queued 60-minute scans from a
// leaked token" into "one per minute per instance", and the cap below bounds
// the damage either way. The workflow's concurrency group queues rather than
// cancels, so an unthrottled endpoint is a free denial-of-service on the
// runner budget.
const WINDOW_MS = 60 * 1000;
const lastTriggerByKey = new Map();

function rateLimited(key, now = Date.now()) {
  const last = lastTriggerByKey.get(key) || 0;
  if (now - last < WINDOW_MS) return true;
  lastTriggerByKey.set(key, now);
  return false;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { Allow: "POST" },
      body: JSON.stringify({ ok: false, error: "method_not_allowed" }),
    };
  }

  const expected = process.env.SCAN_TRIGGER_SECRET;
  if (!expected) {
    // Do NOT describe the misconfiguration to an unauthenticated caller: the
    // old response ("server_misconfigured") confirmed which env var to attack.
    console.error("trigger-scan: SCAN_TRIGGER_SECRET is not set");
    return {
      statusCode: 503,
      body: JSON.stringify({ ok: false, error: "unavailable" }),
    };
  }

  const auth = event.headers.authorization || event.headers.Authorization || "";
  const match = auth.match(/^Bearer\s+(.+)$/);
  const provided = match ? match[1].trim() : "";
  if (!secretsMatch(provided, expected)) {
    return {
      statusCode: 401,
      body: JSON.stringify({ ok: false, error: "invalid_secret" }),
    };
  }

  const throttleKey = `${event.headers["x-nf-client-connection-ip"] || event.headers["client-ip"] || "unknown"}`;
  if (rateLimited(throttleKey)) {
    return {
      statusCode: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "60" },
      body: JSON.stringify({ ok: false, error: "rate_limited" }),
    };
  }

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) {
    console.error("trigger-scan: GITHUB_DISPATCH_TOKEN is not set");
    return {
      statusCode: 503,
      body: JSON.stringify({ ok: false, error: "unavailable" }),
    };
  }

  const url =
    "https://api.github.com/repos/amitashwinibhagat/nse-swing-scanner/actions/workflows/scan.yml/dispatches";

  let ghRes;
  try {
    ghRes = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "nse-swing-scanner-netlify-function",
      },
      body: JSON.stringify({ ref: "main" }),
    });
  } catch (e) {
    return {
      statusCode: 502,
      body: JSON.stringify({ ok: false, error: "github_dispatch_failed" }),
    };
  }

  if (ghRes.status === 204) {
    return {
      statusCode: 202,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: true,
        message: "Scan queued",
        actionsUrl:
          "https://github.com/amitashwinibhagat/nse-swing-scanner/actions/workflows/scan.yml",
      }),
    };
  }

  if (ghRes.status === 401 || ghRes.status === 403) {
    let detail = "token lacks repo scope or is revoked";
    try {
      const j = await ghRes.json();
      if (j && j.message) detail = j.message;
    } catch {}
    // Log the detail; do not hand GitHub's internals to the caller.
    console.error("trigger-scan: GitHub rejected dispatch", ghRes.status, detail);
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "github_dispatch_failed" }),
    };
  }

  if (ghRes.status === 404) {
    let detail = "workflow or token permission missing";
    try {
      const j = await ghRes.json();
      if (j && j.message) detail = j.message;
    } catch {}
    console.error("trigger-scan: GitHub 404 on dispatch", detail);
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "github_dispatch_failed" }),
    };
  }

  let detail = `unexpected status ${ghRes.status}`;
  try {
    const j = await ghRes.json();
    if (j && j.message) detail = j.message;
  } catch {}
  console.error("trigger-scan: GitHub dispatch unexpected status", ghRes.status, detail);
  return {
    statusCode: 502,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: false, error: "github_dispatch_failed" }),
  };
};
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
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: "server_misconfigured" }),
    };
  }

  const auth = event.headers.authorization || event.headers.Authorization || "";
  const match = auth.match(/^Bearer\s+(.+)$/);
  const provided = match ? match[1].trim() : "";
  if (!provided || provided !== expected) {
    return {
      statusCode: 401,
      body: JSON.stringify({ ok: false, error: "invalid_secret" }),
    };
  }

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: "github_token_missing" }),
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
    console.error("trigger-scan: GitHub rejected dispatch", ghRes.status, detail);
    return {
      statusCode: 502,
      body: JSON.stringify({ ok: false, error: "github_dispatch_failed", detail }),
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
      body: JSON.stringify({ ok: false, error: "github_dispatch_failed", detail }),
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
    body: JSON.stringify({ ok: false, error: "github_dispatch_failed", detail }),
  };
};
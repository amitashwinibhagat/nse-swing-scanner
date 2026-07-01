# Security Policy

## Reporting a vulnerability

Please report security issues privately via GitHub's "Report a vulnerability"
flow on the repository's Security tab. Do not file a public issue for
security-relevant problems.

## Scope

This project pulls data from public Indian market sources (NSE, BSE, yfinance,
Screener.in) and renders a static dashboard. There is no backend server, no
user data, no authentication, and no trading capability — so the practical
attack surface is small.

What we do care about:

- **Source abuse / scraping**: this project scrapes NSE, BSE, and Screener.in.
  Be considerate of those services. The default settings already include
  polite sleeps, on-disk caching, and graceful fallback when sources are down.
  Don't bypass them to flood sources.
- **Dependencies**: keep `backend/requirements.txt` and `frontend/package.json`
  current. CI builds will surface outdated dependencies.
- **GitHub Actions permissions**: the scheduled scan workflow has
  `contents: write` to commit scan output. PRs from forks do not get this
  permission, which is the intended default.

## Data integrity caveats

This project is informational only. Do not use it to make investment
decisions without cross-checking against authoritative sources. It is not
SEBI-registered research.

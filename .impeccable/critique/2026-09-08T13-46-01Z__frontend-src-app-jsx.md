---
target: frontend/src/App.jsx
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/amitashwini/Projects/nse-swing-scanner/frontend/src/App.jsx"
target_fingerprint: "sha256:394317734a446216690a0543576f84dfef717693cde28d1e344a0165c2c578a0"
target_path: /Users/amitashwini/Projects/nse-swing-scanner/frontend/src/App.jsx
timestamp: 2026-09-08T13-46-01Z
slug: frontend-src-app-jsx
closed: true
---
⚠️ DEGRADED: single-context (no sub-agent tool exposed in this session)

Method: sequential single-context — Assessment B (detector/browser) ran before
Assessment A (design review), so A is anchored. Disclosed in Run Notes.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Last-scan time, drift, coverage and source status are strong; logging a trade swaps text to "In my trades" with no other confirmation. |
| 2 | Match System / Real World | 2 | "Buy zone / Stop / Target" speak trader; F-Score, RSI, ADV, ATR and R:R remain jargon, only partly tooltipped. |
| 3 | User Control and Freedom | 3 | Dismissible banners, clear filters, Esc-closable drawer, removable trades. No undo after removing a trade. |
| 4 | Consistency and Standards | 3 | Consistent tokens, but side-tab accent borders appear on 4 cards and not others; focus treatment differs by control. |
| 5 | Error Prevention | 3 | Fail-closed gates, "budget < 1 share" message, inline-edit commits on blur. |
| 6 | Recognition Rather Than Recall | 3 | Labels and reason chips keep options visible; R-multiple lives only in My trades. |
| 7 | Flexibility and Efficiency | 2 | Search, sort, CSV, watchlist, table view. No keyboard shortcuts, no bulk actions. |
| 8 | Aesthetic and Minimalist Design | 3 | Shortlist-first fixed the worst overload, but 11px micro-text, em-dash density and collapsed panels keep it from feeling quiet. |
| 9 | Error Recovery | 3 | Empty states, stale/coverage banners, source-failure status. If localStorage is cleared the journal silently vanishes with no recovery. |
| 10 | Help and Documentation | 3 | Field guide, methodology page and tooltips are strong; no in-context help for the journal. |
| **Total** | | **28/40** | **Good — address weak areas, solid foundation** |

## Design Specificity Verdict

**LLM assessment.** This reads as authored for *this* product: Fraunces display
against IBM Plex Mono numerals, a dark editorial palette, the "RECEIPTS" banner
that mirrors the tracker, a shortlist grounded in the 63+ band, and a private
"I took this" journal. That is a real point of view. What is not specific: the
card/KPI/table vocabulary is standard fintech-dashboard, and the 3px side-tab
accent border is the single most recognizable AI-generated-UI tell. The 11px
micro-typography is a "cram more data" reflex rather than a decision.

**Deterministic scan.** CLI (`detect.mjs` on `frontend/src`): 6 warnings —
4× `side-tab` (`styles.css` 816, 1331, 1974, 2298), 1× `bounce-easing`
(`--ease-spring`, line 59), 1× `layout-transition` (`.subscore-fill`,
`transition: width`, line 669). In-page overlay (`detect.js`, injected via CDP):
**78 anti-patterns**, including tiny body text, line length too long,
undersized functional text, low contrast text, side-tab accent border, one
occluded-text instance, and an "em-dash overuse: 12 em-dashes in body text"
banner.

**False positives.** `bounce-easing` flags a token that is defined but never
applied — cleanup, not a live defect. A computed-contrast probe flagged
`.pick-action-detail` at 1.46:1, but that ignored alpha compositing; the real
composited ratio is ~5.4:1, which passes AA.

**Visual overlays.** Injection succeeded (mutation confirmed, `detect.js`
loaded, 78 findings). The browser session was headless and has been closed, so
no persistent human-visible overlay remains; the findings above are the
evidence.

## Overall Impression

The shortlist-first IA and the decision-complete card are the right product
moves and they landed. The remaining gap is craft: the interface still *looks*
like a dense terminal at small sizes, and several signals (side-tabs, em-dashes,
18px tap targets) are the exact things that make an AI-assisted product feel
machine-made. The single biggest opportunity: make the small text and the
status language carry the trust the tracker already earns.

## What's Working

1. **The shortlist earns its place.** Nine cards, each with action, levels,
   risk and reasons — the customer's decision is the product.
2. **The receipts loop is honest and specific.** The 63+ band claim is mirrored
   from `performance.json`, and weak bands are labeled rather than hidden.
3. **The journal closes the loop.** "I took this" plus live status is a genuine
   retention mechanic, and it stays local with no auth.

## Priority Issues

### [P1] Search input has no accessible name and no focus ring
- **Why it matters:** A screen-reader user hears "edit text" with no purpose;
  keyboard users lose the primary filter control's focus indicator.
- **Fix:** Add `aria-label="Filter stocks"` (or a visually-hidden `<label>`) and
  stop overriding `outline: 0` on `.search-wrap input`; keep the wrapper's
  `:focus-within` border as a secondary cue.
- **Suggested command:** `$impeccable audit`

### [P1] Mobile tap targets fall below 44×44
- **Why it matters:** The customer checks on a phone (Casey persona). The
  search-clear is 18×18, the watch star 20×20, theme toggle 34×32, export pill
  123×34, and segmented buttons 28px tall — mis-taps and abandonment.
- **Fix:** Give icon controls a 44×44 minimum hit area (padding or a
  pseudo-element), and raise the segmented control height.
- **Suggested command:** `$impeccable adapt`

### [P2] Micro-typography and em-dash density read as machine-made
- **Why it matters:** The in-page detector flags tiny body text, undersized
  functional text, and 12 em-dashes in body copy. Risk, reasons and fineprint
  at 11px are hard to read on a phone and undercut the trust the tracker earns.
- **Fix:** Raise functional text to a 12px floor (keep 11px only for true
  labels), widen the type scale's bottom, and replace most em-dashes with
  periods/colons.
- **Suggested command:** `$impeccable typeset`

### [P2] Side-tab accent borders (4 instances) are the signature AI-UI tell
- **Why it matters:** The 3px left border on `.pick-card`, `.my-trades`,
  `.stock-card[data-pass]` and `.exit-warnings` is the most recognizable
  generated-UI signal and it competes with the score ring for attention.
- **Fix:** Replace it with a subtler status cue — a tinted header bar, a small
  corner ribbon, or a top hairline — keeping the "passed/attention" meaning.
- **Suggested command:** `$impeccable quieter`

### [P2] `.subscore-fill` animates a layout property
- **Why it matters:** `transition: width` triggers layout on every bar; on
  low-end phones the drawer opening janks.
- **Fix:** Animate `transform: scaleX()` with `transform-origin: left`, or use
  `grid-template-columns` if a real width change is required.
- **Suggested command:** `$impeccable optimize`

## Persona Red Flags

**Casey (Distracted Mobile User).** 18×18 clear button and 20×20 watch star are
under half the 44pt minimum; 11px risk/reason text strains one-handed reading;
the dense pick card plus sticky hero means a lot of scroll before the first
action.

**Sam (Accessibility-Dependent).** `#search` has no accessible name and its
outline is suppressed; status is conveyed with color-toned badges (text labels
mostly accompany them, but the tone is the primary signal); the drawer traps
scroll correctly and Esc closes it.

**Jordan (First-Timer).** "In the buy zone", "R:R", "F-Score 9/9", "ATR" and
"ADV" assume prior knowledge; tooltips help on hover, which a first-timer on a
phone will never see.

**Rohit (project persona, from PRODUCT.md).** Wants action and gets it, but the
11px functional text and the "63+ band" framing need the receipts banner to
make sense; on mobile the card's information density works against the
two-minute decision he came for.

## Minor Observations

- Heading reads "Top picks7" to assistive tech — add a separator or an
  `aria-label`.
- One "text occluded by an overlapping element" finding; likely the sticky hero
  over content — worth a quick look.
- "Line length too long" in the rationale/performance sections.
- `--ease-spring` is defined but unused; remove or apply it deliberately.
- Removing a trade has no undo.

## Questions to Consider

- What if the 11px tier did not exist at all — would the card lose information
  or just lose noise?
- Does the "63+ band" need to be explained on the card, or is the receipts
  banner enough?
- Could the pass/attention signal live in the score ring itself instead of a
  left border?
- What would the mobile card look like if it were designed phone-first?

---
inclusion: fileMatch
fileMatchPattern: ["frontend/**/*.tsx", "frontend/**/*.ts", "frontend/**/*.css", "frontend/tailwind.config.*"]
---

# Design system: Relay

**Idea:** a referral is a route between two places. The UI's one memorable element is the
**route track**, a horizontal line of stage nodes for each referral, where a stalled stage shows how
long it has been waiting against its limit. Everything around it stays quiet: white surfaces, one
green-teal, plain sentences.

## Tokens (tailwind.config: extend colors / fontFamily)
| Token | Hex | Use |
|---|---|---|
| `ink` | #1C2B33 | primary text, headings |
| `muted` | #5B6B70 | secondary text, captions |
| `line` | #DDE3E0 | borders, future track segments |
| `paper` | #F6F8F7 | app background (cool, not cream) |
| `surface` | #FFFFFF | panels, rows |
| `hemlock` | #1F5F5B | primary actions, completed track, links |
| `hemlock-tint` | #E3EFEC | selected row, current-stage fill |
| `amber` | #9A5208 | overdue text and icons (stuck) |
| `amber-tint` | #FBEFD9 | overdue elapsed bar background |
| `rust` | #A3302A | the two challenge failures only (never scheduled, plan never returned) |
| `rust-tint` | #F8E3E0 | their elapsed bar |

Color always pairs with a text label or icon. Red is reserved for the two challenge failures.
Everything else that's stuck is amber.

**Type:** Public Sans (the U.S. Web Design System typeface, loaded from Google Fonts), weights 400,
600, 700. Use `font-variant-numeric: tabular-nums` for every number. **No monospace** except the
FHIR JSON viewer. Scale: 28/36 page sentence · 20/28 section · 15/22 body · 13/18 caption.
Sentence case everywhere. No all-caps labels, no letter-spaced eyebrows, no middle-dot meta strings,
no "→" in button text.

**Shape:** radius 6px on controls, 10px on panels. Borders, not shadows. A single subtle shadow
only on popovers and drawers.

## App shell
```
┌──────────────┬───────────────────────────────────────────────────────────────┐
│ Relay        │ Demo with synthetic patients. Specialist replies are simulated │  ← thin banner, muted
│              ├───────────────────────────────────────────────────────────────┤
│ Needs        │ Quabbin Hills Family Medicine          Demo date Oct 24 [+1d][+7d][Reset] │
│  attention   │                                                               │
│ New referral │   (content, max-width 1180px, left-aligned)                   │
│ Inbox        │                                                               │
│ Specialist   │                                                               │
│  portal      │                                                               │
│  (simulated) │                                                               │
└──────────────┴───────────────────────────────────────────────────────────────┘
```
Left rail 220px (collapses to a top bar under 900px). The wordmark "Relay" is set in Public Sans 700
with a small route glyph (two dots joined by a line), not a stock icon.

## Dashboard
The headline is a sentence built from computed counts, with the numbers in 700 weight:
> **7** open referrals. **5** need attention, including **1** never scheduled and **1** plan never returned.

No big-number KPI tiles. Median days sent to scheduled goes in a muted caption under the sentence.

Then two groups, in this order, each with a plain heading:
1. **Never scheduled or plan never returned** (the challenge failures, rust)
2. **Other referrals waiting** (amber)

Each item is a **row**, not a card:
```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ Lajuana Wilkinson            ●━━━━━●━━━━━━━━━━━━━━━━━━━━━━━━○─────○─────○─────○        │
│ Great Barrington to Worcester  Sent  Accepted  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░  Scheduled  Seen …    │
│ 78 mi straight-line, R-102           14 days waiting, limit 7                          │
│ Nephrology                                                                             │
│ Accepted 14 days ago, no appointment yet.  [Transportation barrier]   [Draft follow-up]│
└───────────────────────────────────────────────────────────────────────────────────────┘
```
- **Route track (the signature):** filled hemlock nodes for completed stages, a ring for the current
  stage, `line` gray for future stages. On a stuck referral, the segment after the current node
  becomes an **elapsed bar**: its length is days waiting ÷ limit, capped at 2×, with a tick at the limit
  and the caption "14 days waiting, limit 7". Use amber, or rust for the two challenge failures.
  Stage names sit under the nodes in 13px muted text.
- **Names:** strip Synthea's digits for display ("Lajuana164 Wilkinson796" → "Lajuana Wilkinson").
  Keep IDs in the data.
- **Route line:** "{patient town} to {practice town}, {n} mi straight-line".
- **Dates:** "Oct 15", never ISO.
- **Practice setting:** shown only as "limit 7" in the track caption, with the full "Practice setting" text in a
  tooltip.
- **Actions:** one per row. "Draft follow-up" is an outlined hemlock button. Filled hemlock is used
  only for the page's single primary action (for example, "New referral" in the header).
- Fictional practices show "(fictional)" in muted text after the name.

**All open referrals:** replace the 9-column kanban with
(a) one horizontal stacked bar of counts by stage, labeled, and (b) a compact table: patient,
specialty, route, stage, days in stage (sortable). Clicking a row opens referral detail.

## Motion (one moment only)
When the demo clock advances, elapsed bars grow to their new length (300 ms ease-out), and a referral
that crosses its limit moves into "Needs attention" with a brief highlight. That moment shows the
rules are computed live. No other ambient animation. Respect `prefers-reduced-motion` (no growth
animation; just update).

## Other screens (same system)
- **Referral detail:** route track large at top; left column timeline of events (date, actor, source:
  phone/fax/portal), right column "Log update", barriers, and place context. Place-context items are
  small definition lists with a source link and a muted "What this can't tell you" line.
- **New referral:** form on the left; practice results as rows (name, town, miles, Medicare assignment
  label, nearest acute hospital and its beds); the selected practice gets a hemlock-tint row.
- **Inbox (PCP):** reading layout, max 72ch: original reason, then the returned plan in template
  sections, then "Acknowledge and close".
- **Empty states** give direction: "No referrals need attention. Next check: tomorrow's demo date."
- **Errors** say what happened and what to do, with no apology.

## Quality floor
Visible focus ring (2px hemlock, offset 2px), 40px minimum hit targets, WCAG AA contrast (all token
pairs above pass on white), works at 375px width, `prefers-reduced-motion` respected.

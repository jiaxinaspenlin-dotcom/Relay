---
inclusion: fileMatch
fileMatchPattern: ["frontend/**/*.tsx", "frontend/**/*.ts", "frontend/**/*.css", "frontend/tailwind.config.*"]
---

# Design system: Relay

**Idea:** minimal words, lots of space, one action per row. A calm white workspace framed by one
bold element, the green rail. A referral is a route; its signature is the **route track**.

## Tokens (tailwind.config: extend colors / fontFamily / borderRadius)
| Token | Hex | Use |
|---|---|---|
| `ink` | #1C2B33 | text |
| `muted` | #5B6B70 | secondary text, captions, section headings |
| `line` | #DDE3E0 | 1px borders, future track |
| `paper` | #F6F8F7 | page background |
| `surface` | #FFFFFF | panels, rows |
| `hemlock` | #1F5F5B | accent: rail, primary buttons, completed track, links |
| `hemlock-tint` | #E3EFEC | selected row |
| `amber` / `amber-tint` | #9A5208 / #FBEFD9 | waiting |
| `rust` / `rust-tint` | #A3302A / #F8E3E0 | only the two challenge failures (not scheduled, no plan back) |

**Type:** Public Sans (Google Fonts) 400/600/700, tabular numbers everywhere, sentence case.
28px page headings, 20px section, 15px body, 13px captions. No all-caps, no middle-dot strings,
no arrows in buttons. **Shape:** 8px radius on buttons, 12px on panels, 1px borders, no shadows.
Content max-width 1000px, padding 40px 48px (20px on phones).

**Icons:** lucide-react. LayoutGrid (Dashboard), Inbox (Inbox), SlidersHorizontal (Settings),
ChevronLeft (back links), Stethoscope (dashboard background). Stroke 1.8 at 18px in the rail.

## Left rail (216px)
Solid hemlock. "Relay" wordmark in white, 20px bold, with a glyph: filled dot, short line, ring
dot. Nav items: icon + label, white at 82% opacity; active item has a white 16% background and
full white text; hover white 8%. White pill badges with hemlock text: Dashboard = referrals
needing attention, Inbox = unread plans. Practice name at the bottom, 13px, white at 75%.
No drawing in the rail. The rail stretches to the page height; its contents stay pinned.
Under 860px wide it becomes a top bar with icons only.

## Dashboard
Headline "{n} referrals need attention" (28px bold), "{n} open" muted below, filled hemlock
"New referral" top right (the page's only filled button). Sections with small muted 15px headings:
"Lost in the handoff" (rust), "Waiting" (amber), then "On track" (no action). Each section is one
white panel; rows separated by 1px lines. Row grid 1fr / 1.5fr / 160px:
- patient name (600, Synthea digits stripped), "{specialty}, {miles} mi" in 13px muted;
- route track, then a short status in 13px bold rust or amber ("Not scheduled, 14 days",
  "No plan back, 12 days", "Not confirmed received, 5 business days", "Missing records",
  "Missed appointment");
- one outlined hemlock button, right-aligned: Call office / Follow up / Send records / Message patient.
The whole row opens referral detail; the button is its own action above the row link. Row hover:
very light background.

**Background stethoscope (dashboard only):** lucide Stethoscope about 800px wide, hemlock at about
8% opacity, stroke 0.5, rotated -24deg, from the top right of the content down, partly off the
right edge, behind everything, pointer-events none. Hidden under 860px.

## Route track (the signature)
7 equal columns (Sent, Received, Contacted, Scheduled, Seen, Plan back, Closed), a 12px dot
centered in each, joined by a 2px gray line. Completed dots: filled hemlock with a hemlock line.
Current dot: a 3px ring, rust or amber when stuck. Future: white with a gray border. When stuck, a
6px bar (tinted fill, 1px colored border) starts at the current dot's center, length =
(days waiting / limit) x one column, capped at 2 columns, with a thin dark tick at the limit.
No labels on the dashboard; on referral detail, 13px stage labels and 12px muted dates under
each dot. Authorization is a chip, not a node.

## Referral detail
"Dashboard" back link with a chevron. Patient name 28px; "{specialty} at {practice}" muted;
chips (white pill, 1px border): "{town} to {practice town}, {miles} mi", insurance, authorization.
Primary "Call office (AI)" top right (only when stuck at Sent or Received). A white panel with the
large track and one status line ("Received 14 days ago, patient not contacted. Limit 7 days.").
Then two columns (1.3fr / 1fr): left Timeline (date column, what happened, source muted: fax,
office link, email, AI call); right stacked panels: Next step (full-width outlined buttons: Log
update, Message patient, Follow up, Log a barrier; office link), Transportation (PT-1 checkbox
with "At least 3 business days before the visit" for MassHealth members with a transportation
barrier; free-text plan otherwise), Referral rules (the insurance hint), {County} County
(shortage area, routine checkup rate, "HRSA, CDC PLACES. About the area, not this patient.").

## Office link page
No rail or app chrome; designed for a phone. Title "{Specialty} referral", "From {practice}"
muted, a summary card, then full-width white buttons (10px radius, 14px padding): Received,
Something is missing (checklist), Authorization status, Patient contacted, Scheduled (date and
time), Seen, No-show, Declined (reason), Return plan. A filled "Send update" button. A one-line
confirmation after each action.

## Inbox
Reading layout, max 72 characters per line: the original question, the returned plan in
template sections, then "Acknowledge and close".

## Writing, motion, quality
Short sentences. Dates as "Oct 15". Empty states give direction ("No referrals need
attention."). Errors say what happened and what to do. Motion only when Demo mode advances the
clock: waiting bars grow (300ms ease-out) and a newly stuck row highlights. Respect reduced motion.
Visible 2px hemlock focus rings, 40px minimum targets, WCAG AA contrast, works at 390px.
Screenshots of every screen at 1440px and 390px live in docs/screenshots/.

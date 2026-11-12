# UI modernization — Phase 4 report: admin console

Branch `claude/ui-phase-4-admin`, based on `main` at a45095b (Phase 3 merged).
Scope is the six approved Phase 4 priorities, following the Phase 0 admin plan.
It keeps the vanilla JS architecture and the game's design language. All admin permissions and server checks are unchanged: no server code, database schema, API contract or moderation consequence changed. The Phase 1–3 accessibility work is kept, and no dependency was added.

## Summary

| Priority | Result |
|---|---|
| 1. Shared design system | The 45-line `<style>` block in `admin.html` moved into `style.css` on the shared tokens (colours, type scale, spacing, radius, focus ring). **Inline styles on rendered admin screens: up to 87 → 0.** Only data values remain inline (`--w` bar widths, `--n` map sizes). Density is kept: 14px tables, compact forms. |
| 2. Navigation | Four labelled groups: Players and moderation, World, Content, Staff (admins only). **From 768px:** a sticky sidebar listing every section. **On phones:** a group switcher plus the current group's sections. The open-report count shows in the navigation. **Deep links:** `#chat`, `#player/<id>`, `#zone/<id>`, and the browser's Back button works. **Content start:** 285 → 197–239px at 320, and 157 → 59–67px from 768. |
| 3. Tables | Every table has `<thead>` with `scope="col"` headers (before: 0 scoped headers; most tables had no header row). **Clickable rows → 0** (up to 12 mouse-only `tr.click` rows per screen before); row actions are real buttons. When the content column is narrow, rows become labelled cards, so no column is hidden. **Words broken to fit: CRUSHED_BEFORE → 0.** |
| 4. Forms | Every control has a visible label. Hints and errors are tied with `aria-describedby`. Inline validation explains the server's rules before anything is sent. Submit buttons show pending (`aria-busy`) and allow one request at a time. Server errors stay inside the form (`role="alert"`) with the values kept. Typed values, focus and caret survive data arriving. |
| 5. Moderation workflow | Each report opens an **inline review** of the sender: level, current sanctions, strikes, recent history, and a sanction form with the reason pre-filled from the report. Remove message and Dismiss report sit beside it. **Leaving the reports to sanction: before, two section changes, and the report context was lost; after, none.** Steps stay explicit, use the Phase 3 confirmations, and follow the server's permissions. |
| 6. Zone editor | A section index with per-section problem counts. A live problem summary whose items jump to the section. A sticky save bar ("1 problem to fix before saving", announced politely). Save moves you to the problems. A **sticky, scrolling preview** beside the form when the content column is at least 720px; in normal flow on phones. Overworld squares are **32px and named** (before: OW_BEFORE). |

## Acceptance criteria

All measured with `tools/admin-shots.mjs`: 12 screens at 320, 390, 768, 1024 and 1440 (60 captures), fake backend.
- "Before" is `main` at a45095b.
- Raw data: `docs/ui-audit/phase-4/summary-before.json` and `summary-after.json`.

| AC | Criterion | Before | After |
|---|---|---|---|
| AC4-1 | No admin-only stylesheet; no presentational inline styles | 45-line `<style>` block; inline styles up to 87 per screen | none; 0 on all 60 captures |
| AC4-2 | Grouped, labelled navigation; current section marked; every section reachable by keyboard; content start | 11 flat chips; content at 285px (320) / 157px (768+) | 4 groups; content at 197–239px (320) / 59–67px (768+) |
| AC4-3 | Tables: scoped headers, no mouse-only rows, no squeezed words, no page overflow, nothing hidden on narrow screens | 0 scoped headers; up to 12 clickable rows; CRUSHED_BEFORE squeezed cells at 320 | all headers scoped; 0 clickable rows; 0 squeezed cells at all 5 widths; cards keep every column |
| AC4-4 | Forms: labels, hints, inline validation, pending, persistent server errors, values and focus preserved | labels only; server errors as toasts; values lost on re-render | all present (tests below) |
| AC4-5 | Report → message → player → sanction without leaving the report; explicit; permission-gated; confirmed | 2 section changes; report context lost | 0 section changes; inline |
| AC4-6 | Zone editor: section hierarchy, visible validation, usable preview, sticky where room allows | one long form; problems only in the preview box | index with counts, summary, save bar; sticky preview from a 720px content column |
| AC4-7 | Accessibility: axe (all impacts) 0 violations on all captures; tap targets ≥ 24px | AXE_BEFORE | AXE_AFTER |

### Deviations and judgement calls

- **Phone navigation shows the current group's sections, not all eleven at once.** Every group is always visible as a button, and every section is one or two taps away. Showing all eleven took 4 rows (170px) at 320. The Phase 1 test "section tabs are all visible on a phone" still passes (nothing is off screen), but its intent changed from "all chips shown" to "every group shown, the current group's sections shown". This is a deliberate trade for the 46–88px of content recovered.
- **Tables at 768px show as cards.** The sidebar leaves a 520px content column, and tables switch on the column's width (a container query), not the screen's. From 1024px they show as tables.
- **The review's pre-filled reason** quotes the reported message and the reporter's reason. The moderator can edit it, and it is never sent without the Phase 3 confirmation.
- **Not all new tests fail on `main` for behavioural reasons.** All 13 new tests fail against `main`, but some fail because the new structure (form ids, navigation groups) doesn't exist there, not on the specific behaviour each one tests.

### Copy defects fixed

- **Warnings.** The Phase 3 sanction confirmation said "They see the warning and the reason." The game shows the reason only alongside an active mute, jail or ban; **players are never shown warnings**. The form hint, the confirmation and the status line now say so.
- **Stale hint.** The old moderation hint said "Muted players can still play (chat is not built yet)". Chat exists; the hint was replaced.

## What changed

- **`public/css/style.css`**, new "admin console" section:
  - shell, sidebar and group switcher;
  - `table.data` with container-query cards;
  - the `.f` field pattern (`label`, `.hint`, `.field-msg`, `.form-error`, `.form-foot`);
  - report and review styles;
  - zone editor index, save bar and sticky preview.
- **`public/admin.html`**: no `<style>`; `body.admin-page`.
- **`public/js/admin.js`**:
  - `dataTable()`, `field()`, `formFoot()`;
  - `checkForm()` / `validate()` / `submitting()`;
  - form value snapshot and restore in `render()`;
  - grouped `nav()`;
  - `route()` / `applyRoute()` / `showTab()` with `history.pushState` and `popstate`;
  - inline `reviewPanel()` / `reportCard()`;
  - the shared `sanctionForm()` and `applySanction()`.
  - Fixed: the reports list used to nest table rows inside a cell, so "Reported by" lines rendered above the wrong message.
- **`public/js/admin-zones.js`**:
  - labelled fields with ids and fieldsets;
  - `SECTIONS` index with problem counts (`sectionOf()`);
  - live `refreshPreview()` updating preview, index and save bar without redrawing the form;
  - preview cells are non-interactive spans in a scrolling frame;
  - overworld squares are named 32px buttons;
  - `edit(id)` for deep links.
- **Server rules restated, never relied on.** Moderators are limited to 7 days and can't sanction permanently. Admin-only actions are only shown to admins. The server still enforces all of it, and the fake backend mirrors it so the tests exercise those refusals.

## Tests

- `npm test`: RESULT_ENGINE.
- `npm run test:ui`: RESULT_UI.
  - All earlier tests kept. One Phase 1 admin test selector changed from `tr[data-v] [data-a="zoneEdit"]` to the row's real button, because rows are no longer clickable.
  - **13 new tests** in `tests/ui/admin-console.test.mjs`:
    - grouped navigation on desktop and phone (keyboard only), and moderator visibility;
    - deep links and Back;
    - tables at all 5 widths (headers, labelled cells, no clickable rows, no squeezed words, no overflow), and cards on phones with the keyboard;
    - inline validation; pending and one-request-at-a-time with the server error kept in the form; values, focus and caret preserved across a re-render;
    - the moderator report-to-sanction workflow (limits explained, confirmation cancel sends nothing, applied without leaving, explicit dismiss);
    - removing a reported message;
    - zone editor index, live problems and Save pointing at them;
    - sticky preview on wide screens only, and 32px named overworld squares.
  - **All 13 fail against `main`.**
- **Harness** (tests only):
  - a stateful fake admin backend (players, sanctions and history, reports, chat removal, audit log, hunts, events, economy, staff) that mirrors the server's permission rules;
  - a moderator account;
  - `ADMIN_CHAT` / `ADMIN_REPORTS` fixtures;
  - `tools/admin-shots.mjs`.

## Accessibility results

AXE_SECTION

## Evidence

`docs/ui-audit/phase-4/` holds `before-*` and `after-*` screenshots at 320, 390, 768, 1024 and 1440 (dashboard, players, player record, reports and chat, world, hunts, economy, zones, zone editor, announcements, audit log, staff), the review panel, and the metric and axe summaries.

## Not verified

- **Screen readers** (VoiceOver, TalkBack, NVDA): the group switcher, the review panel, the zone editor's live save note and table cards. The accessible names and relationships were checked in the DOM and by axe only.
- **Touch use** of the sticky save bar on iOS, with the on-screen keyboard open.
- **Real staff data volumes:** hundreds of reports or a long audit log. Fixtures are small. Lists are rendered in full, as before.

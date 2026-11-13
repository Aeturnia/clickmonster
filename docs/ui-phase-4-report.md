# UI modernization — Phase 4 report: admin console

**Status: complete.**
- **Approved:** in the final independent review at `a8d9dc6`. All four review findings (P4-01 to P4-04) are closed.
- **Merged:** into `main` as PR #13 (`baa75d9`) on 2026-11-12.
- **After the merge,** on `main` at `baa75d9`: `npm test` 24 of 24 and `npm run test:ui` 85 of 85 in each of 3 consecutive full runs.
- **Still owed before a release:** real devices, screen readers and live-backend staging, listed in `docs/backlog.md` under "Pre-release verification".

Branch `claude/ui-phase-4-admin`, based on `main` at a45095b (Phase 3 merged).
Scope is the six approved Phase 4 priorities, following the Phase 0 admin plan.
It keeps the vanilla JS architecture and the game's design language. All admin permissions and server checks are unchanged: no server code, database schema, API contract or moderation consequence changed. The Phase 1–3 accessibility work is kept, and no dependency was added.

## Summary

| Priority | Result |
|---|---|
| 1. Shared design system | The 45-line `<style>` block in `admin.html` moved into `style.css` on the shared tokens (colours, type scale, spacing, radius, focus ring). **Presentational inline styles on rendered admin screens: up to 18 per screen → 0.** Only data values remain inline (`--w` bar widths, `--n` map sizes). Density is kept: 14px tables, compact forms. |
| 2. Navigation | Four labelled groups: Players and moderation, World, Content, Staff (admins only). **From 768px:** a sticky sidebar listing every section. **On phones:** a group switcher plus the current group's sections. The open-report count shows in the navigation. **Deep links:** `#chat`, `#player/<id>`, `#zone/<id>`, and the browser's Back button works. **Content start:** 285 → 197–239px at 320, and 157 → 59–67px from 768. |
| 3. Tables | Every table has `<thead>` with `scope="col"` headers (before: 0 scoped headers; most tables had no header row). **Clickable rows → 0** (up to 12 mouse-only `tr.click` rows per screen before); row actions are real buttons. When the content column is narrow, rows become labelled cards, so no column is hidden. **Words broken mid-word to fit: 104 at 320 and 38 at 390 → 0 at all five widths.** |
| 4. Forms | Every control has a visible label. Hints and errors are tied with `aria-describedby`. Inline validation explains the server's rules before anything is sent. Submit buttons show pending (`aria-busy`) and allow one request at a time. Server errors stay inside the form (`role="alert"`) with the values kept. Typed values, focus and caret survive data arriving. |
| 5. Moderation workflow | Each report opens an **inline review** of the sender: level, current sanctions, strikes, recent history, and a sanction form with the reason pre-filled from the report. Remove message and Dismiss report sit beside it. **Leaving the reports to sanction: before, two section changes, and the report context was lost; after, none.** Steps stay explicit, use the Phase 3 confirmations, and follow the server's permissions. |
| 6. Zone editor | A section index with per-section problem counts. A live problem summary whose items jump to the section. A sticky save bar ("1 problem to fix before saving", announced politely). Save moves you to the problems. A **sticky, scrolling preview** beside the form when the content column is at least 720px; in normal flow on phones. Overworld squares are **40px and named** (before: 43px, labelled only by a two-letter abbreviation and a mouse-only `title`). |

## Acceptance criteria

All measured with `tools/admin-shots.mjs`: 12 screens at 320, 390, 768, 1024 and 1440 (60 captures), fake backend.
- Both columns use the same final metric definitions:
  - **Inline styles:** only presentational ones count. CSS custom properties carrying data, such as `--w` and `--n`, don't.
  - **Targets:** a checkbox counts by its label's size.
- "Before" is `main` at a45095b.
- Raw data: `docs/ui-audit/phase-4/summary-before.json` and `summary-after.json`.

| AC | Criterion | Before | After |
|---|---|---|---|
| AC4-1 | No admin-only stylesheet; no presentational inline styles | 45-line `<style>` block; presentational inline styles up to 18 per screen | none; 0 on all 60 captures |
| AC4-2 | Grouped, labelled navigation; current section marked; every section reachable by keyboard; content start | 11 flat chips; content at 285px (320) / 157px (768+) | 4 groups; content at 197–239px (320) / 59–67px (768+) |
| AC4-3 | Tables: scoped headers, no mouse-only rows, no squeezed words, no page overflow, nothing hidden on narrow screens | 0 of 70 headers scoped; up to 12 clickable rows; 104 words broken mid-word at 320, 38 at 390 | 310 of 310 headers scoped; 0 clickable rows; 0 broken words at all 5 widths; cards keep every column |
| AC4-4 | Forms: labels, hints, inline validation, pending, persistent server errors, values and focus preserved | labels only; server errors as toasts; values lost on re-render | all present (tests below) |
| AC4-5 | Report → message → player → sanction without leaving the report; explicit; permission-gated; confirmed | 2 section changes; report context lost | 0 section changes; inline |
| AC4-6 | Zone editor: section hierarchy, visible validation, usable preview, sticky where room allows | one long form; problems only in the preview box | index with counts, summary, a slim sticky save bar (at most a fifth of the screen; Restore and Delete in their own section); sticky preview from a 720px content column |
| AC4-7 | Accessibility: axe (all impacts) 0 violations on all captures; tap targets ≥ 24px | 0 violations; 12 targets under 24px (the zone list's Edit links at 320 and 390) | 0 violations and 0 targets under 24px on all 60 captures |

### Deviations and judgement calls

- **Phone navigation shows the current group's sections, not all eleven at once.** Every group is always visible as a button, and every section is one or two taps away. Showing all eleven took 4 rows (170px) at 320. The Phase 1 test "section tabs are all visible on a phone" still passes (nothing is off screen), but its intent changed from "all chips shown" to "every group shown, the current group's sections shown". This is a deliberate trade for the 46–88px of content recovered.
- **Tables at 768px show as cards.** The sidebar leaves a 520px content column, and tables switch on the column's width (a container query), not the screen's. From 1024px they show as tables.
- **The review's pre-filled reason** quotes the reported message and the reporter's reason. The moderator can edit it, and it is never sent without the Phase 3 confirmation.
- **The sticky save bar holds only the problem note, Save and Cancel.** Restore and Delete moved to an "Other actions" section after the form. With all five buttons the bar wrapped to three rows (about 190px) at 390 and covered the form. A test keeps it to at most a fifth of the screen.
- **Overworld squares are 40px instead of 43px**, a fixed size inside a scrolling frame so that larger Overworlds stay usable. Each is now named, for example "Ashford Vale is here, square 4, 7" or "Empty, square 2, 3".
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

- `npm test`: 24 of 24 pass.
- `npm run test:ui`: **68 of 68 pass in each of 3 consecutive full runs**.
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
  - The broken-word check finds 104 broken words at 320 on `main`. It looks at whether each word's text lands on more than one line. A first attempt, which switched off wrapping and compared widths, reported 0 because the table simply re-laid itself out wider; it was replaced.
- **Older scripts updated for phone navigation.** On phones a section can sit in a closed group, so two Phase 3 admin tests and the `ui-shots` / `ui-states` admin scenes now open sections through a shared `adminTab()` harness helper.
- **Harness** (tests only):
  - a stateful fake admin backend (players, sanctions and history, reports, chat removal, audit log, hunts, events, economy, staff) that mirrors the server's permission rules;
  - a moderator account;
  - `ADMIN_CHAT` / `ADMIN_REPORTS` fixtures;
  - `tools/admin-shots.mjs`.

## Accessibility results

axe-core 4.10.2, all impacts including minor:

| Sweep | Before | After |
|---|---|---|
| Admin console: 12 screens × 320, 390, 768, 1024, 1440 (60 captures, `tools/admin-shots.mjs`) | 0 violations | **0 violations** |
| Game screens: 17 × 5 sizes (`tools/ui-shots.mjs`, includes the older admin captures) | 0 (Phase 3) | **0** (85 screens) |
| Game interaction states: 13 × 320, 390 (`tools/ui-states.mjs`) | 0 (Phase 3) | **0**, and no native dialogs |

- The new tests also run axe on the phone navigation, the dashboard with the sidebar, a form with an inline error, the report review panel and the zone editor with a problem.
- axe found nothing to fix on the old console. The improvements it doesn't measure are covered by the tests and metrics above:
  - grouping and current-section semantics;
  - scoped table headers;
  - labelled hints and errors (`aria-describedby`, `aria-invalid`);
  - named overworld squares;
  - a polite live save note;
  - focus moved to new content (records, reviews, zone sections, problems).

## Evidence

`docs/ui-audit/phase-4/` holds `before-*` and `after-*` screenshots at 320, 390, 768, 1024 and 1440 (dashboard, players, player record, reports and chat, world, hunts, economy, zones, zone editor, announcements, audit log, staff), the review panel, and the metric and axe summaries.

## Not verified

- **Screen readers** (VoiceOver, TalkBack, NVDA): the group switcher, the review panel, the zone editor's live save note and table cards. The accessible names and relationships were checked in the DOM and by axe only.
- **Touch use** of the sticky save bar on iOS, with the on-screen keyboard open.
- **Real staff data volumes:** hundreds of reports or a long audit log. Fixtures are small. Lists are rendered in full, as before.

## Review corrections (PR #13 review)

The review accepted the Phase 4 design: grouped navigation, cards in a narrow content column, the inline moderation workflow, shared styling and the zone editor layout. Two findings were corrected, both in the client. No server code, schema, API contract or permission check changed.

**P4-01: overlapping admin requests.**
- *Cause:*
  - `submitting()` kept one `pendingForm` id for the whole console. Starting an event and then saving Base settings overwrote it with `base`. When the event finished it cleared the shared flag, so Base settings looked idle while it was still sending, and a second press sent a second `setBase`.
  - Zone Save set `pending` and `aria-busy` on the button element directly and had no guard. Any re-render (adding a monster or path, data arriving) drew a fresh, idle Save button, and every press sent another `saveZone`. Each one bumps the zone's version and writes an audit entry.
- *Fix:*
  - `st.pendingForms` is a set with one flag per form: `submitting()` adds its form's id and removes it in `finally`, so success and failure both clear it, and requests from different forms no longer clear each other's flag. `formFoot()` draws pending from the set, so it survives any re-render.
  - The submit handler checks the flag before validating or asking anything. A press while a form is sending says "Still working on the last request." and sends nothing, and no second confirmation opens for forms that ask first (Start hunt, sanctions, Add staff).
  - Zone Save uses the same set with the key `zone:<id>` (`zone:new` for a new zone). The editor draws the Save button's pending state from it. A second press says "Still working" and sends nothing. On failure the flag clears, the problem shows, and the draft and focus on Save are kept.
- *Tests:*
  - "P4-01 two forms sending at once…": `startEvent` and `setBase` are both held. After the event is released, Base settings is still `aria-busy`, its typed value is kept, and a second press sends nothing. Then both clear, with exactly one request each.
  - "P4-01 a press while a confirmed form is sending…": Start hunt is confirmed and held. A second press opens no dialog and sends nothing.
  - "P4-01 zone save: pending survives re-renders…": `saveZone` is held. Adding a path re-renders the editor and Save stays pending. Two more presses send nothing, and there is exactly one `saveZone`.
  - "P4-01 zone save failure…": the save fails. Pending clears, the error shows, focus stays on Save, the edited name is kept, and saving again works.

**P4-02: granting staff access had no confirmation.**
- *Fix:* Add staff now asks first, through the Phase 3 `ask()` dialog, and only a confirmation sends `setStaff`.
  - **Admin:** a danger dialog. Confirm stays disabled until the email is typed (any letter case), and focus starts in that field.
  - **Moderator:** a normal dialog, with focus on the confirm button.
  - Both state what the role can do, as the admin edge function enforces it:
    - **Moderators** can look up players and their records, warn, mute, jail or ban for up to 7 days, lift sanctions, post news, and review reports and remove chat messages.
    - **Admins** can also edit heroes and their items, sanction for longer or permanently, change world settings, events and hunts, edit zones, delete news, see players' email addresses, and add or remove staff.
  - Both say the change takes effect straight away (the server reads the role on every request) and is recorded in the audit log (`setStaff` logs `staff:<role>`).
  - For someone already on staff the title names the change, for example "Change admin@… from admin to moderator?", and a demotion says they lose their admin powers. The form only sends an upsert, so this wording reflects what the server does.
  - Cancel sends nothing, keeps the typed values and returns focus to Add.
- *Tests:*
  - "P4-02 granting admin…": the dialog's title, tone, permissions, audit note and focus are checked, and axe passes with it open. Cancel sends nothing and keeps the values. A wrong email keeps Confirm disabled. Typing the email in a different case and confirming sends exactly one `setStaff` with `{ email, role: 'admin' }`.
  - "P4-02 granting moderator…": a normal dialog with no typing, permissions stated, and axe passing. Cancel sends nothing, and confirming sends exactly one request.
  - "P4-02 changing the role of existing staff…": the moderator-to-admin and admin-to-moderator titles, and the demotion note.

**Noted, not changed.** Some button-driven admin actions also have no single-flight guard: quick actions on a player record, Remove item, Dismiss report, Remove from staff, End event, Cancel hunt, Delete zone, Restore built-in zone, Delete news and Remove message. All except Dismiss report and the quick actions already confirm first. The orders named `submitting()` and zone Save, so these were left for the reviewer to decide. The re-review asked for them: see P4-03 below.

### Results
All on this laptop (Windows 11, Node 22.16, Playwright 1.63.0 Chromium), fake backend.

- **Baseline before the corrections** (`dfe77b9`, in a separate worktree): `npm test` 24 of 24, `npm run test:ui` 68 of 68.
- **After:** `npm test` 24 of 24 and `npm run test:ui` **75 of 75 in each of 3 consecutive full runs** (68 earlier tests plus 7 new).
- **New tests against the old code** (`UI_PUBLIC_DIR` set to the `dfe77b9` checkout): 6 of the 7 fail, each on the behaviour it tests:
  - two forms: "Base settings is still pending after the event finished" (`aria-busy` was gone);
  - confirmed form: "no second dialog" (a second dialog opened);
  - zone save: "Save is still pending after a re-render" (it wasn't);
  - all three staff tests: no confirmation dialog appears.
  - The zone-save **failure** test passes on the old code too: the old failure path already cleared the button and kept the draft. It is kept as a guard for the new state-driven pending flag.
- **Admin accessibility sweep** (`tools/admin-shots.mjs`, 12 screens × 320, 390, 768, 1024, 1440): **0 violations of any impact on all 60 captures**. There is also 0 page overflow, 0 targets under 24px and 0 presentational inline styles. Raw data: `docs/ui-audit/phase-4/summary-after-corrections.json`.
- **Corrected states**, axe (all impacts) at 390 and 1440: the grant-admin dialog, the grant-moderator dialog, zone Save pending after a re-render, and Base settings pending after the event finished. **0 violations on all 8**, and no native dialogs. The two new staff tests also run axe with the dialog open.

### Evidence

`docs/ui-audit/phase-4/corrections/`:
- **`after-{390,1440}-…`:**
  - `staff-grant-admin`, `staff-grant-moderator`;
  - `zone-save-pending` (Save pressed and held, then a path added);
  - `world-two-forms-pending` (event finished, Base settings still sending).
- **`before-{390,1440}-…`:** the same two pending scenes on `dfe77b9`, where nothing shows as pending. There are no "before" staff shots: no dialog exists on the old code, and the capture timed out waiting for one.
- **`summary-corrections-after.json` and `summary-corrections-before.json`:** axe results, pending controls and request counts for each scene.

### Not verified

- **Screen readers:** announcement of the new dialogs and of the pending Save button. Checked in the DOM and by axe only.
- **Real devices.**
- **A real Supabase backend:** the tests hold and fail requests in the fake backend; no request was sent to the live project.

## Review corrections (PR #13 re-review)

The re-review accepted P4-01 and P4-02 at `bdb1f4d` and asked for one more correction.

**P4-03: protect the remaining admin button actions.**
- *Cause:* ten state-changing buttons sent their request on every press. Some also asked their confirmation again while the first request was still running: quick actions on a player record, Remove item, Delete news, Remove chat message, Dismiss report, End event, Cancel hunt, Remove from staff, Delete zone and Restore built-in zone. Several of the server's handlers write an audit entry on every call even when nothing changes; for example, resolving an already-resolved report logs again. So repeated presses could also duplicate audit records.
- *Fix, using the P4-01 pattern* (the same `st.pendingForms` set; no new framework):
  - **Stable keys:** each action has a key naming the action and its target: `resolveReport:<report>`, `chatDelete:<message>`, `endEvent:<event>`, `cancelHunt:<hunt>`, `deleteEvent:<news id>`, `removeStaff:<email>`, and `quick:<player>:<action>` / `removeItem:<player>:<item>`.
  - **Before anything else:** a press while that key is in flight says "Still working on the last request." and returns before any confirmation, so no second dialog opens and nothing is sent. The Phase 3 confirmations are otherwise unchanged and none were added.
  - **Pending drawn from state:** after every render, `markPending()` gives each button whose key is in flight the `pending` class and `aria-busy`. It survives re-renders and data refreshes, such as the chat lists being fetched again after another action.
  - **Clearing:** `pendingWhile(key, fn)` sets the flag, runs the request and clears the flag in `finally`. A failure stays on screen as a problem, focus stays on the button, and it can be pressed again. Actions that refresh a list afterwards (Dismiss report, Remove message, Delete news, Cancel hunt) stay pending until the refreshed list has arrived, so a stale button can't be pressed in between.
  - **Independent actions** have different keys, so one finishing never clears another.
  - **Zones:** Save, Delete and Restore on the same zone share the prefix `zone:<id>:`. While any of them is in flight, the others say "Still working on the last change to this zone." and neither ask nor send. Each button shows its own pending state.
- *Fake backend (tests only):* it now mirrors the server's effects for these actions, so a duplicate request shows up as a duplicate audit entry or a server refusal:
  - resolving a report marks it resolved, and resolving it again is logged again, as on the server;
  - End event, Cancel hunt, Delete news, setStaff, and zone save, delete and restore are logged;
  - End event and Cancel hunt refuse an event or hunt that is already gone;
  - zones are stored, so a deleted zone is refused the second time.

  Nothing in the server, the schema, the API or the permissions changed.
- *Tests* (`tests/ui/admin-console.test.mjs`). Each first waits for the first request to reach the fake backend, then presses again, and only then checks the pending look:
  - "P4-03 Dismiss report pressed repeatedly while delayed…": three presses send one `resolveReport`, with one `chat:resolveReport` audit entry. The button is pending and keeps focus, and axe passes afterwards.
  - "P4-03 a quick player action pressed repeatedly…": three presses of Full heal send one `update`, with one `edit` audit entry. Axe passes on the pending state.
  - "P4-03 a confirmed action pressed again while pending…": End event is confirmed and held. A second press opens no dialog and sends nothing, and there is one `world:endEvent` entry.
  - "P4-03 zone Save, Delete and Restore on one zone…": while Restore is held, Delete, Save and Restore open no dialog and send nothing. Axe passes on that state. While Save is held, Delete and Restore are refused. The totals are one reset, no delete and one save, matching the audit log.
  - "P4-03 a failed action clears its pending state…": Cancel hunt fails while held. Pending clears, focus stays on the button, and the error is still shown after 3 seconds. The retry succeeds, with one `hunt:cancel` entry.
  - "P4-03 independent actions keep their own pending state…": Dismiss report and Remove message are both held. Remove message finishes and the lists are fetched again. Dismiss report is still pending and a press sends nothing, and each action has exactly one request and one audit entry.

### Results (P4-03)
All on this laptop, fake backend.

- `npm test` 24 of 24 and `npm run test:ui` **81 of 81 in each of 3 consecutive full runs** (75 earlier tests plus 6 new).
- **New tests against the reviewed commit** (`UI_PUBLIC_DIR` set to the `bdb1f4d` checkout, with the updated fake backend): all 6 fail. Five fail on the behaviour itself:
  - Dismiss report: 3 requests instead of 1;
  - quick action: 3 updates instead of 1;
  - End event: a second dialog opened;
  - zone: Delete asked while Restore was sending;
  - independent actions: Dismiss report sent a second request after the refresh.

  The failure-and-retry test fails only on the missing pending state. The old code had no pending state to clear, and its failure path already let you retry. It is kept as a guard.
- **Pending states, every action** (`docs/ui-audit/phase-4/corrections-p4-03/`): each of the 10 buttons was pressed with its request held, then pressed again, at 390 and 1440 (20 scenes).
  - **After:** 0 axe violations of any impact, one request each, no second dialog, and the button shown as pending in all 20.
  - **On `bdb1f4d`:** 0 axe violations. But nothing showed as pending in any scene; the quick action and Dismiss report sent 2 requests; and the 8 confirmed actions opened a second confirmation. Raw data: `summary-p4-03-after.json`, `summary-p4-03-before.json`.
- **Admin accessibility sweep** (`tools/admin-shots.mjs`, 60 captures): **0 violations of any impact**, 0 page overflow, 0 targets under 24px. Raw data: `docs/ui-audit/phase-4/summary-after-p4-03.json`.
- The new tests also run axe on the pending quick action, the pending zone restore and the reports list after a dismissal.

### Not verified (P4-03)

- **Screen readers:** announcement of `aria-busy` on the pending buttons and of the "Still working" toast. Checked in the DOM and by axe only.
- **Real devices.**
- **The live backend:** the duplicate-audit behaviour was read from `supabase/functions/admin/index.ts` and modelled in the fake backend, not observed on the live project.

## Review corrections (PR #13 final re-review)

The final re-review accepted P4-03 at `f8b32c2` and asked for one more correction, limited to the zone editor.

**P4-04: edits silently discarded while a zone is saving.**
- *Cause:* the Save request carried the draft as it was when Save was pressed, but the draft stayed editable while the request was running. When the save succeeded, the editor closed (`st.zoneEdit = null`) and anything changed meanwhile was lost without a word. The P4-01 zone test itself did this: it added a path while the save was held. Delete and Restore had the same window.
  - Reading the code turned up a second way to lose edits. The editor that closed on success was whichever one was open, not the one the save came from. Going Back and starting to edit another zone while a save was sending lost those edits when the save finished.
- *Fix, in `admin-zones.js` only.* No server, API or design change; P4-03 single-flight is kept.
  - **Locked while sending:** while Save, Delete or Restore is pending for the zone, the whole draft is in a `<fieldset class="zone-lock" disabled>`. That covers every text and number field, select, checkbox, add and remove button for monsters, lairs and paths, and the overworld placement squares.
    - Disabled controls stay readable.
    - The form is `aria-busy`, and the fieldset is described by the save note, which says "Saving. Editing is paused until it finishes." ("Restoring the built-in version…" and "Deleting the zone…" for the other two).
    - The pending button keeps its P4-03 look and focus.
    - The input, overworld-pick and add/remove handlers also ignore changes while the zone is busy, so an event that reaches them anyway changes nothing.
  - **What is sent is a copy** of the draft taken when Save is pressed.
  - **On failure** the flag clears, the draft unlocks with every edit kept, and the error stays.
  - **On success** the existing workflow runs: Save and Delete return to the zone list, and Restore reopens the zone. Only the editor the change came from is closed or reopened.
    - Another zone opened in the meantime is left alone, with its edits.
    - The same zone opened again in the meantime was locked, so it is refreshed from what the server now holds.
  - `style.css`: `fieldset.zone-lock` has no border, margin or padding, like `fieldset.f-set`.
- *Tests* (`tests/ui/admin-console.test.mjs`):
  - "P4-04 editing is locked while Save is sending; the saved zone is exactly what was submitted":
    - The name is changed, then Save is pressed and held.
    - Every control in the draft is disabled, including at least one text field, select, checkbox, Add path and an overworld square. The form is `aria-busy` and the note explains why. Axe passes on this state.
    - Typing is refused. An `input` event, an Add path click and an overworld click sent straight to the controls change nothing.
    - After release there is one `saveZone`, carrying the name typed before Save and the original paths. The fake backend's stored zone equals the submitted definition exactly, and reopening the zone shows it.
  - "P4-04 a failed save unlocks the draft with every edit kept…": the save fails while held. Editing comes back, the name is kept, a path is added, and the second save carries both.
  - "P4-04 Restore and Delete also lock the draft while sending": both lock, each with its own note. Axe passes while deleting.
  - "P4-04 another zone opened while a save is sending keeps its edits…": a save is sent, Back is pressed and another zone is edited, then the save finishes. The other editor and its edit are still there.
  - **Changed test:** "P4-01 zone save: pending survives re-renders…" used to add a path while saving to cause a re-render, which is no longer possible. It now runs on a phone and redraws the console through the navigation group. The test confirms the editor's elements were actually replaced, then checks Save is still pending and repeated presses send one request.

### Results (P4-04)
All on this laptop, fake backend.

- `npm test` 24 of 24 and `npm run test:ui` **85 of 85 in each of 3 consecutive full runs** (81 earlier tests plus 4 new; the P4-01 zone test changed as described above). The runs were repeated after the last change, the muted colour for disabled textareas and selects.
- **New tests against the reviewed commit** (`UI_PUBLIC_DIR` set to the `f8b32c2` checkout): all 4 fail, each on the defect:
  - draft controls still usable while saving;
  - the failure test: controls still usable while saving;
  - controls still usable while restoring;
  - another zone's editor closed, with its edit, when the earlier save finished.

  The rewritten P4-01 zone test passes there too, as it should: P4-01 was already fixed.
- **Locked states** (`docs/ui-audit/phase-4/corrections-p4-04/`): Marsh renamed, then Save, Restore or Delete pressed and held, at 390 and 1440 (6 scenes).
  - **After:** 0 axe violations of any impact. **0 of 124 draft controls usable** in every scene, with the note explaining why, and the form and the pressed button `aria-busy`.
  - **On `f8b32c2`:** 123 of 124 usable (all but the permanent Id field), and the note still said "Ready to save."
  - Raw data: `summary-p4-04-after.json`, `summary-p4-04-before.json`.
- **Admin accessibility sweep** (`tools/admin-shots.mjs`, 60 captures): **0 violations of any impact**. Raw data: `docs/ui-audit/phase-4/summary-after-p4-04.json`.
- `style.css` also gives disabled textareas and selects the muted text colour disabled inputs already had, so the whole locked draft looks disabled.

### Not verified (P4-04)

- **Screen readers:** how a disabled fieldset, the busy form and the save note are announced. Checked in the DOM and by axe only. The note is in a polite live region, but the editor is redrawn when the lock starts, and whether the new note is announced was not tested.
- **Real devices.**
- **The live backend.**

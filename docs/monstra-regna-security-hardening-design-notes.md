# Monstra Regna — Security Hardening, Authentication, Action Frequency & Engagement Verification

**Project:** Monstra Regna (formerly Clickmonster)  
**Organization:** Aeturnis Development Labs LLC (ADL)  
**Document type:** Design and policy investigation record  
**Recorded:** 2026-11-18  
**Status:** Discussion record — **not an approved implementation scope or adopted player policy**  
**Repository:** <https://github.com/Aeturnia/clickmonster>

> **Decision discipline:** This document separates **established project direction**, **recommended standards and controls**, **research candidates**, and **open decisions**. Ideas recorded here must not be interpreted as permission to implement, deploy, alter production authentication settings, or enforce sanctions. Any future implementation requires its own scoped change, test plan, review, and authorization.

## 1. Purpose and context

Monstra Regna is a branded ADL product, although intended to be a free, browser-based, text-oriented idle/click RPG. The owner wants a professional security and operational standard proportionate to a persistent online game with real player accounts, long-lived progression, and a future player Kingdom economy and PvP/sieges.

Current broad architecture:

- A lightweight HTML/CSS/JavaScript single-page client, hosted through Netlify.
- Supabase authentication, PostgreSQL persistence, and server-side functions for authoritative gameplay.
- Development and release discipline using scope documents, independent review gates, CI engine/database/browser checks, and explicit function-deployment authorization.
- Planned nested grid-based world zones; future Kingdoms are player-owned tiles on an initial 100 × 100 special zone (one tile/Kingdom per player). Kingdoms have a management interface for buildings and upgrades, resources from combat, mines/farms/woodcutters and similar production, and eventual attacks/sieges.
- The game is intended to persist without periodic round resets. Long-horizon progression and economic simulations are planned once Kingdom mechanics are sufficiently specified.

**Principle:** A free game still owes its players reasonable account protection, state integrity, clarity about allowed behavior, and reliable recovery from failures. Security scope must be risk-based rather than complexity for its own sake.

## 2. Proposed governance documents

The following identifiers are **proposed**, not established policies:

| Proposed ID | Document | Purpose |
|---|---|---|
| MR-SEC-001 | Application Security Standard | Trust boundaries, authorization, data integrity, vulnerabilities, secrets, logging, and incident response |
| MR-AUTH-001 | Authentication & Session Policy | Account recovery, local/global sign-out semantics, multi-device behavior, administrative access |
| MR-FAIR-001 | Action Frequency & Automation Policy | Action cadence, legitimate idle mechanics, external automation, enforcement fairness |
| MR-OPS-001 | Security Verification & Operations | Tests, monitoring, release gates, backup/restore verification, review cadence |

Distinguish **private engineering standards** (what must be enforced and how verified) from **player-facing rules** (what conduct is permitted and what enforcement is possible). Neither is ratified by this record.

Possible baseline: OWASP ASVS 5.0.0, targeting Level 1 broadly and selecting Level 2 controls for authentication, administration, and sensitive state transitions. Evaluate WCAG 2.2 Level AA as a practical accessibility target. These are **proposed benchmarks**, not assertions of current compliance.

## 3. Security invariants and trust boundaries

**Recommended non-negotiable requirements for future ratification:**

1. **Authoritative server:** The browser never grants itself XP, gold, items, combat wins, construction materials, buildings, Kingdom ownership, or siege outcomes.
2. **Authenticate and authorize independently:** Every protected server operation must verify who is acting and whether that identity may act on the specific character, resource, or Kingdom.
3. **Account isolation:** One account's private state must not leak into another account on sign-out, recovery, switching, stale subscriptions, or multiple tabs.
4. **Atomic consequential changes:** Reward grants, resource spending, inventory transfers, construction, recruitment, and warfare should preserve transaction invariants under concurrency.
5. **Replay and duplication safety:** Retries, duplicate requests, reordered responses, and network loss must not double-grant rewards or double-spend resources. Use idempotency where the operation requires it.
6. **Validate every input:** Enforce bounds, types, permissions, legal transitions, payload sizes, and resource limits server-side.
7. **Secret handling:** Supabase service-role credentials, administrative tokens, and other privileged secrets must never be bundled into the browser, committed, or exposed in logs.
8. **Least privilege:** Client-accessible database interfaces and Row Level Security policies must be independently tested; elevated server functions must narrowly constrain their authority.
9. **Failure recovery:** Transient failures must not corrupt state or block users from a safe recovery path.
10. **Privacy-conscious instrumentation:** Record operational evidence necessary for diagnosis and abuse prevention without collecting unnecessary personal data or behavioral biometrics.

Examples of integrity cases to test: combat reward request retried after a response is lost; two construction requests racing for the same resources; concurrent collection and spending; overlapping siege commands; a browser resuming with another account's cached UI state.

## 4. Authentication and session protection

### 4.1 Discovered P1 defect and separate workstream

A live cross-device experiment revealed that signing out from a phone revoked desktop authentication because the current sign-out used Supabase's default global scope. The desktop retained a locally plausible but server-rejected session; an entrance gate could reuse the rejected session while hiding the sign-in form. Sign-out from that gate was not reliably recovering the local client.

This was classified as a **P1 user-facing account availability/recovery defect**; based on available evidence it was **not** established as data loss, compromise, or a security incident.

The dedicated source of truth for the remediation is **PR #53**, `docs/sign-out-scope.md`, rather than this general security record. The approved scope investigation specified:

- Ordinary sign-out is **device-local**, not account-global; a future deliberate “sign out everywhere” action is separate and clearly labeled.
- Definitively revoked/invalid sessions must clear locally and return to the sign-in form.
- Temporary authentication service outages must preserve recoverable sessions and provide Retry.
- Explicit sign-out must be able to clear local credentials even when the server rejects, hangs, or cannot complete its logout request.
- Cross-tab behavior and account switching must remain consistent.
- Client-side fallback must not delete a newer session after a late response; measure actual GoTrue responses before finalizing server-side error classification.
- No access/refresh tokens or complete authentication storage values in diagnostics.
- Preserve the entrance startup-size budget and coordinate any Supabase `game` function redeploy with separate authorization.

**Status caveat:** This document does not claim the remediation is implemented or live; verify the current PR and deployment record separately.

### 4.2 Additional authentication recommendations

- Assess Supabase Auth configuration and actual provider-side limits; do not assume defaults equal production policy.
- Consider Cloudflare Turnstile for registration and selected abusive authentication flows, while evaluating mobile, keyboard and screen-reader usability.
- Evaluate stronger authentication for administrators, including MFA, and ensure privileged authorization is checked server-side for every administrative action.
- Document account recovery behavior and deliberate revocation of other sessions.
- Avoid account-lockout rules that make credential-stuffing attacks into denial-of-service tools.
- Establish safe, non-enumerating login and recovery error messages where appropriate.
- Define a privacy-respecting authentication event log and retention policy.
- Track the `admin` function's separate error-classification issue: distinguishing definitive authentication rejection from temporary provider unavailability; its remediation requires its own scope and redeploy approval.

## 5. Layered action-frequency and anti-abuse controls

**Do not conflate three distinct mechanisms:**

| Mechanism | Question it answers | Typical enforcement |
|---|---|---|
| Gameplay cadence/cooldowns | Is this action legal now under game rules? | Authoritative server rejection, no reward |
| API/infrastructure rate limiting | Is this requester consuming excessive service resources? | Account/session/IP-aware budgets, throttling, retry guidance |
| Abuse/anomaly review | Is there a pattern worth investigation? | Privacy-conscious signals, review, proportional response |

No numerical action-per-second, hourly or daily quotas are approved yet. Derive thresholds from actual combat/action mechanics, real measurements, load testing, and later Kingdom progression simulations. Rate limits should be endpoint-specific and should not be mistaken for gameplay balance rules.

**Proposed enforcement principles:**

- Enforce legal action cadence, prerequisites, position, resources and rewards on the server, never from JavaScript timers alone.
- Support normal network retries and modest request bursts while preventing replay or duplicate gains.
- Preserve state consistency when simultaneous requests arrive from multiple tabs/devices.
- Reject impossible actions deterministically; do not infer malicious intent solely from an action being fast or regular.
- Apply infrastructure controls proportionately; distinguish an abusive client from an ordinary player on an unstable connection.
- Consider layered limits at authentication, game function, per-account and database levels. Cloudflare controls only the traffic actually passing through its protected route.

## 6. Automation policy — explicitly undecided

The owner has firsthand experience with Shimlar-style games: players with disabilities do use them, while unattended macros can generate extreme progression disparities. The owner is approximately evenly divided between **strict manual play** and **limited automation**. **No policy choice is ratified.**

### Candidate policies

| Candidate | General premise | Principal tradeoff |
|---|---|---|
| Strict | Human-initiated actions plus explicit in-game idle systems; accommodation for adaptive input | Clear fairness rule, but enforcement and accessibility distinctions require care |
| Limited | Some repeat input/macros permitted within published server limits | Less restrictive, but may reward 24-hour unattended play |
| Capability-based hybrid | Explicitly permit input remapping/assistive controls and defined first-party repeat actions, without permitting unlimited unattended progression | Potential compromise, but requires a well-defined allowed-capabilities boundary |

An entirely automation-neutral policy was discussed but is not a current preferred option.

**Questions to settle with simulations and player experience:**

- Is repeated clicking itself intended gameplay, or is the intended challenge character-building, choice of zones, and combat readiness?
- Should a player be allowed to execute repeated actions without active presence? If yes, for how long and by what mechanisms?
- Does a fixed cooldown merely shift advantage from faster macros to 24-hour macros?
- Would daily productive budgets or diminishing returns hurt dedicated legitimate players?
- What is the fairness impact over 30, 90, 365 days and multiple years, particularly with Kingdom economy bonuses?
- How should game-provided idle production differ from externally automated active combat?

**Provisional fairness principles for consideration:** support ordinary remapping/assistive input; never require disability disclosure for accessible controls; publish clear rules before enforcing them; treat timing anomalies as signals, not proof; provide proportionate restrictions and a correction/appeal path for consequential sanctions. Do not automatically ban an account based solely on extremely regular input timing.

## 7. Engagement verification (EV) — research candidate, not policy

### 7.1 Purpose

The owner proposed occasional **engagement or presence checks** inspired by Shimlar's periodic arithmetic popups. The question should be framed as *“Is a player presently responsive while taking active reward-generating actions?”*, **not** “Can we prove a human is using this account?” or “Can we diagnose a macro?”

Prior candidate interfaces:

1. Simple arithmetic prompt (e.g., `25 + 86 = ?`).
2. Trivial verbal prompt (e.g., “What color is blue?”).
3. Touch/mouse freehand input: draw anything more than a dot—a line, X, circle or squiggle—in a writing area.
4. Accessible, non-gesture alternative using ordinary form controls/keyboard/switch input.

The owner favors **simple, practical, inexpensive design**, not an elaborate CAPTCHA, behavior classifier, or “revolutionary” verification technology. Universal accessibility to every conceivable user is not considered an achievable objective; reasonable accessibility and applicable standards should still be respected without allowing this small feature to dominate development.

### 7.2 Evidence and limitations

- Historical MMORPG anti-macro interruptions (e.g., RuneScape Classic fatigue and later random events, and the owner's experience with Shimlar) provide prior art for periodic engagement prompts. They also illustrate the risk of disrupting legitimate players without reliably defeating sophisticated bots.
- Gesture-oriented mobile CAPTCHA research exists, but published usability findings for structured gesture tasks **do not validate** an arbitrary scribble as a strong human test.
- Simple arithmetic, “what color is blue?”, and synthetic pointer strokes are all easy for more capable scripts to answer; an occasional prompt is most plausibly a deterrent to **basic unattended repetition**.
- A correct response proves only that the correct response arrived, not that a particular person was continuously present.
- Avoid mouse-trajectory biometrics, cursor fingerprinting, invasive browser inspection, and collection of drawing pressure or timing as a quasi-identity signal.

### 7.3 Accessibility considerations

The following WCAG 2.2 topics are directly relevant to evaluation:

- **2.1.1 Keyboard (A):** the verification function should have a keyboard-operable method.
- **2.2.1 Timing Adjustable (A):** a generous timer alone may not satisfy requirements; investigate extension or a non-punitive, indefinite pause.
- **2.5.1 Pointer Gestures (A):** required path-based gestures need an appropriate non-path-based method unless an applicable exception applies.
- **2.5.7 Dragging Movements (AA):** a drawing motion ordinarily needs an alternative not requiring dragging, subject to the criterion's exceptions.
- **2.5.8 Target Size (Minimum) (AA):** controls should meet the applicable size/spacing criteria or an exception.
- **3.3.8 Accessible Authentication (AA):** specifically concerns authentication; a gameplay engagement challenge is **not automatically authentication**, but its cognitive-accessibility lessons remain useful.

A scribble option should therefore **not** be the sole way to continue active gameplay. Alternatives should grant equivalent in-game privileges and not require a player to disclose a disability. A permanently available, non-gesture alternative is preferable to treating it as a special exception.

### 7.4 Possible operational model — unapproved

- Issue a server-side, short-lived, single-use engagement challenge tied to an authenticated player/session or active-action eligibility state.
- Show a clearly labeled, brief interaction without accusing the player of cheating.
- If not answered, pause **qualifying active reward-generating actions**, not saved character progress or authorized offline Kingdom production.
- Preserve the ability to return later, obtain a fresh challenge if required, verify, and resume.
- Do not punish for an incorrect response or nonresponse; avoid automatic permanent sanctions based on EV outcomes.
- Reject attempts to bypass a pending EV state through a modified client; handle concurrency and replay at the server.

**Caution:** Even this model may introduce substantial complexity around multi-device sessions and concurrent actions. It must not be approved without a concise threat model and testable benefit. In particular, the owner has not decided whether EV should apply universally to active combat or only to sustained anomalously high activity, nor whether EV should exist at all.

### 7.5 Bounded experiments before adoption

Propose a small **isolated prototype**, not live enforcement, to measure:

- Completion time/error rate on touch, mouse, keyboard and accessible alternative inputs.
- Practical effect on basic unattended macros and scripted clients; avoid overclaiming security.
- Interruptions during long sessions, phone backgrounding, multi-tab/device use, and unstable network conditions.
- Whether an unanswered prompt safely pauses only the intended action class.
- Maintenance and test cost relative to any observed benefit.

The owner's stated constraint: this must remain a **small feature** or be dropped if the cost/benefit is poor.

## 8. Fair enforcement and player-facing transparency

**Recommended approach, not adopted player terms:**

- Publicly distinguish allowed in-game idle production, normal/adaptive inputs, and disallowed exploitative behavior once policy is decided.
- Invalid or premature actions receive no benefit; request throttling should be proportional to resource consumption.
- Strong, deterministic evidence (for example, impossible state transitions or deliberate exploit requests) is distinct from statistical anomalies.
- Do not ban solely because input timing is unusually consistent or an engagement check was missed.
- For consequential sanctions, preserve a review/correction channel and enough evidence to reconstruct decisions without excessive personal surveillance.
- Clearly communicate any future active-play checks and their effect on progression before launch.

## 9. Infrastructure and Cloudflare considerations

Cloudflare may be a useful **optional layer**, not a prerequisite to professional security:

- **Turnstile:** evaluate on sign-up or sensitive authentication paths, with explicit mobile and accessibility testing; review Supabase-supported integration before enabling production settings.
- **WAF/bot controls:** useful for traffic routed through Cloudflare, not automatically for direct browser-to-Supabase API calls.
- **Rate limiting:** useful at the network edge, but not a substitute for per-account gameplay validation and server-side limits.
- **Workers/API gateway:** revisit only if measurements justify the additional hop and operational complexity; avoid splitting authoritative gameplay across platforms casually.
- **R2/object storage:** optional for future large static assets; not presently an identified need for the lightweight game.
- **Netlify compatibility:** do not casually enable a second caching/proxy layer in front of Netlify without reviewing support, caching, origin and deployment behavior.

**Current recommendation:** keep Netlify and Supabase in place; first inventory current protections and validate a pre-launch threat model. Evaluate Turnstile separately. No Cloudflare product has been selected or authorized for deployment.

## 10. Operational security and release verification

Future operations standard should cover:

| Domain | Proposed verification |
|---|---|
| Secrets | Environment separation, least privilege, no secrets in browser bundles or commits, rotation playbook |
| Database | Backup policy, restoration drills, migration rollback expectations, integrity tests |
| Logging | Authentication/action failure telemetry without tokens or excessive identifying data; retention and access controls |
| Monitoring | Game-function error rates, database load, authentication problems, anomalous action traffic, cost alarms |
| Incident response | Severity definitions, containment, communication, recovery, retrospective, and escalation owner |
| Vulnerability reports | Private report route and documented triage/remediation process |
| Deployment | CI evidence, independent review, release gates, function-deploy authorization, rollback procedures |
| Privacy | Minimize logs, explain relevant monitoring to players, avoid covert behavioral fingerprinting |
| Ongoing review | Periodic re-evaluation of controls and limits after gameplay or traffic changes |

**Special Kingdom/PvP threat model (future):** resource duplication, production-clock manipulation, siege race conditions, transaction retries, cross-Kingdom authorization, offline-defense logic, action queuing, account collusion and runaway economic advantage. Design these defenses when Kingdom mechanics become concrete rather than inventing arbitrary thresholds now.

## 11. Suggested phased workflow (not yet authorized)

1. **Inventory and threat model:** read the actual code/configuration; identify trust boundaries and existing protections.
2. **Policy drafts:** prepare the four documents in §2, with player-facing versus internal rules clearly separated.
3. **Gap matrix:** map each requirement to proof in code/config/tests; classify verified, partial, missing, not applicable or not yet designed.
4. **Risk-based remediation plan:** prioritize auth recovery, privilege controls, gameplay integrity, and request abuse before optional EV.
5. **Verification:** regression tests, load/concurrency cases, accessibility checks, rollback/restoration exercises.
6. **Release decision:** expressly decide public-launch blockers versus future Kingdom/PvP controls and record exceptions.

No live system changes should occur as a consequence of this record.

## 12. Decisions, recommendations and open questions

### Established direction from the conversation

- Treat Monstra Regna as a professionally operated ADL-branded product even though free.
- Establish formal security/authentication/action-frequency/automation standards.
- Keep gameplay results and consequential state transitions server-authoritative.
- Separate action frequency, external automation rules, and lightweight engagement checks conceptually.
- Recognize accessibility and fairness as relevant; reject a goal of perfect universal accommodation or disproportionate feature complexity.
- Keep the automation choice **open**, pending further exploration and simulation.
- Keep EV **exploratory**, with small/simple UX as an explicit constraint.

### Recommended, **not yet ratified**

- OWASP ASVS-based verification and WCAG 2.2 AA accessibility target.
- Layered endpoint/account rate limits and atomic/idempotent economy transitions.
- Turnstile assessment for sensitive authentication operations.
- Non-punitive EV fallback if EV is eventually adopted.
- Privacy-limited monitoring, documented enforcement, recovery testing and incident procedures.

### Outstanding owner decisions

1. Strict manual play, limited macro use, or a capability-based hybrid?
2. Is repeated Fight input a meaningful gameplay challenge or an input burden that should be reduced by first-party functionality?
3. Should EV exist at all? If so, universal for active progress or triggered only under defined conditions?
4. EV method: text, arithmetic, scribble with alternative, or something simpler?
5. EV cadence/trigger and its relationship to actual productive action rates?
6. Which game systems pause after nonresponse, and which legitimately idle offline?
7. What measurable anti-abuse benefit justifies EV's UX, accessibility, and maintenance costs?
8. Numerical action limits and progression-policy effects after Kingdom simulations?
9. Which security controls are public-launch blockers, and which belong to later Kingdom/PvP milestones?
10. Which hosted security settings, backups, logging and monitoring are actually enabled on the selected Supabase/Netlify plans?

## 13. References and prior art for later verification

Primary sources and useful context (reference links, not proof of Monstra Regna compliance):

- OWASP ASVS: <https://owasp.org/www-project-application-security-verification-standard/>
- OWASP Bot Management and Anti-Automation Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Bot_Management_and_Anti-Automation_Cheat_Sheet.html>
- OWASP API Security Top 10: <https://owasp.org/API-Security/>
- W3C WCAG 2.2: <https://www.w3.org/TR/WCAG22/>
- W3C Inaccessibility of CAPTCHA: <https://www.w3.org/TR/turingtest/>
- W3C Pointer Gestures: <https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures.html>
- W3C Dragging Movements: <https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html>
- W3C Timing Adjustable: <https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html>
- W3C Accessible Authentication (Minimum): <https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html>
- Old School RuneScape random-event history (secondary/community reference): <https://oldschool.runescape.wiki/w/Random_events>
- Jiang & Dogan, *A Gesture-based CAPTCHA Design Supporting Mobile Devices* (2015), research reference: <https://staffprofiles.bournemouth.ac.uk/display/conference/191651>
- Supabase Auth CAPTCHA integration: <https://supabase.com/docs/guides/auth/auth-captcha>
- Supabase Auth rate limits: <https://supabase.com/docs/guides/auth/rate-limits>

**Research caveat:** Service capabilities, plan limits, library versions, and standards guidance should be verified when producing an approved implementation scope. This document records design reasoning, not a current production audit.

---

**Disposition:** Research/design record only. Explicit owner authorization and independent scope review are required before any code, policy enforcement, infrastructure setting, or deployment changes.

# Monstra Regna — GitHub Project, Milestones, and Issues Setup Brief

**Owner:** Aeturnis Development Labs LLC (ADL)  
**Repository:** https://github.com/Aeturnia/clickmonster  
**Status:** Execution brief for Claude; proposed tracking structure, **not an approved feature scope**  
**Purpose:** Establish a sustainable, auditable GitHub planning system for Monstra Regna while preserving existing repository history, scopes, and review gates.

## 1. Mission

Use GitHub CLI (`gh`) and the GitHub APIs available in the current environment to inventory and, where authorized and feasible, set up:

1. One primary **GitHub Project** for Monstra Regna, with usable views and fields.
2. **Repository milestones** for approved or reasonably established workstreams, without suggesting that speculative design has been authorized for implementation.
3. **Issues** representing actionable known work, design investigations, and outstanding decisions, linked back to the authoritative repository documents.
4. A **capability and limitations report** explaining precisely what GitHub operations Claude can perform in this environment, including authentication and permissions blockers.

**Do not implement gameplay, modify production settings, merge PRs, deploy functions, or treat project-board creation as authorization to start a feature.**

## 2. First: establish access and baseline

Run read-only diagnostics first. Record the outcomes, omitting tokens and sensitive values:

```bash
gh --version
gh auth status
gh repo view Aeturnia/clickmonster --json nameWithOwner,defaultBranchRef,url
# Inspect existing issues, milestones, open PRs, labels, and Projects.
gh issue list --repo Aeturnia/clickmonster --state all --limit 100
gh pr list --repo Aeturnia/clickmonster --state open --limit 100
gh api repos/Aeturnia/clickmonster/milestones --paginate
gh label list --repo Aeturnia/clickmonster --limit 100
gh project list --owner Aeturnia
```

GitHub Projects belong to a **user or organization**, not strictly to a repository. Resolve the actual Project owner before creating anything; do not assume `Aeturnia` is an organization. Check `gh project --help` and the CLI's supported field/view commands. Check whether the authenticated identity has the appropriate repository access and the `project` scope or equivalent fine-grained permissions. If necessary, describe the required permission or owner action rather than silently broadening access. **Do not print or record credentials.**

Inspect these repository documents when present: `CLAUDE.md`, `docs/backlog.md`, the current authentication scope/report, gameplay-polish scopes/reports, and other milestone/ADR documents. Use their current versions, not the snapshots in this brief, as the source of truth.

Produce an inventory before making changes: existing Projects, milestone titles/numbers, issue numbers/titles/statuses, labels, open PRs, documentation-linked work, and likely duplicates. The inventory must identify what should be **reused**, **linked**, **created**, or **left unchanged**.

## 3. Project model (proposal)

**Proposed name:** `Monstra Regna — Development & Release`  
**Description:** Product planning, approved development, technical risks, security, investigations, release readiness, and owner review gates for Monstra Regna.

Prefer one Project rather than multiple redundant boards. Link it to the repository where supported. Proposed views, subject to available GitHub functionality:

| View | Purpose |
| --- | --- |
| **Board** | Status-driven daily work |
| **Roadmap** | Targeted milestones and dependencies, without fabricated deadlines |
| **Backlog** | Unscheduled and not-yet-authorized work |
| **Review gates** | Items awaiting owner or independent review |
| **Security & release** | P1 defects, security findings, launch-readiness work |

Proposed workflow states: `Backlog`, `Research / Design`, `Scoped`, `Authorized`, `In progress`, `Review`, `Blocked`, `Done`. Preserve any existing established status scheme if one exists. A status field is a **tracking signal**, not authorization: only explicit owner instructions and accepted scopes authorize implementation or deployment.

Additional fields, only if supported and useful: `Priority` (`P0`–`P3`), `Work type` (`Bug`, `Feature`, `Research`, `Security`, `Infrastructure`, `Documentation`), `Area` (`Auth`, `Gameplay`, `World`, `Kingdoms`, `Economy`, `UI`, `Operations`), and `Target` (milestone/iteration). Avoid an overcomplicated taxonomy. Prefer native Project fields to parallel label systems, except for useful repository filters.

## 4. Repository milestones (candidates, not automatic commitments)

Check existing milestones first. Proposed milestones may be renamed or consolidated based on the actual backlog. **Only create milestones that have an identifiable purpose and can be tracked without inventing dates.** If the GitHub milestone API requires descriptions, use short contracts; leave due dates unset unless the owner supplied them.

| Candidate | Scope boundary |
| --- | --- |
| **Authentication & Session Recovery** | The observed cross-device sign-out lockout and its approved fix/review/deployment steps |
| **Security Hardening — Baseline** | Security inventory, threat model, policy decisions, and prelaunch safeguards—not unapproved implementation |
| **Kingdoms — Design & Foundation** | Kingdom ownership, one tile per player in the initial 100×100 Kingdom Zone, UI-based Kingdom management, resources and buildings; implementation design still requires approval |
| **Progression & Economy Simulation** | Post-Kingdoms quantitative balance and long-horizon progression experiments |
| **World & Zone Expansion Research** | Nested variable-size grid zones and deterministic procedural-zone feasibility study |
| **Public Launch Readiness** | Verification, production operations, support, documentation, and go/no-go gates |

Use existing gameplay-polish milestones or completion records where they exist. Do not reopen GP-1 simply because tracking is being formalized. Do not imply that Kingdom warfare, procedural generation, or engagement checks have been approved for implementation.

## 5. Issues: create selectively, with explicit status

**Do not bulk-create issues blindly.** Reconcile existing issues and `docs/backlog.md`. Prefer linking existing issue/PR records over duplicates. Where important work is tracked only in a Markdown document, an issue can reference it; the Markdown contract remains authoritative until the owner changes that policy.

Initial candidate work items to reconcile:

| Work item | Recommended issue type/status | Notes |
| --- | --- | --- |
| Cross-device sign-out / desktop lockout | `Bug` / based on live PR state | Link approved scope PR #53 and measurement/implementation PR #55 as applicable; verify current PR state first |
| Admin function misclassifies auth outage as 401 | `Bug` / `Backlog` | Previously deferred; do not expand the current auth fix without approval |
| Windows runner `ERR_NO_BUFFER_SPACE` recurrence | `Infrastructure` / `Backlog` | Preserve diagnostic run IDs and avoid treating successful reruns as a fix |
| Phone landscape navigation overflow | `Bug` / `Backlog` | Previously recorded as a follow-up |
| Security hardening inventory and threat model | `Security` / `Research / Design` | Establish controls against verified current architecture |
| Authentication and session policy | `Security` / `Research / Design` | Incorporate session recovery invariant and administrative controls |
| Action frequency / automation policy investigation | `Research` / `Research / Design` | **Unresolved:** strict vs limited; input aids, fairness, progression throughput |
| Engagement verification feasibility | `Research` / `Backlog` | **Unresolved:** whether to implement; scribble, simple questions, accessible alternatives, proportional cost |
| Kingdoms system design | `Feature` / `Research / Design` | Initial 100×100 zone; each player may claim one tile; one tile is the entire Kingdom with a management UI |
| Kingdom resources and buildings | `Feature` / `Research / Design` | Monster-gathered materials, mines, farms, woodcutters, upgrades; balance undecided |
| Kingdom warfare and sieges | `Research` / `Backlog` | Long-term concept, **not authorized** |
| Progression simulations | `Research` / `Backlog` | Wait for Kingdoms economics; explore persistent progression without fixed assumptions about level cap |
| Nested zones / procedural expansion | `Research` / `Backlog` | Zones are variable-size grid maps; tile links can lead to other zones; procedural expansion undecided |
| Public release verification plan | `Operations` / according to existing plan | Respect existing staged release gates and external approvals |

Avoid issue proliferation: combine related exploratory questions into one investigation issue with subsections rather than inventing a dozen implementation tickets. Keep closed/completed work closed.

### Issue template

Each new issue should contain:

- **Problem / objective** — observable need, not a predetermined solution.
- **Current evidence** — links to source docs, PRs, bug observations, test runs.
- **Scope / non-goals** — clear boundaries.
- **Acceptance criteria or research deliverables** — verifiable results.
- **Dependencies / review gate** — what cannot start before another decision.
- **Authorization state** — `Not authorized`, `Scope approved`, `Implementation authorized`, etc., only if directly supported by owner decisions.
- **References** — stable GitHub links; avoid copying large documents into issues.

Do not put secrets, user tokens, private account details, or production credentials in issue text.

## 6. Execution rules and approval gates

1. **Inventory first.** Do not create duplicate Projects, milestones, labels, or issues.
2. **Record permission limits.** If Projects cannot be accessed or configured, continue with read-only inventory and a proposed configuration; do not pretend completion.
3. **Preserve history.** Do not close, reopen, relabel, or reschedule existing issues without showing why. No bulk destructive edits.
4. **Small reversible changes.** Create or link items individually, log resulting URLs/IDs, and verify their placement.
5. **No fabricated deadlines or estimates.** GitHub milestone due dates and Project iteration dates remain blank unless authorized.
6. **Respect the existing review system.** A Project status, milestone, or issue assignment is not permission to edit code, merge, or deploy.
7. **Pause for owner approval** before changing established project taxonomy, changing existing milestones, archiving/moving existing Project items, or creating a large batch. A proposed initial plan with specific item counts and names is preferred.
8. **If the owner has already explicitly authorized this tracking setup**, implement the agreed non-destructive structure where capabilities allow. If not, return the inventory and proposed create/update plan for approval.

## 7. Required capability and limitation report

Do not simply say “GitHub access works.” Provide a factual matrix of what was attempted or checked:

| Capability | Required evidence |
| --- | --- |
| Repository Issues | Can list/read/create/update? Which operations were actually tested? |
| Milestones | Can list/create/edit/close? REST API or `gh api` command used? |
| Projects (v2) | Can list/read/create/edit fields and views, add items, change statuses, link repository? |
| Permissions | Which scopes/roles are missing, if any? Safe owner remediation steps |
| Linking | Can associate issues with milestones and Project items? |
| Automation | Are `gh` extensions or workflows required? None should be installed without authorization |
| Limitations | CLI capability, GitHub API restrictions, authentication, organizational policy, rate limits, and any inaccessible features |

Distinguish **not attempted**, **unsupported**, **permission denied**, and **verified working**. Don't infer create/update permissions solely from a successful read. If a Project board view cannot be created through `gh`, note whether GitHub's web UI or GraphQL API would be necessary.

Do not expose output from `gh auth token`, secrets, API keys, or personal session details. Never change the GitHub auth scope or install extensions without explicit authorization.

## 8. Deliverables and stopping condition

Return:

1. **Inventory:** GitHub Project(s), repository milestones, issues, labels, PRs, and existing backlog references.
2. **Setup plan:** Reuse/create/modify decisions with exact names, proposed owner and rationale.
3. **Execution record:** Each completed operation, GitHub URL, object ID/number, and resulting state; state clearly if only a proposal was produced.
4. **Capability/limitations report:** Evidence-backed matrix from section 7, including manual steps required from the owner.
5. **Outstanding decisions and blockers:** Separate from completed actions.
6. **Documentation update proposal:** Where to link the Project, conventions, and workflow from `CLAUDE.md` or repository docs; do not edit these automatically unless authorized.

**Stop at the next explicit owner review gate.** Do not transition from planning infrastructure into game feature implementation.

# Pending rewards delivered exactly once: scope (#102)

**Status: a draft for independent review.**
- **Documentation only.** No code, migration or deploy is authorized.
- **The review of `8ce806c`** (2026-11-23) accepted the design. All six questions in section 11 are now answered:
  - the review settled questions 1, 4 and 5;
  - the owner decided questions 2, 3 and 6.

  The quest-completion defect the review noticed is tracked separately, as [#105](https://github.com/Aeturnia/clickmonster/issues/105).
- **Authorized:** the owner authorized writing this scope on 2026-11-23, after reviewing the proposal for [#102](https://github.com/Aeturnia/clickmonster/issues/102).
  - **The atomic delivery design** was accepted as the design to investigate.
  - **The owner decided** that the full-pack case belongs in #102 (section 3).
- **Production wasn't read.** Everything here is from the repository at `main` `707eabc`, and line references are from that commit. The deployed `game` function wasn't examined (section 10).

## 1. The invariant

**A pending reward is marked claimed if and only if its whole effect is saved to the hero, in the same transaction.** Its effect is its gold, XP, gems and items.

**Two sources of truth:**
- **`pending_rewards`** holds what a hero is owed and hasn't yet received;
- **the hero's saved state** (`characters.data`) holds what was delivered.

**A reward can be owed without being deliverable at that moment,** for example when the pack is full (section 3). No separate mailbox or store is needed: an undelivered reward simply stays an unclaimed row.

## 2. The defect (evidence)

All of this is in `supabase/functions/game/index.ts`.

**What `claimRewards()` does** (line 108):
1. It selects up to 20 of the hero's open rewards (line 109).
2. It **marks them claimed in the database at once** (line 112: `update … set claimed_at` where `claimed_at is null`).
3. **Only then, and in memory only,** it adds them to the hero:
   - the gold goes to the bank;
   - the XP goes through `gainXp()`;
   - the gems are added;
   - **items are added only if the pack has room** (`MAX_INVENTORY`, 40). Otherwise the item is skipped, and the reward stays marked claimed.
4. It adds a notice for each reward.
5. It writes each reward's gold to the ledger (`ledger(r.source, …)`), also before the hero is saved.

**Where it's called:**
- on every action, before the action runs (line 450);
- on `state` reads (line 413);
- after a world-boss hunt's killing blow (line 181), in `huntAction()`, after `finishHunt()` has inserted the hunt's rewards (lines 135 to 156).

**What can stop the save** (`saveRow()`, line 60, versioned) after the rewards are already marked claimed:
- the 150 ms "Slow down!" (429), on the next line (line 452);
- a rule violation (an engine error such as "Not enough gold.", answered 400);
- any other `GameError` or server error;
- a version conflict (409).

**On a `state` read,** the save happens only if notices or a hunt changed (line 414). Today a delivered reward always adds a notice, so it does save. But that ties delivery to the notice text.

**The full pack is a second loss path.** An item that doesn't fit is skipped, and its reward is still marked claimed, so the item is gone for good. Today that is the killing-blow relic (line 145).

**The ledger can overcount.** A reward's gold is recorded even when the save then fails.

## 3. The owner's decision: the full pack (2026-11-23)

**A pending reward is indivisible.** If its items don't all fit in the pack, **the whole reward stays pending**: gold, XP, gems and items. There's no partial grant, no lost item, and no double payout.

| Pack | Pending rewards | Result |
|---|---|---|
| 39 of 40 | gold and 1 relic | Everything is delivered |
| 40 of 40 | gold and 1 relic | The whole reward stays pending |
| 40 of 40 | gold and XP, no items | Delivered normally |
| 40 of 40 | gold and 1 relic, then a gold-only reward | The relic reward stays pending; the gold-only reward is delivered |

**Also decided:**
- **A blocked reward never holds back later eligible rewards.**
- **The player gets a clear notice** that a reward is waiting for pack space. It is not repeated on every refresh.
- **The 40-slot pack limit is unchanged.**
- **No item from a pending reward is ever silently discarded.**

## 4. Constraints

- **Exactly once:** each reward is delivered once, in one transaction with the hero's save, or not at all.
- **Inside the transaction:** the database checks the hero's ownership of each reward, that it is unclaimed, the exact set of ids, and the hero's version.
- **Reward amounts, sources and the hunt payout** (`finishHunt()`, `huntShares()`) are unchanged.
- **Unchanged rules:** the pack limit, the action floor, the sanctions, and every other game rule.
- **Requests that deliver no reward** keep the ordinary `saveRow()`.
- **No secrets or personal data** in logs or tests, as elsewhere.

## 5. Proposed design

### 5.1 Staging, not claiming

`claimRewards()` is replaced by **staging**, which never writes to the database.
- **It selects the hero's open rewards, ordered by `id`** (oldest first).
- **It isn't capped at 20 in a way that could let blocked rewards hide eligible ones.** It reads them all: a hero has few open rewards, at most one or two per hunt. Or it pages past the blocked ones. The implementation chooses, and tests a hero with more than 20.
- **Each reward, in order:**
  - **if its items fit in the pack's free slots** (40 minus the pack as it is in memory, which includes items staged earlier in the request), it is **applied in memory**: the gold to the bank, the XP, the gems, the items and a notice. Its id joins the request's staged set;
  - **otherwise it is blocked,** and nothing of it is applied. Later rewards are still considered.
- **A reward already in the staged set is skipped.** So staging twice in one request can't apply a reward twice.
- **The rule is a pure function in the shared engine** (accepted in review, question 5: `public/js/engine/rewards.js`). It takes the hero and the rewards and returns the staged ids, the blocked ids and the changes, so it is tested in Node. `tools/deploy-functions.mjs` already uploads `js/engine`.

### 5.2 The atomic commit: `save_hero_with_rewards()`

**A new Postgres function,** like `hunt_hit()` and `ledger_add()`:
- **its signature:** `save_hero_with_rewards(p_char uuid, p_version int, p_data jsonb, p_name text, p_level int, p_zone text, p_x int, p_y int, p_reward_ids bigint[])`. The public columns are the same as `publicColumns()` (line 55);
- **declared** `security definer`, with `set search_path = public`;
- **execute** revoked from `public`, `anon` and `authenticated`, and granted to `service_role` only.

**In one transaction:**
1. **Refuse a bad id set.** If `p_reward_ids` is empty or has duplicates, raise.
2. **Claim the rewards:** `update pending_rewards set claimed_at = now() where id = any(p_reward_ids) and character_id = p_char and claimed_at is null`.
   - If the number of rows updated isn't the number of ids, raise `rewards_conflict`.
   - That covers a reward already claimed, a reward of another hero, or an id that doesn't exist.
3. **Save the hero:** `update characters set data = p_data, the public columns, version = p_version + 1, updated_at = now() where id = p_char and version = p_version`.
   - If no row is updated, raise `version_conflict`.
4. **Return** the new version.

**Any raise rolls back both updates.** No reward is marked claimed without the hero's save, and no hero is saved with rewards that weren't claimed.

**The trust boundary:** the function guarantees that the claim and the save commit together. It doesn't inspect `p_data`. Applying the rewards correctly is the engine's job (5.1), and tests prove it (section 6).

### 5.3 Saving a request

`saveRow()` decides how to commit:
- **if the request has staged rewards,** it calls `save_hero_with_rewards()`;
- **otherwise,** the existing versioned update.

**Before committing, a second staging pass runs** (accepted in review, question 4). It runs only when the first pass blocked a reward, or when the request created rewards. It considers open rewards not yet staged, so it covers two cases:
- **space freed during the request,** for example by selling an item. The waiting reward is then delivered in the same request, not the next one;
- **rewards created during the request:** the killing blow (5.5).

**On success:**
- the row takes the new version;
- the staged set is cleared;
- the reward ledger entries are written (5.7).

**On `rewards_conflict` or `version_conflict`:**
- **The answer is 409,** "Your hero was busy — try again.", the same as today's conflict.
- **Nothing was written.** The rewards stay pending.
- **The request returns no hero state,** so the client never shows rewards that weren't committed.

#### 5.3.1 Every other way a hero is committed

**The rule (R-1):** any write that commits a hero's `data` **must claim that request's staged reward ids in its own transaction,** or the request must not stage. Otherwise a staged reward would be saved while its row stays unclaimed, and it would be delivered again on the next request. That is a duplication bug, the reverse of #102.

- **The staged set belongs to the acting hero's row object** (`row`), not to the request.
  - **A duel** (`attack`, line 468) saves the target (`saveRow(target, …)`) before the attacker. The target was never staged, so its save takes the ordinary update. The attacker's save carries the attacker's staged ids.
  - A test duels a hero who has pending rewards of their own, and checks those rewards are neither claimed nor delivered by the attacker's request.
- **The admin function's hero editor** (`supabase/functions/admin/index.ts:64`) never stages, so its versioned save is unchanged.
- **Hero creation and deletion** don't stage.
- **The Kingdoms baseline needs an amendment before K-1.**
  - **The conflict:** `docs/kingdoms-scope.md` (accepted, PR #101), 5.3.1 rule 2, says pending rewards ride in `kingdom_claim()`'s and `kingdom_release()`'s `p_data`. With this fix, those functions would commit staged rewards without claiming them.
  - **The fix:** they must also take the staged ids and claim them in their transaction, with the same checks as 5.2. Or the claim and release actions must not stage.
  - **Not done here:** this scope doesn't edit the Kingdoms baseline.
  - **Decided (question 6, the owner, 2026-11-23):** a separate, small documentation-only PR amends `docs/kingdoms-scope.md` 5.3.1, before K-1 is authorized. `kingdom_claim()` and `kingdom_release()` take the request's staged reward ids and claim them in their own transaction, with the checks in 5.2.

### 5.4 `state` reads

- **A `state` read stages rewards like an action.**
- **It saves when either of these is true,** whatever else changed:
  - it staged at least one reward;
  - the full-pack notice state changed (5.6).
- **Its condition** becomes "notices or a hunt changed, **or rewards were staged, or the waiting set changed**". Delivery no longer depends on notice text.
- **A read that fails to commit** returns no hero state as delivered (5.3).
  - **Decided in review (question 1):** **no automatic retry.** A read whose commit conflicts answers 409, as a conflicting save does today. A retry may be considered separately later.

### 5.5 The killing blow

**Today:** a hunt action stages (line 450) before `wealthBefore` is taken (line 490). Then `huntAction()` may land the killing blow, insert the hunt's rewards (`finishHunt()`), and call `claimRewards()` again (line 181). That call's gold is returned as `delivered` and subtracted from the action's ledger delta (line 494).

**Proposed:**
- **`huntAction()` no longer claims.** It records that the request created rewards.
- **The second staging pass, at commit (5.3), stages them,** skipping any id already staged in the request.
- **So nothing is staged or delivered twice.** Rewards open before the action were staged at the start. The hunt's new rewards are staged at commit. The staged set excludes repeats.
- **The gold accounting stays correct.**
  - The action's ledger delta (`wealth(char) - wealthBefore`) is computed before the commit pass, so it doesn't include the new rewards' gold. `delivered` becomes 0 on this path.
  - The new rewards' gold is recorded under their own source (`hunt`) after the commit (5.7), as `claimRewards()` recorded it before.
- **The killer's own share and killing-blow reward** are delivered in the same request, as today, if they fit.
  - A killing-blow relic that doesn't fit stays pending, with the notice (5.6). That changes today's behaviour, where it is lost.

### 5.6 The full-pack notice

- **The hero's state gains `rewardsWaiting`:** the ids of open rewards that are blocked, each with the number of free slots it needs.
- **A notice is added only when a reward first becomes blocked:** when its id isn't already in `rewardsWaiting`. For example: "A reward is waiting: your pack is full. Make room for 1 item to receive it."
  - Repeated `state` reads or actions with the same blocked rewards add no notice, and don't save for that reason.
- **When a waiting reward is delivered, or is no longer open,** its id is removed. The usual delivery notice appears.
- **Notices** use the existing list (`char.notices`, the last 10, dismissed by the player).
- **The waiting set is pruned** to ids that are still open, so it can't grow without limit.
- **Decided (question 3, the owner, 2026-11-23): a lasting reminder in the Gear tab** while any reward is waiting, as well as the one-time notice. For example: "40 / 40 slots. 1 reward waiting. Free 1 inventory slot to receive your pending reward."
  - **It is informational only:** no button, and no new inventory mechanics.
  - **It is drawn from `rewardsWaiting`,** and disappears once the reward is delivered.
  - **It follows the existing Gear tab patterns:** plain text, no icons, polite announcements, and axe with 0 violations.

### 5.7 Ledger entries

- **Reward ledger entries are written only after a successful commit,** one `ledger(source, gold)` for each delivered reward, under the existing best-effort contract.
  - A delivery can succeed without its ledger entry, if the ledger write fails.
  - A ledger entry is never written for a reward that wasn't delivered.
- **Decided (question 2, the owner, 2026-11-23): every ledger entry that depends on the hero's save is written only after that save commits.** Today the `game` function writes four kinds before the save:
  - pending-reward delivery (line 122);
  - quest rewards (`ledger('quests', …)`, line 354);
  - world-boss hunt actions (line 495);
  - ordinary actions: fighting, buying, selling, healing and the rest (line 504).

  **All four move after a successful commit.** The request collects its ledger entries, and writes them once the hero's save (or `save_hero_with_rewards()`) has succeeded.
  - **A failed save writes no ledger entry,** so the ledger never records gold a hero didn't receive.
  - **A ledger write that fails after the commit** still loses that entry. That's the accepted best-effort undercount.
  - **No amount, source or calculation changes:** only the moment of writing does.
  - **The admin hero editor** already writes its ledger entry after its save (`supabase/functions/admin/index.ts:196`), so it is unchanged.
  - **The quest-completion transaction itself** (the quest is marked completed before the save) is not fixed here: it is [#105](https://github.com/Aeturnia/clickmonster/issues/105).

## 6. Tests

**Engine** (Node; `npm test`), for the staging rule (5.1):
- **indivisibility:** pack 39 with gold and 1 relic, delivered; pack 40 with gold and 1 relic, all pending;
- **gold and XP only, at a full pack:** delivered;
- **a blocked reward followed by a gold-only one:** only the second is delivered;
- **a reward with 2 items** at 1 free slot: blocked; at 2: delivered;
- **staging twice** in one request applies nothing twice;
- **ordering** by `id`, with more than 20 open rewards and blocked ones first;
- **`rewardsWaiting` and the notice:** added once, not repeated, and removed on delivery.

**Database** (pgTAP; `npm run test:db`), for `save_hero_with_rewards()` (5.2):
- **execute is refused** for `anon` and `authenticated`, and allowed for `service_role`;
- **all or nothing:**
  - an already claimed id rolls back the hero's update too;
  - another hero's id: the same;
  - a missing id: the same;
  - a duplicate or an empty set: refused;
  - a stale version rolls back the claims;
- **success:** the claims and the save commit together, and the version is +1.

**How the failing cases are made deterministic:** no test relies on racing HTTP requests to produce a failure.
- **Cases 1 and 2** are deterministic already: an action within 150 ms, or one the rules refuse.
- **Cases 3, 4 and 6** (a save that fails or conflicts) use **a test-installed trigger on the local stack only.**
  - The trigger makes the next `characters` update of that one test hero fail.
  - It is created and dropped by the test, and never in a migration.
  - With it, today's code marks the reward claimed and loses it, and the fixed code leaves it pending. So the test fails before the fix and passes after it, every time.
- **Case 5** (two tabs) is inherently a race. It asserts the invariant over repeated runs: each reward delivered at most once, and claimed only if delivered. The deterministic conflict is proved in pgTAP (a stale version and an already claimed id).

**The `game` function on the local stack** (`tests/db`, like `town-rule-api.test.mjs`). They put pending rewards on a local test hero with the local service key. Each of #102's cases fails on today's code:
1. **An action refused with 429:** the reward is still pending, or delivered and saved. Never claimed and lost.
2. **An action refused by a rule violation:** the same.
3. **An action whose save conflicts (409):** the same.
4. **A `state` read whose save fails:** the same.
5. **Two requests at once, from two tabs:** delivered exactly once, and the other answers 409 or delivers nothing.
6. **The killing blow,** followed by a failed save: the hunt's rewards stay pending.
7. **A refused Kingdom claim:** deferred until K-1. `kingdom_claim()` (Kingdoms scope, 5.3.1) will carry the staged ids in the same way.

**And the owner's cases:**
- **a full pack:** the reward stays pending, with one notice;
- **mixed eligible and blocked rewards:** only the eligible ones are delivered;
- **a reward needing several free slots;**
- **delivery after freeing space:** sell an item, and the reward is delivered in that request (question 4, accepted);
- **repeated `state` reads:** the reward is delivered once; the notice isn't repeated; and a read with nothing to deliver doesn't save;
- **a `state` read with a reward and no other change** saves and delivers it.

**Ledger timing** (question 2), on the local stack:
- **an action whose save fails** (with the test trigger) writes no ledger entry: fighting, buying, a hunt action, and a quest-completing fight;
- **the same actions, saved successfully,** write the same entries as today.

**The browser, for the Gear reminder** (question 3):
- the reminder shows while a reward is waiting, with the number of slots to free;
- it disappears once the reward is delivered;
- it works by keyboard, with axe at 0 violations, at 320 px and on desktop.
- **The fake backend** (`tests/ui/harness.mjs`) has no pending rewards today. It gains the minimum: a hero state with `rewardsWaiting`.

## 7. Deployment and rollback

Each step needs the owner's authorization.

1. **Migration first:** a new migration adds `save_hero_with_rewards()`. Nothing uses it yet.
   - **The procedure:** the one in [`docs/landing-l3-report.md`](landing-l3-report.md), section 4. Production's migration history is incomplete on purpose.
   - **Scripts:** a read-only precheck (`supabase/checks/pending_rewards_precheck.sql`), a verify script (`…_verify.sql`) that checks the function and its grants, and a rollback (`supabase/rollback/…_down.sql`) that drops the function.
2. **Then redeploy `game`.**
   - **The version number isn't assumed.** At that gate, with the owner's authorization, the deployment history is read (read-only) to confirm the current version and the next one.
   - The last recorded deploy was version 14 (`docs/sign-out-report.md`, section 22).
3. **Verify after deploy:**
   - the verify script;
   - the owner's live check: a hunt reward delivered, and a pending reward surviving a refused action.
4. **Rollback:** redeploy the previous `game` version.
   - **This reintroduces the defect.** Reward loss on a refused or failed request, and the discarded relic at a full pack, both return until the fix is redeployed.
   - The new function can stay. The old code doesn't call it. Dropping it is a separate step.
   - The `rewardsWaiting` field is ignored by the old code. Pending rewards stay rows, and the old code claims them as it does today.

**Optional, before step 2, with the owner's authorization:** download the deployed `game` source (read-only) to confirm the defect is live, and not only in the repository.

## 8. Acceptance criteria

- **Every case in section 6 passes,** and each of #102's cases fails on the code at `707eabc`.
- **The invariant (section 1) holds** after every test.
- **`save_hero_with_rewards()`:**
  - it is callable only by `service_role`;
  - any mismatch rolls back both the claims and the save.
- **A full pack keeps the whole reward pending.** One notice says so, and the reward is delivered once space exists.
- **Rewards behind a blocked one** are still delivered.
- **R-1 holds** (5.3.1): no hero write commits staged rewards without claiming them. A duel's target save carries no staged ids, and the target's own pending rewards are untouched.
- **No ledger entry without a committed save,** for pending rewards, quest rewards, hunt actions and ordinary actions (question 2).
- **The Gear tab's reminder** shows exactly while a reward is waiting (question 3).
- **Unchanged:** a request with no pending rewards behaves exactly as today, and saves through `saveRow()`. The one exception is that its ledger entry is written after the save (question 2).
- **Unchanged amounts:** reward amounts, hunt payouts and the pack limit (by test and by review of the diff).

## 9. Out of scope

- **Reward amounts and sources,** the hunt payout calculation, and eligibility.
- **The pack limit,** and inventory rules outside pending rewards.
- **Other changes to how saves work,** beyond the reward path and the ledger order (question 2).
- **Quest completion:** marking a quest completed before the hero's save is [#105](https://github.com/Aeturnia/clickmonster/issues/105), its own issue, not authorized.
- **The Kingdoms amendment** (question 6) is its own PR.
- **Kingdoms:** K-1 will use the same staged ids (case 7). The amendment to the Kingdoms baseline (5.3.1, R-1) is a separate change, before K-1.
- **Recording which rewards were delivered,** beyond `claimed_at`.

## 10. Not verified

- **The deployed `game` function** wasn't examined, so whether production has the defect is unconfirmed (section 7, the optional step).
- **How often rewards have been lost,** if at all. Nothing in production was read.
- **The number of open rewards** a hero can accumulate. Read in code, it is one or two per hunt; not measured.

## 11. Questions for the review

| # | Question | Kind |
|---|---|---|
| 1 | **A `state` read that hits a conflict:** reload and try once more before answering 409, or answer 409 as today? | Implementation clarification. **Decided in review: 409 as today,** no automatic retry (5.4) |
| 2 | **The action's own ledger entry,** written before the save today: move it after the commit too, or leave it? | **Owner decision. Decided (2026-11-23): move every save-dependent ledger entry after the commit:** pending rewards, quests, hunts and ordinary actions (5.7) |
| 3 | **A lasting "reward waiting" line** in the Gear tab, as well as the one-time notice? | **Owner decision. Decided (2026-11-23): yes,** informational, gone on delivery (5.6) |
| 4 | **The second staging pass at commit** (5.3): deliver a waiting reward in the same request once space is freed, and stage the killing blow's rewards there. Or deliver on the next request? | Implementation clarification. **Accepted in review** |
| 5 | **The staging rule in the shared engine** (`public/js/engine/rewards.js`), tested in Node? | Implementation clarification. **Accepted in review** |
| 6 | **The Kingdoms baseline:** the accepted `docs/kingdoms-scope.md` (5.3.1, rule 2) puts staged rewards in `kingdom_claim()`'s and `kingdom_release()`'s `p_data` without claiming them. Amend it before K-1, so that those functions claim the staged ids too (R-1, 5.3.1 here)? | **Owner decision. Decided (2026-11-23): a separate small amendment PR, before K-1** (5.3.1) |

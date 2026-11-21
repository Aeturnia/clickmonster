// How the battle log is shown (gameplay polish C, D and E; docs/gameplay-polish-scope.md).
// Presentation only: the stored log (char.battle.log, from the server) is never changed.
// Pure functions, so the rules are tested in Node (tests/log-view.test.mjs).

// The log in groups:
//   before  lines already in the log when this page loaded: their rounds aren't known, so they
//           are never presented as rounds (scope, section 6);
//   start   the opening lines of a fight, before its first action (a duel is all opening lines:
//           it is resolved in one action);
//   turn    the lines one action produced, marked by the client as it acted. A turn's gains are
//           the masteries it raised.
// turnLog is { marks: [{ start, turn, gains }], restored }, or null when the page has seen no
// action in this fight (everything is "before").
export function logGroups(log, turnLog) {
  const n = log.length;
  const restored = turnLog ? Math.min(turnLog.restored || 0, n) : n;
  const marks = (turnLog?.marks || []).filter((m) => m.start >= restored && m.start < n);
  const groups = [];
  if (restored > 0) groups.push({ type: 'before', start: 0, end: restored });
  if (!marks.length) {
    if (n > restored) groups.push({ type: 'start', start: restored, end: n });
    return groups;
  }
  marks.forEach((m, k) => groups.push({
    type: 'turn', turn: m.turn, gains: m.gains || [],
    // The opening lines belong to the first round.
    start: k === 0 ? restored : m.start,
    end: k + 1 < marks.length ? marks[k + 1].start : n,
  }));
  return groups;
}

// Whether a line repeats a reward or loss that the outcome card shows (D). Only these move to
// the card; the narrative lines ("Victory! The Bog Lurker has been slain!", "You have been
// defeated by …") stay in the log. A world boss's victory has no card, and its defeat line also
// says that your damage still counts, so nothing of a hunt is moved.
export function cardLine(b, l) {
  if (!b || !b.over || b.hunt) return false;
  const t = l.text;
  if (b.over === 'victory') {
    if (b.pvp) return l.kind === 'reward' && /^You take \d+ gold from /.test(t);
    return (l.kind === 'reward' && (/ dropped \d+ gold\.$/.test(t) || / mastery is now \d+\.$/.test(t) || /^You gain \d+ experience\.$/.test(t)))
      || (l.kind === 'win' && (/^You found an? /.test(t) || /^A rare find: /.test(t) || /^You reached level \d+!$/.test(t)));
  }
  if (b.over === 'defeat') {
    if (b.pvp) return l.kind === 'bad' && (/^You wake up in town\.$/.test(t) || / takes \d+ of your gold\. You wake up in town\.$/.test(t));
    return l.kind === 'bad' && /^You wake up in town(, having lost [^.]+)?\. Gold in the bank is safe\.$/.test(t);
  }
  return false;
}

// Whether the outcome card lists the masteries raised (a victory over a monster), so the last
// round doesn't list them too (E).
export const cardListsMastery = (b) => b.over === 'victory' && !b.pvp && !b.hunt;

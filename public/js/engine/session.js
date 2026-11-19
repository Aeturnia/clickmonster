// Whether a failed sign-in check means the session has ended, or the sign-in service couldn't be
// asked (docs/sign-out-scope.md, 5.2, as amended by docs/sign-out-report.md, sections 5 and 8).
// For the server's getUser(token) check only: the game function answers 401 for 'ended' and 503
// for 'unavailable'. The list comes from GoTrue's measured answers, as supabase-js 2.45.4 reports
// them (tests/session-answers.mjs):
//   - no token at all;
//   - AuthSessionMissingError: supabase-js's own name for GoTrue's 403 session_not_found (a
//     session ended elsewhere), and for no session;
//   - an AuthApiError with a code that says the token or its user can't be used: bad_jwt (a
//     malformed or expired token), user_not_found, and session_not_found should a later
//     supabase-js pass it through.
// Anything else (a network failure or timeout, a 5xx, an unknown type or code) is 'unavailable',
// which keeps the player's session: the safe side, since signing out always works.
const ENDED_CODES = new Set(['bad_jwt', 'user_not_found', 'session_not_found']);

export function sessionFailure(token, error) {
  if (!token) return 'ended';
  if (error?.name === 'AuthSessionMissingError') return 'ended';
  if (error?.name === 'AuthApiError' && ENDED_CODES.has(error.code)) return 'ended';
  return 'unavailable';
}

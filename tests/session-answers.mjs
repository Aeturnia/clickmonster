// GoTrue's answers as supabase-js 2.45.4 reports them, recorded by SO-1b on the local stack
// (tests/db/session-answers.test.mjs, 2026-11-19; docs/sign-out-report.md, section 2).
// That test fails if the answers change. The classification rule's Node test will use these as
// its fixtures, once the rule is settled at the review gate.
// Only error types, statuses and GoTrue error codes: never a token.
export const GOTRUE_ANSWERS = {
  // A session ended elsewhere (another device signed out everywhere). GoTrue answers 403
  // session_not_found; supabase-js turns that into its own AuthSessionMissingError.
  endedGetUser: { name: 'AuthSessionMissingError', status: 400, code: null },
  endedLogout: { name: 'AuthSessionMissingError', status: 400, code: null },
  endedRenew: { name: 'AuthApiError', status: 400, code: 'refresh_token_not_found' },
  malformedGetUser: { name: 'AuthApiError', status: 403, code: 'bad_jwt' },
  noTokenGetUser: { name: 'AuthSessionMissingError', status: 400, code: null },
  deletedGetUser: { name: 'AuthApiError', status: 403, code: 'user_not_found' },
  // A genuinely issued token left to expire (the opt-in test, run once with jwt_expiry = 30 on the
  // local stack, then restored). Its refresh token still renewed normally.
  expiredGetUser: { name: 'AuthApiError', status: 403, code: 'bad_jwt' },
};

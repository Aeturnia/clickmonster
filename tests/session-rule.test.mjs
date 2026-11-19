// Sign-out and session recovery, SO-6b (docs/sign-out-scope.md): the server's rule for a failed
// sign-in check, tested on GoTrue's answers as measured on the local stack (tests/session-answers.mjs,
// kept current by tests/db/session-answers.test.mjs) and on the failures it must not mistake for an
// ended session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionFailure } from '../public/js/engine/session.js';
import { GOTRUE_ANSWERS as A } from './session-answers.mjs';

const T = 'a-token';

test('SO-6b each measured GoTrue answer for an unusable token is "ended"', () => {
  for (const k of ['endedGetUser', 'malformedGetUser', 'deletedGetUser', 'expiredGetUser', 'noTokenGetUser']) {
    assert.equal(sessionFailure(T, A[k]), 'ended', k);
  }
  assert.equal(sessionFailure('', null), 'ended', 'no token');
  assert.equal(sessionFailure(undefined, A.noTokenGetUser), 'ended', 'no token, as the library reports it');
  assert.equal(sessionFailure(T, { name: 'AuthApiError', status: 403, code: 'session_not_found' }), 'ended', 'session_not_found, if passed through');
});

test('SO-6b an outage, a server error or anything unknown is "unavailable", never "ended"', () => {
  const cases = {
    'network failure': { name: 'AuthRetryableFetchError', status: 0 },
    'gateway timeout': { name: 'AuthRetryableFetchError', status: 504 },
    'server error': { name: 'AuthApiError', status: 500, code: 'unexpected_failure' },
    'rate limited': { name: 'AuthApiError', status: 429, code: 'over_request_rate_limit' },
    'unknown code': { name: 'AuthApiError', status: 403, code: 'something_new' },
    'no code': { name: 'AuthApiError', status: 401, code: null },
    'unknown error type': { name: 'AuthUnknownError', status: 502 },
    'a thrown TypeError': new TypeError('fetch failed'),
    'no error, no user': null,
  };
  for (const [name, err] of Object.entries(cases)) assert.equal(sessionFailure(T, err), 'unavailable', name);
});

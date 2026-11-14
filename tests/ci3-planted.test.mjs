// CI-3 demonstration (docs/ci-scope.md): a deliberate failure, to show this suite's check fails.
// Reverted in the next commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('CI-3 planted failure', () => {
  assert.fail('CI-3 planted failure: this check must fail');
});

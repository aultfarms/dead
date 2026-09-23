import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalTrelloReturnUrl, chooseTrelloToken } from '../dist/tokenChoice.js';

const stored = 'a'.repeat(64);
const fresh = 'b'.repeat(64);

test('a stored token is used when the address has no hash', () => {
  const choice = chooseTrelloToken({ stored, hash: '' });
  assert.equal(choice.source, 'storage');
  assert.equal(choice.token, stored);
  assert.equal(choice.storedIgnoredBecauseHash, false);
});

test('a redirect hash token is used when nothing is stored', () => {
  const choice = chooseTrelloToken({ stored: '', hash: `#token=${fresh}` });
  assert.equal(choice.source, 'hash');
  assert.equal(choice.token, fresh);
  assert.equal(choice.hashTokenLooksValid, true);
});

test('a redirect hash token wins over a stored token', () => {
  const choice = chooseTrelloToken({ stored, hash: `#token=${fresh}` });
  assert.equal(choice.source, 'hash');
  assert.equal(choice.token, fresh);
  assert.equal(choice.storedIgnoredBecauseHash, true);
});

test('a malformed hash token is not used', () => {
  const choice = chooseTrelloToken({ stored: '', hash: '#token=not-a-token' });
  assert.equal(choice.source, 'none');
  assert.equal(choice.token, '');
  assert.equal(choice.hashPresent, true);
  assert.equal(choice.hashTokenLooksValid, false);
});

test('a Trello error in the hash is not treated as a token', () => {
  const choice = chooseTrelloToken({
    stored,
    hash: '#token=&error=token%20denied',
  });
  assert.equal(choice.source, 'none');
  assert.equal(choice.token, '');
  assert.equal(choice.hashError, 'token denied');
});

test('the return URL keeps the real host and adds the missing slash', () => {
  assert.equal(
    canonicalTrelloReturnUrl('https://aultfarms.com/dead#token=abc'),
    'https://aultfarms.com/dead/',
  );
  assert.equal(
    canonicalTrelloReturnUrl('https://aultfarms.github.io/treatments'),
    'https://aultfarms.com/treatments/',
  );
  assert.equal(
    canonicalTrelloReturnUrl('http://localhost:5173/dead/?x=1#token=abc'),
    'http://localhost:5173/dead/?x=1',
  );
});

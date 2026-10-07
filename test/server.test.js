const test = require('node:test');
const assert = require('node:assert/strict');
const { repoUrl, publicPorts } = require('../server');

test('allows plain public HTTP(S) repository URLs', () => {
  assert.equal(repoUrl('https://github.com/owner/repo').startsWith('https://github.com/owner/repo'), true);
});

test('rejects non-HTTP URLs and credential URLs', () => {
  assert.throws(() => repoUrl('file:///tmp/repo'), /http\(s\)/);
  assert.throws(() => repoUrl('https://token@example.com/repo'), /credentials/);
});

test('turns Docker port bindings into local endpoints', () => {
  assert.deepEqual(publicPorts({ '8080/tcp': [{ HostPort: '49153' }] }), [{ hostPort: '49153', url: 'http://localhost:49153' }]);
});

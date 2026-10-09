// Execute the documented adapter with the installed CLI, never a CLI mock.
// A loopback server and isolated config keep every request off live GitLab.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT, SKILL_DIR, read, fencedBlocks } from './helpers.mjs';
const exec = promisify(execFile);
const adapter = fencedBlocks(read(path.join(SKILL_DIR, 'references/forge.md')).split('### GitLab')[1], 'sh')[0];

async function harness(work) {
  const cache = path.join(ROOT, 'node_modules', '.cache');
  fs.mkdirSync(cache, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(cache, 'glab-'));
  const requests = [];
  let user = { username: 'publisher' };
  let note;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    requests.push({ method: req.method, url: req.url, bytes });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v4/user') res.end(JSON.stringify(user));
    else if (req.url === '/api/v4/projects/owner%2Frepo/merge_requests/7/discussions/d-thread/notes') {
      res.end(JSON.stringify({ id: 40, body: JSON.parse(bytes).body }));
    }
    else if (req.url.startsWith('/api/v4/projects/owner%2Frepo/merge_requests/7/notes')) {
      if (req.method !== 'GET') note = { id: 12, author: user, body: JSON.parse(bytes).body };
      res.end(JSON.stringify(note));
    } else { res.statusCode = 404; res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, 'localhost', resolve));
  const host = `localhost:${server.address().port}`;
  // No production tokens, config, proxy or repository discovery in this CLI.
  const env = {
    PATH: process.env.PATH, GLAB_CONFIG_DIR: scratch, GITLAB_TOKEN: 'fixture-only',
    GITLAB_HOST: host, GITLAB_API_HOST: host, GLAB_API_PROTOCOL: 'http',
    GLAB_CHECK_UPDATE: 'false', GLAB_USE_KEYRING: 'false', GLAB_SEND_TELEMETRY: 'false', NO_COLOR: '1',
  };
  const bodyPath = path.join(scratch, 'review.md');
  const command = (kind) => adapter.split('\n').find(l => l.includes(`# 5, ${kind}`))
    .replace(/\s+#.*$/, '').replace(':fullpath', 'owner%2Frepo')
    .replace('<number>', '7').replace('<note-id>', '12').replace('<path>', 'review.md');
  const run = (kind) => exec('bash', ['-o', 'pipefail', '-c', command(kind)], { cwd: scratch, env });
  const shell = (line) => exec('bash', ['-o', 'pipefail', '-c', line], { cwd: scratch, env });
  try { await work({ run, shell, requests, bodyPath, setUser: value => { user = value; } }); }
  finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

test('real glab author lookup yields the actor and rejects a missing author before writes', async () => {
  await harness(async ({ run, requests, setUser }) => {
    const result = await run('authenticated author');
    assert.equal(result.stdout.trim(), 'publisher');
    assert.equal(requests[0].url, '/api/v4/user');
    for (const user of [{}, { username: '' }, { username: null }]) {
      setUser(user);
      await assert.rejects(run('authenticated author'), error => {
        assert.notEqual(error.code, 0, 'missing actor must fail');
        assert.equal(error.stdout.trim(), '', 'missing actor must not become an actor string');
        return true;
      });
    }
    assert.ok(requests.every(r => r.method === 'GET'), JSON.stringify(requests.map(({ method, url }) => ({ method, url }))));
  });
});

for (const kind of ['create', 'update']) {
  test(`real glab ${kind} sends exact Markdown file bytes and saved note reads back unchanged`, async () => {
    await harness(async ({ run, requests, bodyPath }) => {
      const body = '## Safety\n\nCare required: "quoted", $literal, café.\r\n\n## Not applied\n\nUnverified.\n';
      fs.writeFileSync(bodyPath, body);
      await run(kind);
      const request = requests[0];
      assert.equal(request.method, kind === 'create' ? 'POST' : 'PUT');
      assert.equal(request.url, `/api/v4/projects/owner%2Frepo/merge_requests/7/notes${kind === 'create' ? '' : '/12'}`);
      // Compare the decoded JSON field as bytes, including CRLF and UTF-8.
      assert.deepEqual(Buffer.from(JSON.parse(request.bytes).body), fs.readFileSync(bodyPath));
      const saved = JSON.parse((await run('read back')).stdout);
      assert.equal(saved.id, 12);
      assert.deepEqual(Buffer.from(saved.body), fs.readFileSync(bodyPath));
    });
  });
}

// The feedback adapter's thread reply, as one statement with its continuations.
function gitlabReply() {
  const section = read(path.join(SKILL_DIR, 'references/forge.md')).split('## GitLab, through `glab`')[1].split('\n## ')[0];
  const lines = fencedBlocks(section, 'sh').join('\n').split('\n');
  const end = lines.findIndex(l => l.includes('# 5, reply'));
  assert.ok(end > 0, 'the glab adapter has no command marked # 5, reply');
  let start = end;
  while (start > 0 && /\\\s*$/.test(lines[start - 1])) start--;
  return lines.slice(start, end + 1).map(l => l.replace(/\s+#.*$/, '').replace(/\\\s*$/, '')).join(' ')
    .replace(':fullpath', 'owner%2Frepo').replace('<number>', '7')
    .replace('<discussion-id>', 'd-thread').replace('<path>', 'reply.md');
}

test('real glab thread reply posts the reply file, not its path', async () => {
  await harness(async ({ shell, requests, bodyPath }) => {
    const reply = 'Fixed in abc123: `npm test` now prints "ok 12".\n';
    fs.writeFileSync(path.join(path.dirname(bodyPath), 'reply.md'), reply);
    await shell(gitlabReply());
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].url, '/api/v4/projects/owner%2Frepo/merge_requests/7/discussions/d-thread/notes');
    assert.equal(JSON.parse(requests[0].bytes).body, reply);
  });
});

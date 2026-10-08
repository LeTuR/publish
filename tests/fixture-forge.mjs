// Offline REST fixture used only by infra-plan.test.mjs. Accepts the shipped
// gh/glab command forms; real CLI behavior is covered by glab-api.test.mjs.
import fs from 'node:fs';
const [forge, ...args] = process.argv.slice(2);
const stateFile = process.env.FIXTURE_FORGE_STATE;
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
if (args[0] !== 'api') throw new Error('fixture accepts api only');
const methodIndex = args.indexOf('-X');
const method = methodIndex < 0 ? 'GET' : args[methodIndex + 1];
const endpoint = args.find(a => a.startsWith('repos/') || a.startsWith('projects/'));
const fieldIndex = args.indexOf('-F');
const rawIndex = args.indexOf('-f');
const body = fieldIndex >= 0
  ? fs.readFileSync(args[fieldIndex + 1].slice('body=@'.length), 'utf8')
  : rawIndex >= 0 ? args[rawIndex + 1].slice('body='.length) : null;
let result;
if (method === 'POST') {
  if (!(forge === 'gh' ? /issues\/7\/comments$/ : /merge_requests\/7\/notes$/).test(endpoint)) throw new Error('wrong create endpoint');
  result = { id: 12, author: 'publisher', body };
  state.comments.push(result);
} else {
  if (!(forge === 'gh' ? /issues\/comments\/12$/ : /merge_requests\/7\/notes\/12$/).test(endpoint)) throw new Error('wrong saved-note endpoint');
  result = state.comments.find(c => c.id === 12);
  if (!result) throw new Error('saved comment missing');
  if (method !== 'GET') {
    if (method !== (forge === 'gh' ? 'PATCH' : 'PUT')) throw new Error('wrong update verb');
    result.body = body;
  }
}
state.requests.push({ method, endpoint });
fs.writeFileSync(stateFile, JSON.stringify(state));
process.stdout.write(JSON.stringify(result));

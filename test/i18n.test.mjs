// Runs without a browser: node --test test/
// Loads the plain scripts into an isolated VM context and checks the pure helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

function load(...files) {
  const ctx = vm.createContext({ URL });
  ctx.globalThis = ctx;
  for (const f of files) vm.runInContext(read(f), ctx, { filename: f });
  return ctx;
}

test('i18n: pt_BR has exactly the English keys and placeholders', () => {
  const en = JSON.parse(read('_locales/en/messages.json'));
  const pt = JSON.parse(read('_locales/pt_BR/messages.json'));
  assert.deepEqual(Object.keys(pt).sort(), Object.keys(en).sort());
  for (const k of Object.keys(en)) {
    assert.ok(pt[k].message, 'empty pt_BR message: ' + k);
    assert.deepEqual(Object.keys(pt[k].placeholders || {}).sort(), Object.keys(en[k].placeholders || {}).sort(), 'placeholders differ: ' + k);
  }
});

test('i18n: demo-mode fallback matches _locales/en and substitutes placeholders', () => {
  const en = JSON.parse(read('_locales/en/messages.json'));
  const ctx = load('lib/messages-en.js', 'lib/i18n.js');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.PROFILE_RADAR_EN)), en,
    'lib/messages-en.js is stale: run node scripts/sync-i18n-fallback.mjs');
  assert.equal(ctx.I18n.t('statusLast', ['2h ago', 3]), 'Last read 2h ago · 3 new');
  assert.equal(ctx.I18n.t('agoDays', 4), '4d ago');
  assert.equal(ctx.I18n.t('btnReadNow'), 'Read now');
});

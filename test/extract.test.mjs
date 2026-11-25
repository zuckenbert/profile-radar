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

const { ProfileRadar } = load('lib/extract.js');
const { ageHours, slugOf } = ProfileRadar;

test('ageHours: English relative times', () => {
  assert.equal(ageHours('Viewed 22h ago', 'en'), 22);
  assert.equal(ageHours('Viewed 3d ago', 'en'), 72);
  assert.equal(ageHours('Viewed 2w ago', 'en'), 24 * 14);
  assert.equal(ageHours('Viewed 1mo ago', 'en'), 24 * 30);
  assert.equal(ageHours('Viewed 1yr ago', 'en'), 24 * 365);
  assert.equal(ageHours('Viewed 30 mins ago', 'en'), 0.5);
  assert.equal(ageHours('Viewed 15m ago', 'en'), 0.25);
});

test('ageHours: Portuguese relative times', () => {
  assert.equal(ageHours('Visualizou há 5 h', 'pt-BR'), 5);
  assert.equal(ageHours('Visualizou há 3 d', 'pt-BR'), 72);
  assert.equal(ageHours('Visualizou há 2 sem', 'pt-BR'), 24 * 14);
  assert.equal(ageHours('Visualizou há 2 semanas', 'pt-BR'), 24 * 14);
  assert.equal(ageHours('Visualizou há 4 meses', 'pt-BR'), 24 * 120);
  assert.equal(ageHours('Visualizou há 1 ano', 'pt-BR'), 24 * 365);
  assert.equal(ageHours('Viu há 10 minutos', 'pt-BR'), 10 / 60);
});

test('ageHours: "m" is months in Portuguese and minutes in English', () => {
  assert.equal(ageHours('Visualizou há 3 m', 'pt-BR'), 24 * 90);
  assert.equal(ageHours('Viewed 3m ago', 'en-US'), 3 / 60);
});

test('ageHours: lines that are not a view time', () => {
  assert.equal(ageHours('Head of Product at Example Bank', 'en'), null);
  assert.equal(ageHours('12 mutual connections', 'en'), null);
  assert.equal(ageHours('', 'en'), null);
  assert.equal(ageHours(null, 'en'), null);
});

test('slugOf: profile links', () => {
  assert.equal(slugOf('https://www.linkedin.com/in/example-slug/'), 'example-slug');
  assert.equal(slugOf('/in/example-slug?miniProfileUrn=x'), 'example-slug');
  assert.equal(slugOf('https://www.linkedin.com/in/ex%C3%A9mplo-123/'), 'exémplo-123');
  assert.equal(slugOf('https://www.linkedin.com/company/example-co/'), null);
  assert.equal(slugOf('https://www.linkedin.com/analytics/profile-views/'), null);
});

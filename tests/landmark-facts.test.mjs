import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LANDMARK_FACTS } from '../js/landmark-facts.js';

test('exactly the five requested, existing placeable landmarks have facts', () => {
  const keys = ['coit', 'transamerica', 'ferry', 'palace', 'paintedladies'];
  assert.deepEqual(Object.keys(LANDMARK_FACTS).sort(), keys.sort());
  const catalog = readFileSync(new URL('../js/structures.js', import.meta.url), 'utf8');
  for (const key of keys) {
    const entry = catalog.split('\n').find(line => line.includes(`S('${key}',`));
    assert.ok(entry?.includes("'landmark'"), `${key} is in the landmark catalog`);
    assert.ok(!entry.includes('fixed: true'), `${key} is freely placeable`);
    assert.ok(!entry.includes('hidden: true'), `${key} is visible in Build`);
  }
});

test('each fact is a concise single sentence with a named HTTPS citation', () => {
  for (const fact of Object.values(LANDMARK_FACTS)) {
    assert.ok(fact.text.length < 110 && fact.text.endsWith('.'));
    assert.ok(!fact.text.includes('\n'));
    assert.ok(fact.source.length > 0);
    assert.equal(new URL(fact.url).protocol, 'https:');
  }
});

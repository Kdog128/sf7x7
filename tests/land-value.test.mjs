import test from 'node:test';
import assert from 'node:assert/strict';
import { landValue, landValueBonus } from '../js/land-value.js';

test('parks and landmarks (amenity), waterfront and transit increase land value', () => {
  const base = landValue();
  for (const factor of [{ amenity: 0.5 }, { amenity: 0.6 }, { water: 0.12 }, { transit: 0.75 }]) {
    assert.ok(landValue(factor) > base);
  }
});

test('industry and highways lower value even with cosmetic traffic', () => {
  for (const simulatedTraffic of [true, false]) {
    const base = landValue({ simulatedTraffic });
    for (const factor of [{ industry: 0.5 }, { highway: 0.5 }]) {
      assert.ok(landValue({ ...factor, simulatedTraffic }) < base);
    }
  }
});

test('effects combine, saturate and remain finite', () => {
  assert.ok(landValue({ amenity: 0.5, transit: 0.5 }) > landValue({ amenity: 0.5 }));
  assert.equal(landValue({ activity: 1, amenity: 1, services: 1, transit: 1, water: 0.12, heat: 1 }), 1);
  assert.equal(landValue({ noise: 1, industry: 1, highway: 1 }), 0);
  const fields = ['activity', 'amenity', 'services', 'transit', 'water', 'noise', 'traffic', 'industry', 'highway', 'heat'];
  for (const invalid of [NaN, Infinity, -Infinity, -100, 100]) {
    const value = landValue(Object.fromEntries(fields.map(k => [k, invalid])));
    assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
  }
});

test('higher land values allow more development levels; disabling gives neutral values', () => {
  assert.deepEqual([0.15, 0.16, 0.54, 0.55, 0.79, 0.8, 1].map(v => landValueBonus(v)), [-1, 0, 0, 1, 1, 2, 2]);
  assert.equal(landValue({ enabled: false, industry: 1, highway: 1 }), 0.5);
  assert.equal(landValueBonus(1, false), 0);
  assert.equal(landValueBonus(NaN), 0);
});

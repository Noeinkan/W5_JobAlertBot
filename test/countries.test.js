import test from 'node:test';
import assert from 'node:assert/strict';
import { inferCountryFromLocation, normalizeCountry } from '../src/utils/countries.js';

test('normalizeCountry accepts human-readable country names', () => {
  assert.equal(normalizeCountry('Netherlands'), 'nl');
  assert.equal(normalizeCountry('Germany'), 'de');
  assert.equal(normalizeCountry('Denmark'), 'dk');
});

test('inferCountryFromLocation only infers explicit country locations', () => {
  assert.equal(inferCountryFromLocation('United Kingdom'), 'uk');
  assert.equal(inferCountryFromLocation('Italia'), 'it');
  assert.equal(inferCountryFromLocation('London'), null);
});
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearProfileFitCache, scoreProfileFit } from '../src/utils/profileFit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const profilePath = path.join(__dirname, '..', 'data', 'profile.json');

test('scoreProfileFit flags generic data-platform EM (Databricks) as Red', () => {
  clearProfileFitCache();
  const out = scoreProfileFit(
    {
      title: 'Engineering Manager - Databricks - London - Up to £120k',
      description: [
        'Senior engineering manager - Hybrid role in Data & Digital Platforms',
        'Lead globally distributed engineering teams across data platforms and low-code tools.',
        'Oversee vendor delivery, ensuring quality, value and alignment to standards.',
        'Cloud data platforms (e.g. Databricks, Azure)',
      ].join('\n'),
    },
    profilePath,
  );
  assert.equal(out.rating, 'Red');
  assert.ok(out.score < 4);
});

test('scoreProfileFit ranks ISO 19650 / CDE / programme context as Green', () => {
  clearProfileFitCache();
  const out = scoreProfileFit(
    {
      title: 'Digital Delivery Lead — Transmission Infrastructure',
      description: [
        'Client-side digital lead for a national transmission programme.',
        'Implement ISO 19650 across the portfolio and govern the Common Data Environment.',
        'Coordinate delivery partners on substation and renewables infrastructure scope.',
      ].join('\n'),
    },
    profilePath,
  );
  assert.equal(out.rating, 'Green');
  assert.ok(out.score >= 10);
});

test('scoreProfileFit returns Amber when no profile signals fire', () => {
  clearProfileFitCache();
  const out = scoreProfileFit(
    {
      title: 'Office Administrator',
      description: 'General administrative duties and reception cover.',
    },
    profilePath,
  );
  assert.equal(out.rating, 'Amber');
  assert.equal(out.score, 0);
  assert.equal(out.reason, null);
});

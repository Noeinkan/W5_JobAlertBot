import test from 'node:test';
import assert from 'node:assert/strict';
import { jobMatchesSearch, sourceAllowed } from '../src/utils/search.js';

test('jobMatchesSearch rejects permanent roles for contract-only searches', () => {
  const search = {
    contract_only: true,
    exclude_keywords: [],
  };

  const job = {
    title: 'Senior BIM Manager',
    company: 'Example Ltd',
    location: 'London',
    description: 'Permanent role',
    isContract: false,
  };

  assert.equal(jobMatchesSearch(job, search), false);
});

test('jobMatchesSearch rejects excluded keywords across title and description', () => {
  const search = {
    contract_only: false,
    exclude_keywords: ['graduate', 'junior'],
  };

  const job = {
    title: 'Junior BIM Manager',
    company: 'Example Ltd',
    location: 'London',
    description: 'Great opportunity',
    isContract: true,
  };

  assert.equal(jobMatchesSearch(job, search), false);
});

test('jobMatchesSearch accepts matching jobs when no filters exclude them', () => {
  const search = {
    contract_only: false,
    exclude_keywords: ['graduate'],
  };

  const job = {
    title: 'Digital Delivery Lead',
    company: 'Example Ltd',
    location: 'London',
    description: 'Leadership role for major infrastructure programme',
    isContract: false,
  };

  assert.equal(jobMatchesSearch(job, search), true);
});

test('sourceAllowed respects per-search source lists', () => {
  const search = {
    allowed_sources: ['adzuna', 'reed'],
  };

  assert.equal(sourceAllowed(search, 'adzuna'), true);
  assert.equal(sourceAllowed(search, 'serper'), false);
});

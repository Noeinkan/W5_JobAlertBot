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

test('jobMatchesSearch rejects explicit United States listings for European searches', () => {
  const search = {
    country: 'nl',
    contract_only: false,
    exclude_keywords: [],
  };

  const job = {
    title: 'Digital Construction Lead',
    company: 'Example BV',
    location: 'Remote, United States',
    description: 'Leadership role for a remote-first practice',
    isContract: false,
  };

  assert.equal(jobMatchesSearch(job, search), false);
});

test('jobMatchesSearch keeps city-only listings when no conflicting country is stated', () => {
  const search = {
    country: 'nl',
    contract_only: false,
    exclude_keywords: [],
  };

  const job = {
    title: 'Digital Construction Lead',
    company: 'Example BV',
    location: 'Amsterdam',
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

test('sourceAllowed routes Italian searches only to multi-country sources', () => {
  const search = {
    country: 'it',
    allowed_sources: ['adzuna', 'reed', 'linkedin', 'jooble'],
  };

  // reed is UK-only and must be filtered out for IT searches
  assert.equal(sourceAllowed(search, 'reed'), false);
  // adzuna, linkedin, jooble support IT
  assert.equal(sourceAllowed(search, 'adzuna'), true);
  assert.equal(sourceAllowed(search, 'linkedin'), true);
  assert.equal(sourceAllowed(search, 'jooble'), true);
});

test('sourceAllowed routes Denmark searches only to supported multi-country sources', () => {
  const search = {
    country: 'dk',
    allowed_sources: ['adzuna', 'linkedin', 'jooble', 'serper'],
  };

  assert.equal(sourceAllowed(search, 'adzuna'), false);
  assert.equal(sourceAllowed(search, 'linkedin'), true);
  assert.equal(sourceAllowed(search, 'jooble'), true);
  assert.equal(sourceAllowed(search, 'serper'), true);
});

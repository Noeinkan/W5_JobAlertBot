import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/db.js';

function createJob(overrides = {}) {
  return {
    externalId: 'job-1',
    source: 'adzuna',
    title: 'Senior BIM Manager',
    company: 'Example Ltd',
    location: 'London',
    salaryMin: 85000,
    salaryMax: 95000,
    url: 'https://example.com/job-1',
    searchId: 'bim_lead',
    isContract: false,
    postedAt: '2026-03-21T10:00:00.000Z',
    ...overrides,
  };
}

test('insertJob deduplicates on title company and source', () => {
  const db = createDatabase(':memory:');

  try {
    const firstInsert = db.insertJob(createJob());
    const secondInsert = db.insertJob(createJob({ externalId: 'job-2', url: 'https://example.com/job-2' }));
    const stats = db.getStats();

    assert.equal(firstInsert, true);
    assert.equal(secondInsert, false);
    assert.equal(stats.totalJobs, 1);
    assert.deepEqual(stats.bySource, [{ source: 'adzuna', count: 1 }]);
    assert.deepEqual(stats.bySearch, [{ search_id: 'bim_lead', count: 1 }]);
  } finally {
    db.close();
  }
});

test('insertJob treats same title and company from different sources as distinct', () => {
  const db = createDatabase(':memory:');

  try {
    db.insertJob(createJob({ source: 'adzuna' }));
    db.insertJob(createJob({ source: 'reed', externalId: 'job-3' }));
    const stats = db.getStats();

    assert.equal(stats.totalJobs, 2);
    assert.deepEqual(stats.bySource, [
      { source: 'adzuna', count: 1 },
      { source: 'reed', count: 1 },
    ]);
  } finally {
    db.close();
  }
});

test('getPendingJobs excludes jobs annotated with a filter_reason', () => {
  const db = createDatabase(':memory:');

  try {
    db.insertJob(createJob({
      externalId: 'eligible',
      title: 'Eligible BIM Lead',
      ragRating: 'Green',
      ragScore: 15,
      seniorityPassed: true,
      salaryPassed: true,
      filterReason: null,
    }));
    db.insertJob(createJob({
      externalId: 'dropped',
      title: 'Low-fit BIM Role',
      source: 'reed',
      ragRating: 'Red',
      ragScore: 2,
      seniorityPassed: true,
      salaryPassed: true,
      filterReason: 'filtered_rag',
    }));

    const pending = db.getPendingJobs();

    assert.equal(pending.length, 1);
    assert.equal(pending[0].title, 'Eligible BIM Lead');
    assert.equal(pending[0].ragRating, 'Green');
    assert.equal(pending[0].ragScore, 15);
  } finally {
    db.close();
  }
});

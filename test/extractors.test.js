import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJobSignals, mergeJobSignals } from '../src/utils/extractors.js';

test('extractJobSignals detects between X and Y', () => {
  const signals = extractJobSignals({
    title: 'BIM Lead',
    description: 'Salary between £65k and £80k per annum',
  });
  assert.equal(signals.salaryMin, 65000);
  assert.equal(signals.salaryMax, 80000);
  assert.equal(signals.isContract, false);
});

test('extractJobSignals detects up to X', () => {
  const signals = extractJobSignals({
    title: 'BIM Manager',
    description: 'Up to £90k per annum DOE',
  });
  assert.equal(signals.salaryMin, null);
  assert.equal(signals.salaryMax, 90000);
  assert.equal(signals.salaryText, 'Up to £90,000');
});

test('extractJobSignals detects from X', () => {
  const signals = extractJobSignals({
    title: 'Information Manager',
    description: 'Starting from £70,000 plus benefits',
  });
  assert.equal(signals.salaryMin, 70000);
  assert.equal(signals.salaryMax, null);
});

test('extractJobSignals detects circa X with k-suffix', () => {
  const signals = extractJobSignals({
    title: 'Senior Digital Construction Manager',
    description: 'Fixed term 12 month contract. c. £75k + package.',
  });
  assert.equal(signals.salaryMin, 75000);
  assert.equal(signals.isContract, true);
  assert.equal(signals.contractLengthMonths, 12);
});

test('extractJobSignals flags OTE', () => {
  const signals = extractJobSignals({
    title: 'Sales Lead',
    description: 'Up to £90k OTE for the right candidate',
  });
  assert.equal(signals.salaryMax, 90000);
  assert.equal(signals.salaryText.includes('OTE'), true);
});

test('extractJobSignals detects remote type', () => {
  const remote = extractJobSignals({ title: 'X', description: 'Fully remote, UK based.' });
  assert.equal(remote.remoteType, 'remote');

  const hybrid = extractJobSignals({ title: 'X', description: 'Hybrid working, 2 days in the office.' });
  assert.equal(hybrid.remoteType, 'hybrid');

  const onsite = extractJobSignals({ title: 'X', description: 'On-site only, London office.' });
  assert.equal(onsite.remoteType, 'onsite');
});

test('extractJobSignals detects contract length', () => {
  const twelve = extractJobSignals({ title: 'X', description: '12 month fixed-term contract' });
  assert.equal(twelve.contractLengthMonths, 12);

  const six = extractJobSignals({ title: 'X', description: 'FTC for 6 months, rolling' });
  assert.equal(six.contractLengthMonths, 6);

  const range = extractJobSignals({ title: 'X', description: '6 to 12 month contract' });
  assert.equal(range.contractLengthMonths, 12);
});

test('mergeJobSignals upgrades missing salary fields', () => {
  const job = {
    title: 'BIM Manager',
    salaryMin: null,
    salaryMax: null,
    salaryText: 'Salary not listed',
    isContract: false,
  };
  const signals = {
    salaryMin: 75000,
    salaryMax: null,
    salaryText: 'From £75,000',
    isContract: false,
    remoteType: 'hybrid',
    contractLengthMonths: null,
  };
  const merged = mergeJobSignals(job, signals);
  assert.equal(merged.salaryMin, 75000);
  assert.equal(merged.salaryText, 'From £75,000');
  assert.equal(merged.remoteType, 'hybrid');
});

test('mergeJobSignals upgrades partial to full range', () => {
  const job = { salaryMin: 65000, salaryMax: null, salaryText: 'From £65,000', isContract: false };
  const signals = {
    salaryMin: 65000,
    salaryMax: 80000,
    salaryText: '£65,000 - £80,000',
    isContract: false,
  };
  const merged = mergeJobSignals(job, signals);
  assert.equal(merged.salaryMax, 80000);
  assert.equal(merged.salaryText, '£65,000 - £80,000');
});

test('mergeJobSignals preserves existing salary when signals are empty', () => {
  const job = {
    salaryMin: 70000,
    salaryMax: 90000,
    salaryText: '£70,000 - £90,000',
    isContract: false,
  };
  const signals = {
    salaryMin: null,
    salaryMax: null,
    salaryText: 'Salary not listed',
    isContract: false,
  };
  const merged = mergeJobSignals(job, signals);
  assert.equal(merged.salaryMin, 70000);
  assert.equal(merged.salaryMax, 90000);
  assert.equal(merged.salaryText, '£70,000 - £90,000');
});

test('mergeJobSignals upgrades contract detection', () => {
  const job = { salaryMin: null, salaryMax: null, isContract: false };
  const signals = {
    salaryMin: 600,
    salaryMax: 650,
    salaryText: '£600-£650/day',
    isContract: true,
    remoteType: null,
    contractLengthMonths: null,
  };
  const merged = mergeJobSignals(job, signals);
  assert.equal(merged.isContract, true);
});

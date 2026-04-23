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

test('extractJobSignals detects sectors', () => {
  const nuclear = extractJobSignals({
    title: 'BIM Manager',
    description: 'Senior role on the Sizewell C nuclear new build programme.',
  });
  assert.deepEqual(nuclear.sectors.sort(), ['nuclear']);

  const rail = extractJobSignals({
    title: 'Information Manager',
    description: 'Working on HS2 phase 2a delivery for Network Rail.',
  });
  assert.ok(rail.sectors.includes('rail'));

  const multi = extractJobSignals({
    title: 'Digital Lead',
    description: 'Healthcare and education framework delivery, mainly NHS trusts and school estate.',
  });
  assert.ok(multi.sectors.includes('healthcare'));
  assert.ok(multi.sectors.includes('education'));
});

test('extractJobSignals detects security clearances', () => {
  const sc = extractJobSignals({ title: 'X', description: 'Must hold SC clearance' });
  assert.deepEqual(sc.clearances, ['SC']);

  const dv = extractJobSignals({ title: 'X', description: 'DV cleared candidates only' });
  assert.deepEqual(dv.clearances, ['DV']);

  const bpss = extractJobSignals({ title: 'X', description: 'BPSS required on day one' });
  assert.deepEqual(bpss.clearances, ['BPSS']);

  const none = extractJobSignals({ title: 'X', description: 'No clearance required' });
  assert.deepEqual(none.clearances, []);
});

test('extractJobSignals detects tech tool mentions', () => {
  const tools = extractJobSignals({
    title: 'BIM Coordinator',
    description: 'Expert in Revit, Navisworks and Autodesk Construction Cloud. Dynamo a plus.',
  });
  assert.ok(tools.techTools.includes('Revit'));
  assert.ok(tools.techTools.includes('Navisworks'));
  assert.ok(tools.techTools.includes('ACC'));
  assert.ok(tools.techTools.includes('Dynamo'));
});

test('extractJobSignals detects years of experience', () => {
  const a = extractJobSignals({ title: 'X', description: '5+ years of experience required' });
  assert.equal(a.yearsExperience, 5);

  const b = extractJobSignals({ title: 'X', description: 'At least 10 years working in BIM' });
  assert.equal(b.yearsExperience, 10);

  const c = extractJobSignals({ title: 'X', description: 'Minimum 7 years experience' });
  assert.equal(c.yearsExperience, 7);

  const d = extractJobSignals({ title: 'X', description: '8 years+ in digital delivery' });
  assert.equal(d.yearsExperience, 8);
});

test('extractJobSignals detects benefits', () => {
  const signals = extractJobSignals({
    title: 'BIM Director',
    description: 'Salary up to £110k, 15% bonus, £6,000 car allowance, 10% pension, share options available.',
  });
  assert.equal(signals.hasBonus, true);
  assert.equal(signals.bonusPercent, 15);
  assert.equal(signals.carAllowance, 6000);
  assert.equal(signals.pensionPercent, 10);
  assert.equal(signals.hasEquity, true);
});

test('extractJobSignals parses k-suffix car allowance', () => {
  const signals = extractJobSignals({
    title: 'X',
    description: 'Car allowance £7k per year plus bonus',
  });
  assert.equal(signals.carAllowance, 7000);
});

test('mergeJobSignals unions sector / clearance / tool arrays', () => {
  const job = {
    sectors: ['rail'],
    clearances: [],
    techTools: ['Revit'],
  };
  const signals = {
    sectors: ['rail', 'nuclear'],
    clearances: ['SC'],
    techTools: ['Revit', 'Navisworks'],
  };
  const merged = mergeJobSignals(job, signals);
  assert.deepEqual(merged.sectors.sort(), ['nuclear', 'rail']);
  assert.deepEqual(merged.clearances, ['SC']);
  assert.deepEqual(merged.techTools.sort(), ['Navisworks', 'Revit']);
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSalaryInfo, passesMinimumSalary } from '../src/utils/salary.js';

test('buildSalaryInfo detects permanent salary ranges', () => {
  const salary = buildSalaryInfo({
    title: 'Senior BIM Manager',
    description: 'Salary £85,000 - £105,000 per annum',
  });

  assert.equal(salary.isContract, false);
  assert.equal(salary.salaryMin, 85000);
  assert.equal(salary.salaryMax, 105000);
  assert.equal(salary.salaryText, '£85,000 - £105,000');
});

test('buildSalaryInfo detects contract day rates and IR35 flags', () => {
  const salary = buildSalaryInfo({
    title: 'CDE Solution Architect Contract',
    description: '£600-620/day Outside IR35',
  });

  assert.equal(salary.isContract, true);
  assert.equal(salary.salaryMin, 600);
  assert.equal(salary.salaryMax, 620);
  assert.equal(salary.salaryText, '£600.00-£620.00/day Outside IR35');
});

test('buildSalaryInfo parses k-suffix single values', () => {
  const salary = buildSalaryInfo({
    title: 'Senior Digital Construction Manager',
    description: 'Fixed term 12 month contract\nc. £75k +',
  });

  assert.equal(salary.salaryMin, 75000);
  assert.equal(salary.salaryMax, null);
  assert.equal(salary.isContract, true);
  assert.equal(salary.salaryText, '£75,000');
});

test('buildSalaryInfo parses k-suffix single values for permanent roles', () => {
  const salary = buildSalaryInfo({
    title: 'Senior BIM Manager',
    description: 'Salary circa £75k per annum',
  });

  assert.equal(salary.salaryMin, 75000);
  assert.equal(salary.isContract, false);
  assert.equal(salary.salaryText, 'From £75,000');
});

test('buildSalaryInfo parses k-suffix ranges', () => {
  const salary = buildSalaryInfo({
    title: 'BIM Lead',
    description: 'Salary £65k - £80K per annum',
  });

  assert.equal(salary.isContract, false);
  assert.equal(salary.salaryMin, 65000);
  assert.equal(salary.salaryMax, 80000);
  assert.equal(salary.salaryText, '£65,000 - £80,000');
});

test('buildSalaryInfo handles "up to" upper bound', () => {
  const salary = buildSalaryInfo({
    title: 'BIM Manager',
    description: 'Up to £90k per annum DOE',
  });
  assert.equal(salary.salaryMin, null);
  assert.equal(salary.salaryMax, 90000);
  assert.equal(salary.salaryText, 'Up to £90,000');
});

test('buildSalaryInfo handles "between X and Y"', () => {
  const salary = buildSalaryInfo({
    title: 'Lead',
    description: 'Salary between £65,000 and £80,000',
  });
  assert.equal(salary.salaryMin, 65000);
  assert.equal(salary.salaryMax, 80000);
});

test('buildSalaryInfo handles "from X"', () => {
  const salary = buildSalaryInfo({
    title: 'Engineer',
    description: 'Starting from £70,000 depending on experience',
  });
  assert.equal(salary.salaryMin, 70000);
  assert.equal(salary.salaryMax, null);
  assert.equal(salary.salaryText, 'From £70,000');
});

test('buildSalaryInfo appends (OTE) suffix when detected', () => {
  const salary = buildSalaryInfo({
    title: 'Sales Lead',
    description: 'Up to £90k OTE',
  });
  assert.equal(salary.salaryText, 'Up to £90,000 (OTE)');
});

test('passesMinimumSalary uses salary max when present', () => {
  assert.equal(
    passesMinimumSalary({ salaryMin: 65000, salaryMax: 90000 }, 80000),
    true
  );
  assert.equal(
    passesMinimumSalary({ salaryMin: 65000, salaryMax: 75000 }, 80000),
    false
  );
});

test('passesMinimumSalary keeps listings with no salary data', () => {
  assert.equal(
    passesMinimumSalary({ salaryMin: null, salaryMax: null }, 70000),
    true
  );
});

test('buildSalaryInfo parses Italian RAL format with dot thousands', () => {
  const salary = buildSalaryInfo({
    title: 'BIM Manager',
    description: 'RAL 50.000€ lordi annui',
    country: 'it',
  });
  assert.equal(salary.salaryMin, 50000);
  assert.equal(salary.currency, 'EUR');
});

test('buildSalaryInfo parses Italian range "da X a Y"', () => {
  const salary = buildSalaryInfo({
    title: 'Coordinatore BIM',
    description: 'RAL da 45.000€ a 60.000€ annui',
    country: 'it',
  });
  assert.equal(salary.salaryMin, 45000);
  assert.equal(salary.salaryMax, 60000);
  assert.equal(salary.currency, 'EUR');
});

test('buildSalaryInfo detects partita IVA as contract', () => {
  const salary = buildSalaryInfo({
    title: 'BIM Specialist',
    description: 'Collaborazione in partita IVA, 350€ al giorno',
    country: 'it',
  });
  assert.equal(salary.isContract, true);
});

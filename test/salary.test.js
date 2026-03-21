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

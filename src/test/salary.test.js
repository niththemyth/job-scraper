/**
 * @file test/salary.test.js
 * @description Tests for src/lib/salary.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSalaryFromDescription } from '../lib/salary.js';

test('parseSalaryFromDescription — "$120k-$160k" → { min: 120000, max: 160000 }', () => {
  const result = parseSalaryFromDescription('Salary range: $120k-$160k per year.');
  assert.deepEqual(result, { salary_min: 120000, salary_max: 160000, salary_raw: '$120k-$160k' });
});

test('parseSalaryFromDescription — "$120,000–$160,000" → { min: 120000, max: 160000 }', () => {
  const result = parseSalaryFromDescription('Compensation: $120,000–$160,000 annually.');
  assert.deepEqual(result, { salary_min: 120000, salary_max: 160000, salary_raw: '$120,000–$160,000' });
});

test('parseSalaryFromDescription — "$80k+" → { min: 80000, max: null }', () => {
  const result = parseSalaryFromDescription('We offer $80k+ depending on experience.');
  assert.deepEqual(result, { salary_min: 80000, salary_max: null, salary_raw: '$80k+' });
});

test('parseSalaryFromDescription — "no salary" → null', () => {
  assert.equal(parseSalaryFromDescription('No salary information provided.'), null);
});

test('parseSalaryFromDescription — null input → null', () => {
  assert.equal(parseSalaryFromDescription(null), null);
});

test('parseSalaryFromDescription — empty string → null', () => {
  assert.equal(parseSalaryFromDescription(''), null);
});

test('parseSalaryFromDescription — "$100,000-$150,000" with comma notation', () => {
  const result = parseSalaryFromDescription('Base salary $100,000-$150,000.');
  assert.deepEqual(result, { salary_min: 100000, salary_max: 150000, salary_raw: '$100,000-$150,000' });
});

test('parseSalaryFromDescription — "$90k–$130k" with en-dash', () => {
  const result = parseSalaryFromDescription('Offering $90k–$130k.');
  assert.deepEqual(result, { salary_min: 90000, salary_max: 130000, salary_raw: '$90k–$130k' });
});

test('parseSalaryFromDescription — prefers range over open-ended when both present', () => {
  const result = parseSalaryFromDescription('$100k-$150k. At least $80k+.');
  assert.ok(result !== null);
  assert.equal(result.salary_min, 100000);
  assert.equal(result.salary_max, 150000);
});

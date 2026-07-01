/**
 * @file test/filter.test.js
 * @description Tests for src/lib/filter.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passesFilter } from '../lib/filter.js';

const baseProfile = {
  includeTitles: ['software engineer', 'swe', 'developer'],
  excludeTitles: ['manager', 'director', 'intern'],
  entryLevelOnly: false,
  maxYearsExperience: 2,
};

test('passesFilter — matching include title passes', () => {
  const job = { title: 'Software Engineer', min_years: null };
  assert.equal(passesFilter(job, baseProfile), true);
});

test('passesFilter — case-insensitive include title', () => {
  const job = { title: 'JUNIOR SWE', min_years: null };
  assert.equal(passesFilter(job, baseProfile), true);
});

test('passesFilter — no matching include title fails', () => {
  const job = { title: 'Product Manager', min_years: null };
  assert.equal(passesFilter(job, baseProfile), false);
});

test('passesFilter — matching exclude title fails', () => {
  const job = { title: 'Software Engineer Manager', min_years: null };
  assert.equal(passesFilter(job, baseProfile), false);
});

test('passesFilter — intern excluded', () => {
  const job = { title: 'Software Engineer Intern', min_years: null };
  assert.equal(passesFilter(job, baseProfile), false);
});

test('passesFilter — entry-level gate: min_years > maxYearsExperience fails', () => {
  const profile = { ...baseProfile, entryLevelOnly: true, maxYearsExperience: 2 };
  const job = { title: 'Software Engineer', min_years: 3 };
  assert.equal(passesFilter(job, profile), false);
});

test('passesFilter — entry-level gate: null min_years passes', () => {
  const profile = { ...baseProfile, entryLevelOnly: true, maxYearsExperience: 2 };
  const job = { title: 'Software Engineer', min_years: null };
  assert.equal(passesFilter(job, profile), true);
});

test('passesFilter — entry-level gate: min_years === maxYearsExperience passes', () => {
  const profile = { ...baseProfile, entryLevelOnly: true, maxYearsExperience: 2 };
  const job = { title: 'Software Engineer', min_years: 2 };
  assert.equal(passesFilter(job, profile), true);
});

test('passesFilter — entry-level gate: min_years < maxYearsExperience passes', () => {
  const profile = { ...baseProfile, entryLevelOnly: true, maxYearsExperience: 2 };
  const job = { title: 'Software Engineer', min_years: 1 };
  assert.equal(passesFilter(job, profile), true);
});

test('passesFilter — entry-level gate off: high min_years passes', () => {
  const profile = { ...baseProfile, entryLevelOnly: false, maxYearsExperience: 2 };
  const job = { title: 'Software Developer', min_years: 5 };
  assert.equal(passesFilter(job, profile), true);
});

test('passesFilter — title with include substring matches', () => {
  const job = { title: 'Full Stack Developer', min_years: null };
  assert.equal(passesFilter(job, baseProfile), true);
});

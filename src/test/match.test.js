/**
 * @file test/match.test.js
 * @description Tests for src/lib/match.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreJob, inferMinYears, inferSeniority } from '../lib/match.js';

// ---------------------------------------------------------------------------
// scoreJob
// ---------------------------------------------------------------------------

test('scoreJob — counts skills in title and description', () => {
  const job = {
    title: 'Python Developer',
    description: 'We use Python and React to build great products.',
  };
  const profile = { skills: ['Python', 'React', 'Go'] };
  assert.equal(scoreJob(job, profile), 2);
});

test('scoreJob — case-insensitive matching', () => {
  const job = { title: 'PYTHON engineer', description: 'uses react' };
  const profile = { skills: ['python', 'React'] };
  assert.equal(scoreJob(job, profile), 2);
});

test('scoreJob — no matching skills returns 0', () => {
  const job = { title: 'Data Scientist', description: 'Machine learning models' };
  const profile = { skills: ['Kubernetes', 'Terraform'] };
  assert.equal(scoreJob(job, profile), 0);
});

test('scoreJob — empty description does not crash', () => {
  const job = { title: 'Python Engineer' };
  const profile = { skills: ['Python'] };
  assert.equal(scoreJob(job, profile), 1);
});

test('scoreJob — empty skills returns 0', () => {
  const job = { title: 'Python Engineer', description: 'lots of Python' };
  const profile = { skills: [] };
  assert.equal(scoreJob(job, profile), 0);
});

// ---------------------------------------------------------------------------
// inferMinYears
// ---------------------------------------------------------------------------

test('inferMinYears — "5+ years of experience" → 5', () => {
  assert.equal(inferMinYears('Requires 5+ years of experience in the field.'), 5);
});

test('inferMinYears — "minimum 3 years" → 3', () => {
  assert.equal(inferMinYears('Minimum 3 years of relevant experience required.'), 3);
});

test('inferMinYears — "at least 2 years" → 2', () => {
  assert.equal(inferMinYears('You must have at least 2 years of professional experience.'), 2);
});

test('inferMinYears — returns highest when multiple matches', () => {
  assert.equal(inferMinYears('1+ years in cloud; 3+ years overall experience.'), 3);
});

test('inferMinYears — "no requirement" → null', () => {
  assert.equal(inferMinYears('No prior experience needed.'), null);
});

test('inferMinYears — null input → null', () => {
  assert.equal(inferMinYears(null), null);
});

test('inferMinYears — empty string → null', () => {
  assert.equal(inferMinYears(''), null);
});

// ---------------------------------------------------------------------------
// inferSeniority
// ---------------------------------------------------------------------------

test('inferSeniority — "Senior Software Engineer" → senior', () => {
  assert.equal(inferSeniority('Senior Software Engineer'), 'senior');
});

test('inferSeniority — "New Grad Software Engineer" → entry', () => {
  assert.equal(inferSeniority('New Grad Software Engineer'), 'entry');
});

test('inferSeniority — "Junior Developer" → entry', () => {
  assert.equal(inferSeniority('Junior Developer'), 'entry');
});

test('inferSeniority — "Associate Software Engineer" → entry', () => {
  assert.equal(inferSeniority('Associate Software Engineer'), 'entry');
});

test('inferSeniority — "Staff Engineer" → senior', () => {
  assert.equal(inferSeniority('Staff Engineer'), 'senior');
});

test('inferSeniority — "Principal Engineer" → senior', () => {
  assert.equal(inferSeniority('Principal Engineer'), 'senior');
});

test('inferSeniority — "Lead Engineer" → senior', () => {
  assert.equal(inferSeniority('Lead Engineer'), 'senior');
});

test('inferSeniority — "Software Engineer II" → unknown', () => {
  assert.equal(inferSeniority('Software Engineer II'), 'unknown');
});

test('inferSeniority — null → unknown', () => {
  assert.equal(inferSeniority(null), 'unknown');
});

test('inferSeniority — case insensitive: "SENIOR Developer" → senior', () => {
  assert.equal(inferSeniority('SENIOR Developer'), 'senior');
});

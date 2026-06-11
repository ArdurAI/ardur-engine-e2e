/**
 * E2E: @ardurai/contracts schema gate — assertCompatibleArtifact
 *
 * Verifies that every pipeline stage artifact produced by the deterministic
 * engines passes the Tier-1 gate, and that the gate correctly rejects
 * malformed or mismatched inputs.
 *
 * Asserts:
 *  1. All pipeline-produced artifacts pass assertCompatibleArtifact.
 *  2. Gate rejects wrong stage (hard fail, SchemaVersionError).
 *  3. Gate rejects wrong schemaVersion (hard fail).
 *  4. Gate rejects null / non-object inputs.
 *  5. Gate emits a warning (non-fatal) on forward contractRevision skew.
 *  6. All pipeline-produced artifacts carry contractRevision === 3.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assertCompatibleArtifact,
  SchemaVersionError,
  SCHEMA_VERSION,
  CONTRACT_REVISION,
} from '@ardurai/contracts';

import { runRanking } from '../../vendor/ardur-ranking-engine/src/index.ts';
import { selectTop10 } from '../../vendor/ardur-top10-engine/src/index.ts';
import { runSynthesis } from '../../vendor/ardur-article-synthesizer/src/index.ts';
import { GOLDEN_AGGREGATION } from '../fixtures/aggregation.ts';
import { FIXED_NOW } from '../fixtures/cycle.ts';

async function buildAll() {
  const ranking = runRanking(GOLDEN_AGGREGATION, { now: FIXED_NOW });
  const top10 = selectTop10(ranking, null, { aggregation: GOLDEN_AGGREGATION });
  const articles = await runSynthesis({ top10, aggregation: GOLDEN_AGGREGATION, maxGenerations: 0, now: FIXED_NOW });
  return { ranking, top10, articles };
}

// ---------------------------------------------------------------------------
// Valid artifacts pass the gate
// ---------------------------------------------------------------------------

test('schema-gate: AggregationArtifact passes gate', () => {
  const { envelope, warnings } = assertCompatibleArtifact(GOLDEN_AGGREGATION, 'aggregation');
  assert.ok(envelope, 'envelope should be returned');
  assert.equal(envelope.artifact, 'aggregation');
  assert.deepEqual(warnings, [], 'no warnings expected for current-revision artifact');
});

test('schema-gate: RankingArtifact passes gate', () => {
  const ranking = runRanking(GOLDEN_AGGREGATION, { now: FIXED_NOW });
  const { envelope } = assertCompatibleArtifact(ranking, 'ranking');
  assert.equal(envelope.artifact, 'ranking');
});

test('schema-gate: Top10Artifact passes gate', () => {
  const ranking = runRanking(GOLDEN_AGGREGATION, { now: FIXED_NOW });
  const top10 = selectTop10(ranking, null, { aggregation: GOLDEN_AGGREGATION });
  const { envelope } = assertCompatibleArtifact(top10, 'top10');
  assert.equal(envelope.artifact, 'top10');
});

test('schema-gate: ArticleArtifact passes gate', async () => {
  const { articles } = await buildAll();
  const { envelope } = assertCompatibleArtifact(articles, 'articles');
  assert.equal(envelope.artifact, 'articles');
});

// ---------------------------------------------------------------------------
// All artifacts carry contractRevision 3
// ---------------------------------------------------------------------------

test('schema-gate: all pipeline artifacts carry contractRevision === 3', async () => {
  const { ranking, top10, articles } = await buildAll();
  for (const [label, artifact] of [
    ['aggregation', GOLDEN_AGGREGATION],
    ['ranking', ranking],
    ['top10', top10],
    ['articles', articles],
  ] as const) {
    assert.equal(
      artifact.contractRevision,
      CONTRACT_REVISION,
      `${label} contractRevision should be ${CONTRACT_REVISION}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Hard failures
// ---------------------------------------------------------------------------

test('schema-gate: rejects wrong stage (articles artifact checked as aggregation)', () => {
  const ranking = runRanking(GOLDEN_AGGREGATION, { now: FIXED_NOW });
  assert.throws(
    () => assertCompatibleArtifact(ranking, 'aggregation'),
    SchemaVersionError,
    'Should throw SchemaVersionError on stage mismatch',
  );
});

test('schema-gate: rejects wrong schemaVersion', () => {
  const bad = { ...GOLDEN_AGGREGATION, schemaVersion: 'bad-version/v99' };
  assert.throws(
    () => assertCompatibleArtifact(bad, 'aggregation'),
    SchemaVersionError,
    'Should throw SchemaVersionError on bad schemaVersion',
  );
});

test('schema-gate: rejects null input', () => {
  assert.throws(
    () => assertCompatibleArtifact(null, 'aggregation'),
    SchemaVersionError,
    'Should throw SchemaVersionError for null input',
  );
});

test('schema-gate: rejects missing data field', () => {
  const bad = { schemaVersion: SCHEMA_VERSION, artifact: 'aggregation', data: null };
  assert.throws(
    () => assertCompatibleArtifact(bad, 'aggregation'),
    SchemaVersionError,
    'Should throw SchemaVersionError when data is null',
  );
});

// ---------------------------------------------------------------------------
// Non-fatal forward-compat warning
// ---------------------------------------------------------------------------

test('schema-gate: warns (non-fatal) on forward contractRevision skew', () => {
  const future = { ...GOLDEN_AGGREGATION, contractRevision: CONTRACT_REVISION + 1 };
  const { envelope, warnings } = assertCompatibleArtifact(future, 'aggregation');
  assert.ok(envelope, 'Should still return envelope despite forward revision');
  assert.ok(warnings.length > 0, 'Should emit a warning for forward contractRevision');
  assert.ok(
    warnings.some((w) => /revision/i.test(w) || /forward/i.test(w) || /contractRevision/i.test(w)),
    `Warning should mention revision skew: ${warnings.join('; ')}`,
  );
});

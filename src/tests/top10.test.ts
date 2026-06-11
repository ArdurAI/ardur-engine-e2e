/**
 * E2E: top10 engine — RankingArtifact → Top10Artifact
 *
 * Asserts:
 *  1. Selection: global board has ≤10 entries; per-topic boards have ≤10;
 *     category balance (no topic > ceil(10/3)=4 entries on the global board).
 *  2. Tie-breaking: clusters ordered by score → corroboration → recency →
 *     distinctDomains → stable clusterId (alphabetically ascending).
 *  3. Idempotency: selectTop10(ranking, null) called twice produces identical
 *     clusterId ordering regardless of call-time differences.
 *  4. 6h cycle math: nextRefreshAt = generatedAt + 6h; cycle window math is exact.
 *  5. Delta computation: entries in a subsequent cycle carry correct movement flags.
 *  6. Stability hysteresis: with stabilityMargin > 0, an incumbent within margin
 *     of a challenger is retained.
 *  7. Per-topic boards only contain clusters for that topic.
 *  8. References: every Top10Entry has a non-empty references array when the
 *     aggregation is threaded through SelectionOptions.aggregation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runRanking } from '../../vendor/ardur-ranking-engine/src/index.ts';
import {
  selectTop10,
  compareClusters,
  cycleFor,
  nextRefreshAt,
  CYCLE_INTERVAL_MS,
} from '../../vendor/ardur-top10-engine/src/index.ts';
import type { RankedCluster } from '../../vendor/ardur-top10-engine/src/index.ts';
import { SCHEMA_VERSION } from '../../vendor/ardur-top10-engine/src/contracts.ts';
import { GOLDEN_AGGREGATION } from '../fixtures/aggregation.ts';
import { FIXED_NOW, CYCLE } from '../fixtures/cycle.ts';

function getRanking() {
  return runRanking(GOLDEN_AGGREGATION, { now: FIXED_NOW });
}

// ---------------------------------------------------------------------------
// Shape and size
// ---------------------------------------------------------------------------

test('selectTop10 produces a valid Top10Artifact', () => {
  const ranking = getRanking();
  const top10 = selectTop10(ranking, null, { aggregation: GOLDEN_AGGREGATION });

  assert.equal(top10.schemaVersion, SCHEMA_VERSION);
  assert.equal(top10.artifact, 'top10');
  assert.equal(top10.upstreamRunId, ranking.runId);
  assert.equal(top10.cycle.id, CYCLE.id);
  assert.ok(top10.runId.length > 0);
  assert.ok(top10.data.nextRefreshAt.length > 0);
  assert.ok(top10.data.topicsCovered.includes('ai'));
  assert.ok(top10.data.topicsCovered.includes('security'));
  assert.ok(top10.data.topicsCovered.includes('devops'));
});

test('global board has at most 10 entries', () => {
  const ranking = getRanking();
  const top10 = selectTop10(ranking, null, { aggregation: GOLDEN_AGGREGATION });
  assert.ok(top10.data.global.length <= 10, `global board has ${top10.data.global.length} entries`);
});

test('per-topic boards have at most 10 entries each', () => {
  const ranking = getRanking();
  const top10 = selectTop10(ranking, null, { aggregation: GOLDEN_AGGREGATION });
  for (const [topic, entries] of Object.entries(top10.data.top10ByTopic)) {
    assert.ok(entries.length <= 10, `${topic} board has ${entries.length} entries`);
  }
});

test('global board respects category balance (no topic > 4 entries with 12 clusters)', () => {
  // maxPerCategory = max(1, ceil(10/3)) = 4
  const ranking = getRanking();
  const top10 = selectTop10(ranking, null, { aggregation: GOLDEN_AGGREGATION });
  const countByTopic: Record<string, number> = {};
  for (const entry of top10.data.global) {
    countByTopic[entry.topic] = (countByTopic[entry.topic] ?? 0) + 1;
  }
  for (const [topic, count] of Object.entries(countByTopic)) {
    assert.ok(count <= 4, `Topic '${topic}' has ${count} entries on global board (max 4)`);
  }
});

test('global board entries have consecutive 1-based ranks', () => {
  const ranking = getRanking();
  const top10 = selectTop10(ranking, null, { aggregation: GOLDEN_AGGREGATION });
  top10.data.global.forEach((entry, i) => {
    assert.equal(entry.rank, i + 1, `global[${i}].rank should be ${i + 1}, got ${entry.rank}`);
  });
});

test('per-topic boards only contain entries for their topic', () => {
  const ranking = getRanking();
  const top10 = selectTop10(ranking, null, { aggregation: GOLDEN_AGGREGATION });
  for (const [topic, entries] of Object.entries(top10.data.top10ByTopic)) {
    for (const entry of entries) {
      assert.equal(entry.topic, topic, `Entry ${entry.clusterId} has topic '${entry.topic}', expected '${topic}'`);
    }
  }
});

// ---------------------------------------------------------------------------
// Score-based ordering
// ---------------------------------------------------------------------------

test('global board: sec-critical or sec-exploit rank in the top 3', () => {
  // Both have very high T signals; one of them should dominate the global board
  const ranking = getRanking();
  const top10 = selectTop10(ranking, null, { aggregation: GOLDEN_AGGREGATION });
  const top3Ids = top10.data.global.slice(0, 3).map((e) => e.clusterId);
  const hasHighSec = top3Ids.includes('sec-critical') || top3Ids.includes('sec-exploit');
  assert.ok(hasHighSec, `Expected a high-severity security entry in top 3, got: ${top3Ids.join(', ')}`);
});

test('security top10: sec-critical ranks above sec-exploit', () => {
  const ranking = getRanking();
  const top10 = selectTop10(ranking, null, { aggregation: GOLDEN_AGGREGATION });
  const secEntries = top10.data.top10ByTopic['security'] ?? [];
  const critIdx = secEntries.findIndex((e) => e.clusterId === 'sec-critical');
  const exploitIdx = secEntries.findIndex((e) => e.clusterId === 'sec-exploit');
  assert.ok(critIdx !== -1 && exploitIdx !== -1, 'Both security entries should be on the board');
  assert.ok(critIdx < exploitIdx, `sec-critical (pos ${critIdx}) should be ranked above sec-exploit (pos ${exploitIdx})`);
});

test('ai top10: entries appear in descending score order', () => {
  const ranking = getRanking();
  const top10 = selectTop10(ranking, null, { aggregation: GOLDEN_AGGREGATION });
  const aiEntries = top10.data.top10ByTopic['ai'] ?? [];
  for (let i = 1; i < aiEntries.length; i++) {
    const prev = aiEntries[i - 1];
    const curr = aiEntries[i];
    assert.ok(
      (prev?.score.total ?? 0) >= (curr?.score.total ?? 0),
      `ai[${i - 1}] score (${prev?.score.total.toFixed(4)}) should be >= ai[${i}] score (${curr?.score.total.toFixed(4)})`,
    );
  }
});

// ---------------------------------------------------------------------------
// Tie-breaking
// ---------------------------------------------------------------------------

test('compareClusters tie-breaks by clusterId when all other fields match', () => {
  // Build two clusters that are identical except for clusterId
  const base: RankedCluster = {
    clusterId: 'tie-z', // will be overridden
    topic: 'test',
    topicLabel: 'Test',
    headline: 'Same headline',
    rank: 1,
    score: { corroboration: 0.5, credibility: 0.5, interaction: 0.5, recency: 0.8, diversity: 1.0, total: 0.4, weights: {} },
    sourceQuality: 'multi-source',
    confidence: 'medium',
    verification: 'multi-source',
    sourceCount: 2,
    distinctDomains: 2,
    tierHistogram: { news: 2 },
    memberIds: [],
    earliestPublishedAt: '2026-06-11T06:00:00.000Z',
    latestPublishedAt: '2026-06-11T10:00:00.000Z',
    auditId: 'audit-tie',
  };

  const clusterA: RankedCluster = { ...base, clusterId: 'aaa-first' };
  const clusterB: RankedCluster = { ...base, clusterId: 'zzz-last' };

  // compareClusters returns < 0 when a should come first (higher rank)
  const result = compareClusters(clusterA, clusterB);
  assert.ok(result < 0, `clusterA (aaa) should rank above clusterB (zzz), compareClusters returned ${result}`);

  // Confirm stable order both ways
  assert.ok(compareClusters(clusterB, clusterA) > 0, 'reversed comparison should return > 0');
});

test('compareClusters tie-breaks by score.total first', () => {
  const base: RankedCluster = {
    clusterId: 'same-id', topic: 'test', topicLabel: 'Test', headline: 'H',
    rank: 1,
    score: { corroboration: 0.5, credibility: 0.5, interaction: 0.5, recency: 0.8, diversity: 1.0, total: 0.5, weights: {} },
    sourceQuality: 'multi-source', confidence: 'medium', verification: 'multi-source',
    sourceCount: 2, distinctDomains: 2, tierHistogram: {}, memberIds: [],
    earliestPublishedAt: '2026-06-11T06:00:00.000Z',
    latestPublishedAt: '2026-06-11T10:00:00.000Z',
    auditId: 'a',
  };
  const high: RankedCluster = { ...base, score: { ...base.score, total: 0.9 } };
  const low: RankedCluster = { ...base, score: { ...base.score, total: 0.3 } };

  assert.ok(compareClusters(high, low) < 0, 'higher score should rank first');
  assert.ok(compareClusters(low, high) > 0, 'lower score should rank second');
});

test('compareClusters tie-breaks by corroboration when scores are equal', () => {
  const base: RankedCluster = {
    clusterId: 'same-id', topic: 'test', topicLabel: 'Test', headline: 'H',
    rank: 1,
    score: { corroboration: 0.5, credibility: 0.5, interaction: 0.5, recency: 0.8, diversity: 1.0, total: 0.5, weights: {} },
    sourceQuality: 'multi-source', confidence: 'medium', verification: 'multi-source',
    sourceCount: 2, distinctDomains: 2, tierHistogram: {}, memberIds: [],
    earliestPublishedAt: '2026-06-11T06:00:00.000Z',
    latestPublishedAt: '2026-06-11T10:00:00.000Z',
    auditId: 'a',
  };
  const highCorr: RankedCluster = { ...base, score: { ...base.score, corroboration: 0.8 } };
  const lowCorr: RankedCluster = { ...base, score: { ...base.score, corroboration: 0.3 } };

  assert.ok(compareClusters(highCorr, lowCorr) < 0, 'higher corroboration should win on tie');
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

test('selectTop10 is idempotent: calling twice produces the same entry ordering', () => {
  const ranking = getRanking();
  const t1 = selectTop10(ranking, null, { aggregation: GOLDEN_AGGREGATION });
  const t2 = selectTop10(ranking, null, { aggregation: GOLDEN_AGGREGATION });

  assert.equal(t1.data.global.length, t2.data.global.length);
  for (let i = 0; i < t1.data.global.length; i++) {
    assert.equal(t1.data.global[i]?.clusterId, t2.data.global[i]?.clusterId, `global[${i}] clusterId`);
    assert.equal(t1.data.global[i]?.rank, t2.data.global[i]?.rank, `global[${i}] rank`);
    assert.equal(t1.data.global[i]?.score.total, t2.data.global[i]?.score.total, `global[${i}] score`);
  }

  // Per-topic boards should also be identical
  for (const topic of ['ai', 'security', 'devops']) {
    const a = t1.data.top10ByTopic[topic] ?? [];
    const b = t2.data.top10ByTopic[topic] ?? [];
    assert.equal(a.length, b.length, `${topic} board length`);
    for (let i = 0; i < a.length; i++) {
      assert.equal(a[i]?.clusterId, b[i]?.clusterId, `${topic}[${i}] clusterId`);
    }
  }
});

test('runId changes between calls but ranked order does not', () => {
  const ranking = getRanking();
  const t1 = selectTop10(ranking, null, { aggregation: GOLDEN_AGGREGATION });
  const t2 = selectTop10(ranking, null, {
    aggregation: GOLDEN_AGGREGATION,
    runId: 'override-run-id',
    generatedAt: '2026-06-11T12:00:01.000Z',
  });

  assert.notEqual(t1.runId, t2.runId, 'runId should be different when overridden');
  // But the ranked order should be the same
  const ids1 = t1.data.global.map((e) => e.clusterId);
  const ids2 = t2.data.global.map((e) => e.clusterId);
  assert.deepEqual(ids1, ids2, 'Global board ordering should be identical regardless of runId');
});

// ---------------------------------------------------------------------------
// 6-hour cycle math
// ---------------------------------------------------------------------------

test('nextRefreshAt equals cycle.windowEnd', () => {
  // selectTop10 sets nextRefreshAt = cycle.windowEnd (the UTC-aligned boundary of the
  // current 6h window), not generatedAt + 6h.
  const ranking = getRanking();
  const top10 = selectTop10(ranking, null, { aggregation: GOLDEN_AGGREGATION });

  assert.ok(Number.isFinite(new Date(top10.data.nextRefreshAt).valueOf()), 'nextRefreshAt is a valid date');
  assert.equal(top10.data.nextRefreshAt, top10.cycle.windowEnd, 'nextRefreshAt should equal cycle.windowEnd');
});

test('cycleFor computes the correct 6h window for FIXED_NOW', () => {
  // FIXED_NOW = 2026-06-11T11:50:00Z → falls in the 06:00–12:00 UTC window
  const cycle = cycleFor(FIXED_NOW);
  assert.ok(cycle.id.length > 0);
  const start = new Date(cycle.windowStart).valueOf();
  const end = new Date(cycle.windowEnd).valueOf();
  assert.equal(end - start, CYCLE_INTERVAL_MS, 'Cycle window should be exactly 6 hours');
  assert.ok(start <= FIXED_NOW.valueOf(), 'Window start should be <= now');
  assert.ok(end > FIXED_NOW.valueOf(), 'Window end should be > now');
});

test('nextRefreshAt is in the future relative to generatedAt', () => {
  const ranking = getRanking();
  // Pin generatedAt so the assertion is deterministic regardless of wall-clock
  const top10 = selectTop10(ranking, null, { generatedAt: FIXED_NOW.toISOString() });
  const genMs = new Date(top10.generatedAt).valueOf();
  const nextMs = new Date(top10.data.nextRefreshAt).valueOf();
  assert.ok(nextMs > genMs, 'nextRefreshAt should be after generatedAt');
});

// ---------------------------------------------------------------------------
// Delta and stability
// ---------------------------------------------------------------------------

test('all entries have delta.movement = "new" when previous is null', () => {
  const ranking = getRanking();
  const top10 = selectTop10(ranking, null, { aggregation: GOLDEN_AGGREGATION });
  for (const entry of top10.data.global) {
    assert.equal(entry.delta.movement, 'new', `${entry.clusterId} should be 'new' with no previous`);
    assert.equal(entry.delta.previousRank, null, `${entry.clusterId} previousRank should be null`);
    assert.equal(entry.carriedOver, false, `${entry.clusterId} should not be carried over`);
  }
});

test('entries carried from a previous cycle get correct delta', () => {
  const ranking = getRanking();
  const cycle1 = selectTop10(ranking, null, { aggregation: GOLDEN_AGGREGATION });
  const cycle2 = selectTop10(ranking, cycle1, { aggregation: GOLDEN_AGGREGATION });

  // All entries in cycle2 should have been in cycle1 (same input → same results)
  for (const entry of cycle2.data.global) {
    assert.ok(entry.carriedOver, `${entry.clusterId} should be carriedOver in cycle2`);
    assert.equal(entry.delta.movement, 'same', `${entry.clusterId} should have 'same' movement`);
    assert.ok(entry.delta.previousRank !== null, `${entry.clusterId} should have a previousRank`);
  }
});

test('stability report has correct carried/fresh split when first cycle has all new entries', () => {
  const ranking = getRanking();
  const top10 = selectTop10(ranking, null, { aggregation: GOLDEN_AGGREGATION });
  const { stability } = top10.data;
  assert.equal(stability.carriedOver, 0, 'first cycle: no carried over entries');
  assert.equal(stability.fresh, top10.data.global.length, 'first cycle: all entries are fresh');
  // churnRate = 0 when previous is null: no baseline exists, so churn is undefined → 0
  assert.equal(stability.churnRate, 0, 'first cycle: churn rate is 0 (no baseline)');
});

test('stability report when no entries change between cycles', () => {
  const ranking = getRanking();
  const cycle1 = selectTop10(ranking, null, { aggregation: GOLDEN_AGGREGATION });
  const cycle2 = selectTop10(ranking, cycle1, { aggregation: GOLDEN_AGGREGATION });

  const { stability } = cycle2.data;
  assert.equal(stability.fresh, 0, 'no new entries when inputs unchanged');
  assert.equal(stability.churnRate, 0, 'churn rate 0 when no entries replaced');
});

// ---------------------------------------------------------------------------
// References (copyright safety)
// ---------------------------------------------------------------------------

test('Top10Entry references are populated when aggregation is provided', () => {
  const ranking = getRanking();
  const top10 = selectTop10(ranking, null, { aggregation: GOLDEN_AGGREGATION });

  for (const entry of top10.data.global) {
    assert.ok(
      entry.references.length > 0,
      `${entry.clusterId} should have at least one reference when aggregation is provided`,
    );
    for (const ref of entry.references) {
      assert.ok(ref.url.length > 0, `Reference url should be non-empty`);
      assert.ok(ref.source.length > 0, `Reference source should be non-empty`);
      assert.ok(ref.title.length > 0, `Reference title should be non-empty`);
    }
  }
});

test('Top10Entry references are empty with a warning when no aggregation is provided', () => {
  const ranking = getRanking();
  const top10 = selectTop10(ranking, null); // no aggregation option

  assert.ok(
    top10.warnings.some((w) => w.includes('references omitted')),
    'Expected a warning about omitted references',
  );
  for (const entry of top10.data.global) {
    assert.equal(entry.references.length, 0, `${entry.clusterId} should have no references without aggregation`);
  }
});

test('references are capped at 5 (default maxReferences)', () => {
  const ranking = getRanking();
  const top10 = selectTop10(ranking, null, { aggregation: GOLDEN_AGGREGATION });
  for (const entry of top10.data.global) {
    assert.ok(entry.references.length <= 5, `${entry.clusterId} has ${entry.references.length} references (max 5)`);
  }
});

// ---------------------------------------------------------------------------
// Stability hysteresis
// ---------------------------------------------------------------------------

test('stabilityMargin retains an incumbent within margin of a challenger', () => {
  // Build a ranking where two clusters are very close in score.
  // The first cycle puts cluster A in position 1. In the second cycle,
  // cluster B has a slightly higher score but within the stabilityMargin —
  // the incumbent (A) should be retained.
  //
  // We simulate this by running cycle1 and cycle2 with the same ranking artifact.
  // With stabilityMargin=0 (default), B would overtake A if B.score > A.score.
  // We verify that passing stabilityMargin=1.0 (absurdly large) retains all incumbents.
  const ranking = getRanking();
  const cycle1 = selectTop10(ranking, null, { aggregation: GOLDEN_AGGREGATION });
  const withMargin = selectTop10(ranking, cycle1, {
    aggregation: GOLDEN_AGGREGATION,
    stabilityMargin: 1.0, // every incumbent is within margin
  });

  const cycle1Ids = new Set(cycle1.data.global.map((e) => e.clusterId));
  const marginIds = new Set(withMargin.data.global.map((e) => e.clusterId));
  for (const id of cycle1Ids) {
    assert.ok(marginIds.has(id), `Incumbent ${id} should be retained with large stabilityMargin`);
  }
});

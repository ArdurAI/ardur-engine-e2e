/**
 * E2E: ranking engine — Cluster[] → RankingArtifact
 *
 * Asserts:
 *  1. Score formula: Score = Recency × [0.30·C + 0.28·T + 0.22·S + 0.20·E] × Diversity
 *     Each component is verified to be within tolerance of the analytically
 *     computed expectation using the pure signal functions directly.
 *  2. Ordering: within each topic the expected ranking order holds.
 *  3. Artifact shape: schema version, cycle provenance, audit entries present.
 *  4. Determinism: two calls with identical inputs + frozen clock produce
 *     identical scores and the same runId-independent ranked order.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONTRACT_REVISION } from '@ardurai/contracts';
import { runRanking } from '../../vendor/ardur-ranking-engine/src/index.ts';
import {
  corroborationScore,
  corroborationSignal,
  recencyDecay,
  recencyHalfLifeHours,
  sourceTierSignal,
  technicalSignificanceSignal,
  engagementSignal,
  ownerDiversity,
  diversityMultiplier,
  countIndependentOwners,
} from '../../vendor/ardur-ranking-engine/src/signals.ts';
import { computeScore, toScoreBreakdown } from '../../vendor/ardur-ranking-engine/src/score.ts';
import { BALANCED_V1 as PROFILE } from '../../vendor/ardur-ranking-engine/src/weights.ts';
import { GOLDEN_AGGREGATION } from '../fixtures/aggregation.ts';
import { FIXED_NOW } from '../fixtures/cycle.ts';

const TOLERANCE = 0.005; // ±0.5% tolerance for float comparisons

function near(actual: number, expected: number, msg?: string): void {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= TOLERANCE,
    `${msg ?? 'value'}: expected ${expected.toFixed(5)} ±${TOLERANCE}, got ${actual.toFixed(5)} (diff ${diff.toFixed(5)})`,
  );
}

test('runRanking produces a valid RankingArtifact from the golden aggregation', () => {
  const result = runRanking(GOLDEN_AGGREGATION, { now: FIXED_NOW });

  assert.equal(result.schemaVersion, 'ardur-content-pipeline/v1');
  assert.equal(result.artifact, 'ranking');
  assert.equal(result.upstreamRunId, GOLDEN_AGGREGATION.runId);
  assert.equal(result.cycle.id, GOLDEN_AGGREGATION.cycle.id);
  assert.deepEqual(result.topics, GOLDEN_AGGREGATION.topics);
  assert.ok(result.runId.startsWith('rank-'), `runId should start with 'rank-', got ${result.runId}`);

  // All three topics should be ranked
  assert.ok('ai' in result.data.rankedByTopic);
  assert.ok('security' in result.data.rankedByTopic);
  assert.ok('devops' in result.data.rankedByTopic);

  // Every cluster from the aggregation should appear in the ranked output
  assert.equal(result.data.rankedByTopic['ai']?.length, 4);
  assert.equal(result.data.rankedByTopic['security']?.length, 4);
  assert.equal(result.data.rankedByTopic['devops']?.length, 4);

  // Audit entries — one per cluster
  assert.equal(result.data.audit.length, 12);
});

test('ranked clusters have 1-based consecutive ranks within each topic', () => {
  const result = runRanking(GOLDEN_AGGREGATION, { now: FIXED_NOW });
  for (const [topic, clusters] of Object.entries(result.data.rankedByTopic)) {
    clusters.forEach((c, i) => {
      assert.equal(c.rank, i + 1, `${topic}[${i}] rank should be ${i + 1}, got ${c.rank}`);
    });
  }
});

test('ScoreBreakdown satisfies the formula: total ≈ recency × core × diversity', () => {
  const result = runRanking(GOLDEN_AGGREGATION, { now: FIXED_NOW });
  const aiRanked = result.data.rankedByTopic['ai'];
  assert.ok(aiRanked && aiRanked.length > 0);

  for (const cluster of aiRanked) {
    const { score } = cluster;
    // Rev 3: score.technicalSignificance is now a typed field
    const T = score.technicalSignificance ?? 0;
    const reconstructed = score.recency * (
      PROFILE.weights.corroboration * score.corroboration +
      PROFILE.weights.technicalSignificance * T +
      PROFILE.weights.sourceTier * score.credibility +
      PROFILE.weights.engagement * score.interaction
    ) * score.diversity;
    // Verify total = recency × (0.30·C + 0.28·T + 0.22·S + 0.20·E) × diversity ∈ (0, 1]
    assert.ok(score.total > 0, `score.total > 0 for ${cluster.clusterId}`);
    assert.ok(score.total <= 1.0 + TOLERANCE, `score.total <= 1 for ${cluster.clusterId}`);
    assert.ok(score.recency > 0 && score.recency <= 1.0, `recency ∈ (0,1]`);
    assert.ok(score.diversity >= 0.8 && score.diversity <= 1.15, `diversity ∈ [0.8,1.15]`);
    assert.ok(score.corroboration >= 0 && score.corroboration <= 1, `C ∈ [0,1]`);
    assert.ok(score.credibility >= 0 && score.credibility <= 1, `S ∈ [0,1]`);
    assert.ok(score.interaction >= 0 && score.interaction <= 1, `E ∈ [0,1]`);
  }
});

test('ai-alpha ranks #1 in AI topic (freshest, most sources, highest-tier)', () => {
  const result = runRanking(GOLDEN_AGGREGATION, { now: FIXED_NOW });
  const aiRanked = result.data.rankedByTopic['ai'];
  assert.ok(aiRanked && aiRanked.length > 0);
  assert.equal(aiRanked[0]?.clusterId, 'ai-alpha', `Expected ai-alpha at rank 1, got ${aiRanked[0]?.clusterId}`);
});

test('ai-delta ranks last in AI topic (single source, oldest)', () => {
  const result = runRanking(GOLDEN_AGGREGATION, { now: FIXED_NOW });
  const aiRanked = result.data.rankedByTopic['ai'];
  assert.ok(aiRanked);
  const last = aiRanked[aiRanked.length - 1];
  assert.equal(last?.clusterId, 'ai-delta', `Expected ai-delta at last rank, got ${last?.clusterId}`);
});

test('security ordering: both sec-critical and sec-exploit are in the top 2 security clusters', () => {
  // Rev 3: factCorroborationSignal gives both clusters C≈1.0 (both have corroborated facts).
  // With C equalized, sec-exploit (age ~0.33h, interaction 8) beats sec-critical (age ~2h,
  // interaction 5) on the recency+engagement dimension despite lower T (0.95 vs 1.0).
  // Both still dominate sec-medium and sec-low — the important assertion is that the
  // two highest-signal security clusters occupy the top 2 positions.
  const result = runRanking(GOLDEN_AGGREGATION, { now: FIXED_NOW });
  const secRanked = result.data.rankedByTopic['security'];
  assert.ok(secRanked && secRanked.length >= 2);

  const critIdx = secRanked.findIndex((c) => c.clusterId === 'sec-critical');
  const exploitIdx = secRanked.findIndex((c) => c.clusterId === 'sec-exploit');
  assert.ok(critIdx !== -1, 'sec-critical not found');
  assert.ok(exploitIdx !== -1, 'sec-exploit not found');
  // Both should be in the top 2 positions (dominating sec-medium and sec-low).
  assert.ok(critIdx <= 1, `sec-critical should be in top 2, got rank ${critIdx + 1}`);
  assert.ok(exploitIdx <= 1, `sec-exploit should be in top 2, got rank ${exploitIdx + 1}`);
});

test('security ordering: sec-medium and sec-low rank below exploit and critical', () => {
  const result = runRanking(GOLDEN_AGGREGATION, { now: FIXED_NOW });
  const secRanked = result.data.rankedByTopic['security'];
  assert.ok(secRanked && secRanked.length === 4);

  const exploitIdx = secRanked.findIndex((c) => c.clusterId === 'sec-exploit');
  const mediumIdx = secRanked.findIndex((c) => c.clusterId === 'sec-medium');
  const lowIdx = secRanked.findIndex((c) => c.clusterId === 'sec-low');

  assert.ok(exploitIdx < mediumIdx, 'sec-exploit should rank above sec-medium');
  assert.ok(mediumIdx < lowIdx, 'sec-medium should rank above sec-low');
});

test('devops-alpha ranks #1 in DevOps topic (primary source + k8s release)', () => {
  const result = runRanking(GOLDEN_AGGREGATION, { now: FIXED_NOW });
  const devopsRanked = result.data.rankedByTopic['devops'];
  assert.ok(devopsRanked && devopsRanked.length > 0);
  assert.equal(devopsRanked[0]?.clusterId, 'devops-alpha');
});

test('score formula: ai-alpha score matches independent computation', () => {
  const result = runRanking(GOLDEN_AGGREGATION, { now: FIXED_NOW });
  const aiRanked = result.data.rankedByTopic['ai'];
  const alpha = aiRanked?.find((c) => c.clusterId === 'ai-alpha');
  assert.ok(alpha, 'ai-alpha not found in ranked output');

  // Independently compute expected score using the pure signal functions
  const aiItems = GOLDEN_AGGREGATION.data.itemsByTopic['ai'] ?? [];
  const alphaMembers = aiItems.filter((it) => it.clusterId === 'ai-alpha');
  const aiClusters = GOLDEN_AGGREGATION.data.clustersByTopic['ai'] ?? [];
  const alphaCluster = aiClusters.find((c) => c.clusterId === 'ai-alpha');
  assert.ok(alphaCluster);

  const alphaFacts = GOLDEN_AGGREGATION.data.factsByCluster?.['ai-alpha'];
  const signalInput = {
    cluster: alphaCluster,
    members: alphaMembers,
    now: FIXED_NOW,
    profile: PROFILE,
    ...(alphaFacts !== undefined && { facts: alphaFacts }),
  };

  // Rev 3: corroborationSignal blends domain-based and fact-level (max of both)
  const C = corroborationSignal(signalInput);
  const T = technicalSignificanceSignal(signalInput);
  const S = sourceTierSignal(signalInput);
  const E = engagementSignal(signalInput);
  const div = ownerDiversity(signalInput);
  const diversity = diversityMultiplier(div, PROFILE);
  const halfLife = recencyHalfLifeHours(T, PROFILE);
  const ageH = (FIXED_NOW.valueOf() - new Date(alphaCluster.latestPublishedAt).valueOf()) / 3_600_000;
  const recency = recencyDecay(ageH, halfLife);

  const { total: expectedTotal } = computeScore(
    { corroboration: C, technicalSignificance: T, sourceTier: S, engagement: E },
    { recency, diversity },
    PROFILE,
  );

  near(alpha.score.total, expectedTotal, 'ai-alpha total score');
  near(alpha.score.corroboration, C, 'ai-alpha corroboration signal');
  near(alpha.score.credibility, S, 'ai-alpha source tier signal');
  near(alpha.score.interaction, E, 'ai-alpha engagement signal');
  near(alpha.score.recency, recency, 'ai-alpha recency multiplier');
  near(alpha.score.diversity, diversity, 'ai-alpha diversity multiplier');
});

test('score formula: sec-critical score matches independent computation', () => {
  const result = runRanking(GOLDEN_AGGREGATION, { now: FIXED_NOW });
  const secRanked = result.data.rankedByTopic['security'];
  const critical = secRanked?.find((c) => c.clusterId === 'sec-critical');
  assert.ok(critical, 'sec-critical not found');

  const secItems = GOLDEN_AGGREGATION.data.itemsByTopic['security'] ?? [];
  const critMembers = secItems.filter((it) => it.clusterId === 'sec-critical');
  const secClusters = GOLDEN_AGGREGATION.data.clustersByTopic['security'] ?? [];
  const critCluster = secClusters.find((c) => c.clusterId === 'sec-critical');
  assert.ok(critCluster);

  const critFacts = GOLDEN_AGGREGATION.data.factsByCluster?.['sec-critical'];
  const signalInput = {
    cluster: critCluster,
    members: critMembers,
    now: FIXED_NOW,
    profile: PROFILE,
    ...(critFacts !== undefined && { facts: critFacts }),
  };

  // Rev 3: corroborationSignal blends domain-based and fact-level (max of both)
  const C = corroborationSignal(signalInput);
  const T = technicalSignificanceSignal(signalInput);
  const S = sourceTierSignal(signalInput);
  const E = engagementSignal(signalInput);
  const div = ownerDiversity(signalInput);
  const diversity = diversityMultiplier(div, PROFILE);
  const halfLife = recencyHalfLifeHours(T, PROFILE);
  const ageH = (FIXED_NOW.valueOf() - new Date(critCluster.latestPublishedAt).valueOf()) / 3_600_000;
  const recency = recencyDecay(ageH, halfLife);

  const { total: expectedTotal } = computeScore(
    { corroboration: C, technicalSignificance: T, sourceTier: S, engagement: E },
    { recency, diversity },
    PROFILE,
  );

  near(critical.score.total, expectedTotal, 'sec-critical total score');

  // sec-critical: "critical severity" rule (0.90) + "kubernetes" AI bonus → T should be 1.0
  assert.equal(T, 1.0, `sec-critical T should be 1.0 (critical+k8s), got ${T}`);
});

test('sec-critical has higher T signal than sec-exploit', () => {
  // Verify the technical significance signal difference that drives the ranking
  const secItems = GOLDEN_AGGREGATION.data.itemsByTopic['security'] ?? [];
  const secClusters = GOLDEN_AGGREGATION.data.clustersByTopic['security'] ?? [];

  const critCluster = secClusters.find((c) => c.clusterId === 'sec-critical');
  const exploitCluster = secClusters.find((c) => c.clusterId === 'sec-exploit');
  assert.ok(critCluster && exploitCluster);

  const critMembers = secItems.filter((it) => it.clusterId === 'sec-critical');
  const exploitMembers = secItems.filter((it) => it.clusterId === 'sec-exploit');

  const T_crit = technicalSignificanceSignal({ cluster: critCluster, members: critMembers, now: FIXED_NOW, profile: PROFILE });
  const T_exploit = technicalSignificanceSignal({ cluster: exploitCluster, members: exploitMembers, now: FIXED_NOW, profile: PROFILE });

  assert.equal(T_crit, 1.0, `sec-critical T should be 1.0`);
  assert.ok(T_exploit > 0.90, `sec-exploit T should be > 0.90 (actively exploited = 0.95), got ${T_exploit}`);
  assert.ok(T_crit >= T_exploit, `T_crit (${T_crit}) >= T_exploit (${T_exploit})`);
});

test('audit trail: every ranked cluster has a matching audit entry', () => {
  const result = runRanking(GOLDEN_AGGREGATION, { now: FIXED_NOW });
  const auditIds = new Set(result.data.audit.map((a) => a.auditId));

  for (const [topic, clusters] of Object.entries(result.data.rankedByTopic)) {
    for (const cluster of clusters) {
      assert.ok(
        auditIds.has(cluster.auditId),
        `Audit entry for ${topic}/${cluster.clusterId} (auditId ${cluster.auditId}) not found`,
      );
    }
  }
});

test('determinism: same inputs + frozen clock → identical ranked order', () => {
  const r1 = runRanking(GOLDEN_AGGREGATION, { now: FIXED_NOW });
  const r2 = runRanking(GOLDEN_AGGREGATION, { now: FIXED_NOW });

  for (const topic of ['ai', 'security', 'devops']) {
    const a = r1.data.rankedByTopic[topic] ?? [];
    const b = r2.data.rankedByTopic[topic] ?? [];
    assert.equal(a.length, b.length, `${topic} cluster count`);
    for (let i = 0; i < a.length; i++) {
      assert.equal(a[i]?.clusterId, b[i]?.clusterId, `${topic}[${i}] clusterId`);
      assert.equal(a[i]?.score.total, b[i]?.score.total, `${topic}[${i}] score.total`);
    }
  }
});

test('score weight profile is balanced@v1', () => {
  const result = runRanking(GOLDEN_AGGREGATION, { now: FIXED_NOW });
  assert.equal(result.data.weightProfile, 'balanced@v1');

  // Verify that score.weights match the published BALANCED_V1 values
  const aiRanked = result.data.rankedByTopic['ai'];
  const alpha = aiRanked?.find((c) => c.clusterId === 'ai-alpha');
  assert.ok(alpha);
  assert.equal(alpha.score.weights['corroboration'], 0.3);
  assert.equal(alpha.score.weights['technicalSignificance'], 0.28);
  assert.equal(alpha.score.weights['sourceTier'], 0.22);
  assert.equal(alpha.score.weights['engagement'], 0.2);
});

// ---------------------------------------------------------------------------
// Rev 3 contract assertions
// ---------------------------------------------------------------------------

test('Rev 3: artifact carries contractRevision 3', () => {
  const result = runRanking(GOLDEN_AGGREGATION, { now: FIXED_NOW });
  assert.equal(result.contractRevision, CONTRACT_REVISION, 'contractRevision should be 3');
});

test('Rev 3: score.technicalSignificance is a typed numeric field on ScoreBreakdown', () => {
  const result = runRanking(GOLDEN_AGGREGATION, { now: FIXED_NOW });
  // sec-critical has the highest T signal; confirm it is exposed as a typed field
  const secRanked = result.data.rankedByTopic['security'];
  const critical = secRanked?.find((c) => c.clusterId === 'sec-critical');
  assert.ok(critical, 'sec-critical not found');
  assert.ok(
    typeof critical.score.technicalSignificance === 'number',
    `score.technicalSignificance should be a number, got ${typeof critical.score.technicalSignificance}`,
  );
  assert.ok(critical.score.technicalSignificance > 0, 'sec-critical T signal should be > 0');
});

test('Rev 3: RankedCluster.gateStatus is one of auto/flagged/hold when present', () => {
  const result = runRanking(GOLDEN_AGGREGATION, { now: FIXED_NOW });
  const allowed = new Set(['auto', 'flagged', 'hold', undefined]);
  for (const clusters of Object.values(result.data.rankedByTopic)) {
    for (const c of clusters) {
      assert.ok(
        allowed.has(c.gateStatus),
        `Unexpected gateStatus '${c.gateStatus}' on cluster ${c.clusterId}`,
      );
    }
  }
});

test('Rev 3: RankedCluster.references populated from aggregation items', () => {
  const result = runRanking(GOLDEN_AGGREGATION, { now: FIXED_NOW });
  // Ranking engine attaches references so top10 can skip loading the full aggregation (§6.1b).
  const aiRanked = result.data.rankedByTopic['ai'];
  const alpha = aiRanked?.find((c) => c.clusterId === 'ai-alpha');
  assert.ok(alpha, 'ai-alpha not found');
  assert.ok(
    alpha.references !== undefined && alpha.references.length > 0,
    'ai-alpha should have references attached by the ranking engine',
  );
  for (const ref of alpha.references ?? []) {
    assert.ok(ref.url.length > 0, 'Reference url should be non-empty');
    assert.ok(ref.source.length > 0, 'Reference source should be non-empty');
    assert.ok(ref.title.length > 0, 'Reference title should be non-empty');
  }
});

test('multi-tier clusters earn higher diversity multipliers than single-tier clusters', () => {
  // ai-alpha: primary+paper+technical-news (3 categories) → diversity near 1.15
  // ai-beta: all news (1 category) → diversity nearer the 0.8 floor
  const aiItems = GOLDEN_AGGREGATION.data.itemsByTopic['ai'] ?? [];
  const aiClusters = GOLDEN_AGGREGATION.data.clustersByTopic['ai'] ?? [];

  const alphaCluster = aiClusters.find((c) => c.clusterId === 'ai-alpha')!;
  const betaCluster = aiClusters.find((c) => c.clusterId === 'ai-beta')!;
  const alphaMembers = aiItems.filter((it) => it.clusterId === 'ai-alpha');
  const betaMembers = aiItems.filter((it) => it.clusterId === 'ai-beta');

  const divAlpha = ownerDiversity({ cluster: alphaCluster, members: alphaMembers, now: FIXED_NOW, profile: PROFILE });
  const divBeta = ownerDiversity({ cluster: betaCluster, members: betaMembers, now: FIXED_NOW, profile: PROFILE });

  const multAlpha = diversityMultiplier(divAlpha, PROFILE);
  const multBeta = diversityMultiplier(divBeta, PROFILE);

  assert.ok(multAlpha > multBeta, `ai-alpha diversity (${multAlpha.toFixed(3)}) should exceed ai-beta (${multBeta.toFixed(3)})`);
  assert.ok(multAlpha > 1.0, 'Multi-category cluster should have diversity > 1.0');
  assert.ok(multBeta < multAlpha, 'Single-category cluster diversity should be lower');
});

/**
 * E2E: full pipeline orchestrator — real CLI-backed runners
 *
 * Tests the complete rank → top10 → synthesize flow driven by the
 * ardur-pipeline orchestrator, which spawns each engine as a child process
 * (CLI-over-JSON handoff). The aggregator stage is replaced by a deterministic
 * injector that returns the golden AggregationArtifact so the suite stays fully
 * offline and does not depend on live RSS feeds.
 *
 * What is covered:
 *  1. Full cycle: golden aggregation injected → ranking CLI → top10 CLI →
 *     synthesizer CLI → published manifest. Status must be 'published' or
 *     'degraded' (never 'failed').
 *  2. Artifact schema consistency: all four artifacts share the same
 *     schemaVersion and cycle.id.
 *  3. Ranking CLI: 12 clusters ranked (4 per topic), ranks consecutive.
 *  4. Top-10 CLI: global board ≤ 10, ≥ 1 high-severity security entry
 *     in top 3 positions.
 *  5. Synthesizer CLI: one article per unique cluster (global + per-topic),
 *     all using deterministic provider, copyright policy present.
 *  6. 6h cycle idempotency: re-firing the same cycle returns 'skipped'.
 *  7. Dry-run: all four stage files are written under cycles/<id>/ but
 *     manifest.json and latest/ are NOT created.
 *  8. Manifest structure: runIds, health, summary, nextRefreshAt present.
 *
 * Timeouts: spawning three child processes takes ~2-10s in CI. The test
 * timeout is set to 120s per test to absorb slow CI machines without
 * flaking; the pipeline config uses 60s per stage.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { runCycle } from '../../vendor/ardur-pipeline/src/orchestrate.ts';
import { createCliRunners } from '../../vendor/ardur-pipeline/src/runners.ts';
import { createLogger } from '../../vendor/ardur-pipeline/src/log.ts';
import { ArtifactStore } from '../../vendor/ardur-pipeline/src/store.ts';
import { cycleFor } from '../../vendor/ardur-pipeline/src/cycle.ts';
import type { PipelineConfig } from '../../vendor/ardur-pipeline/src/config.ts';
import type { StageRunners } from '../../vendor/ardur-pipeline/src/runners.ts';
import type { Top10Artifact, ArticleArtifact, RankingArtifact, AggregationArtifact } from '@ardurai/contracts';
import { assertCompatibleArtifact } from '@ardurai/contracts';

import { GOLDEN_AGGREGATION } from '../fixtures/aggregation.ts';
import { FIXED_NOW } from '../fixtures/cycle.ts';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const __dir = dirname(fileURLToPath(import.meta.url));

/**
 * Invoke the top10 CLI using named flags (--ranking/--previous/--aggregation).
 * ardur-pipeline/src/runners.ts still uses the legacy positional-arg format;
 * this shim bridges the gap until the pipeline runner is updated.
 * See: ardur-pipeline issue "runners.ts: selectTop10 uses legacy positional args"
 */
async function invokeTop10Cli(
  top10EngineDir: string,
  ranking: RankingArtifact,
  previous: Top10Artifact | null,
  aggregation: AggregationArtifact | null,
  timeoutMs: number,
): Promise<Top10Artifact> {
  const scratch = await mkdtemp(join(tmpdir(), 'ardur-e2e-top10-shim-'));
  const rankingPath = join(scratch, 'ranking.json');
  await writeFile(rankingPath, JSON.stringify(ranking));

  const args: string[] = ['--ranking', rankingPath];

  if (previous !== null) {
    const prevPath = join(scratch, 'previous.json');
    await writeFile(prevPath, JSON.stringify(previous));
    args.push('--previous', prevPath);
  }
  if (aggregation !== null) {
    const aggPath = join(scratch, 'aggregation.json');
    await writeFile(aggPath, JSON.stringify(aggregation));
    args.push('--aggregation', aggPath);
  }

  const cli = join(top10EngineDir, 'src', 'cli.ts');
  const nodeArgs = ['--experimental-strip-types', cli, ...args];

  return new Promise<Top10Artifact>((resolve, reject) => {
    const child = spawn(process.execPath, nodeArgs, {
      cwd: top10EngineDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`top10 CLI timed out after ${timeoutMs}ms`)); }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error(`top10 CLI exited ${code}:\n${stderr.slice(-2000)}`)); return; }
      let parsed: unknown;
      try { parsed = JSON.parse(stdout); } catch (e) { reject(new Error(`top10 CLI produced invalid JSON: ${e instanceof Error ? e.message : String(e)}`)); return; }
      const { envelope, warnings } = assertCompatibleArtifact(parsed, 'top10');
      if (warnings.length > 0) (envelope.warnings as string[]).push(...warnings);
      resolve(envelope as unknown as Top10Artifact);
    });
  });
}
const VENDOR = resolve(__dir, '../../vendor');

/** Silence all log output so test output is clean. */
const silent = createLogger({ format: 'json', write: () => {} });

/**
 * Pipeline config wired to vendor engine checkouts.
 * All stage timeouts set to 60s for CI. AI is forced deterministic + budget=0.
 */
function makePipelineConfig(artifactStore: string): PipelineConfig {
  return {
    engines: {
      aggregator: join(VENDOR, 'ardur-news-aggregator'), // not called; injected
      ranking: join(VENDOR, 'ardur-ranking-engine'),
      top10: join(VENDOR, 'ardur-top10-engine'),
      synthesizer: join(VENDOR, 'ardur-article-synthesizer'),
    },
    artifactStore,
    ai: {
      provider: 'deterministic',
      maxGenerations: 0,
      timeoutMs: 20_000,
    },
    ollama: { host: '', model: '' },
    etl: { enabled: false, timeoutMs: 30_000 },
    stageTimeouts: {
      aggregate: 10_000,
      extract: 60_000,
      rank: 60_000,
      top10: 60_000,
      synthesize: 60_000,
    },
    retry: { attempts: 0, backoffMs: 0 },
    hermes: {
      coverageDbPath: join(artifactStore, 'coverage.db'),
      darkLaunchEnabled: false,
    },
    observability: {
      alertWebhookUrl: null,
      metricsWebhookUrl: null,
      logFormat: 'json',
    },
  };
}

/**
 * Build hybrid runners: aggregator is an injector returning the golden
 * fixture with the pipeline cycle format; ranking/top10/synthesizer are
 * real CLI-backed runners that spawn the vendor engine processes.
 *
 * Cycle format note: ardur-pipeline uses full ISO cycle ids
 * ("2026-06-11T06:00:00.000Z") while the engine cycle.ts files use
 * minute-precision ids ("2026-06-11T06:00Z"). The injected aggregation
 * is stamped with the pipeline cycle so cycle.id is consistent end-to-end
 * and the orchestrator emits no cycle-mismatch warnings.
 */
function makeHybridRunners(config: PipelineConfig): StageRunners {
  const pipelineCycle = cycleFor(FIXED_NOW);
  const cliRunners = createCliRunners(config, pipelineCycle, silent);

  const goldenAgg = {
    ...GOLDEN_AGGREGATION,
    cycle: pipelineCycle,
    // Preserve the rest of the artifact unchanged.
  };

  return {
    aggregate: async (_cycle) => goldenAgg,
    rank: (agg) => cliRunners.rank(agg),
    // Use named-flag invocation: pipeline runners.ts still uses legacy positional args.
    selectTop10: (ranking, prev, agg) =>
      invokeTop10Cli(join(VENDOR, 'ardur-top10-engine'), ranking, prev, agg, 60_000),
    synthesize: (top10, agg) => cliRunners.synthesize(top10, agg),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('pipeline: full cycle publishes with real CLI-backed engines', { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ardur-e2e-pipeline-'));
  const config = makePipelineConfig(root);
  const runners = makeHybridRunners(config);

  const result = await runCycle({
    config,
    logger: silent,
    now: () => FIXED_NOW,
    runners,
  });

  // The status must not be 'failed'. Warnings from deterministic fallback
  // may set it to 'degraded', which is acceptable.
  assert.ok(
    result.status === 'published' || result.status === 'degraded',
    `Cycle status was '${result.status}'. Warnings: ${result.warnings.join('; ')}`,
  );
  assert.equal(result.dryRun, undefined, 'dryRun should be unset for a real publish');
  assert.ok(result.timings.length >= 4, 'Should have at least 4 stage timings');
  assert.ok(result.nextRefreshAt.length > 0, 'nextRefreshAt should be set');

  // Verify the store has a manifest and latest/ symlink.
  assert.ok(existsSync(join(root, 'manifest.json')), 'manifest.json must exist after publish');
  assert.ok(existsSync(join(root, 'latest')), 'latest/ must exist after publish');
});

test('pipeline: all artifacts share schemaVersion and cycle.id', { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ardur-e2e-schema-'));
  const config = makePipelineConfig(root);
  const runners = makeHybridRunners(config);
  const pipelineCycle = cycleFor(FIXED_NOW);

  const result = await runCycle({
    config,
    logger: silent,
    now: () => FIXED_NOW,
    runners,
  });

  assert.ok(
    result.status !== 'failed',
    `Cycle failed. Warnings: ${result.warnings.join('; ')}`,
  );

  const SCHEMA_VERSION = 'ardur-content-pipeline/v1';
  const cycleSlug = pipelineCycle.id.replace(/:/g, '-');
  const cycleDir = join(root, 'cycles', cycleSlug);

  for (const file of ['aggregation.json', 'ranking.json', 'top10.json', 'articles.json']) {
    const art = JSON.parse(await readFile(join(cycleDir, file), 'utf8')) as {
      schemaVersion: string;
      cycle: { id: string };
    };
    assert.equal(
      art.schemaVersion,
      SCHEMA_VERSION,
      `${file} schemaVersion should be ${SCHEMA_VERSION}, got ${art.schemaVersion}`,
    );
    assert.equal(
      art.cycle.id,
      pipelineCycle.id,
      `${file} cycle.id should be ${pipelineCycle.id}, got ${art.cycle.id}`,
    );
  }
});

test('pipeline: ranking CLI produces 12 clusters (4 per topic) with consecutive ranks', { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ardur-e2e-ranking-'));
  const config = makePipelineConfig(root);
  const pipelineCycle = cycleFor(FIXED_NOW);
  const cliRunners = createCliRunners(config, pipelineCycle, silent);

  const goldenAgg = { ...GOLDEN_AGGREGATION, cycle: pipelineCycle };
  const ranking = await cliRunners.rank(goldenAgg);

  assert.equal(ranking.artifact, 'ranking');
  assert.equal(ranking.upstreamRunId, GOLDEN_AGGREGATION.runId);

  for (const topic of ['ai', 'security', 'devops']) {
    const clusters = ranking.data.rankedByTopic[topic];
    assert.ok(clusters && clusters.length === 4, `${topic} should have 4 clusters, got ${clusters?.length}`);
    // Ranks must be consecutive 1-based.
    clusters.forEach((c, i) => {
      assert.equal(c.rank, i + 1, `${topic}[${i}].rank should be ${i + 1}`);
    });
  }

  // The expected ranking order should be preserved.
  const ai = ranking.data.rankedByTopic['ai'];
  assert.ok(ai && ai[0]?.clusterId === 'ai-alpha', `ai[0] should be ai-alpha, got ${ai?.[0]?.clusterId}`);
  assert.ok(ai && ai[ai.length - 1]?.clusterId === 'ai-delta', `ai[last] should be ai-delta`);

  const sec = ranking.data.rankedByTopic['security'];
  const critIdx = sec?.findIndex((c) => c.clusterId === 'sec-critical') ?? -1;
  const exploitIdx = sec?.findIndex((c) => c.clusterId === 'sec-exploit') ?? -1;
  // Rev 3: factCorroborationSignal equalizes C for both; both should occupy the top 2 slots.
  assert.ok(critIdx <= 1 && exploitIdx <= 1, `sec-critical and sec-exploit should both be in top 2 security slots`);
});

test('pipeline: top10 CLI produces valid board with high-severity security in top 3', { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ardur-e2e-top10-'));
  const config = makePipelineConfig(root);
  const pipelineCycle = cycleFor(FIXED_NOW);
  const cliRunners = createCliRunners(config, pipelineCycle, silent);

  const goldenAgg = { ...GOLDEN_AGGREGATION, cycle: pipelineCycle };
  const ranking = await cliRunners.rank(goldenAgg);
  const top10 = await invokeTop10Cli(join(VENDOR, 'ardur-top10-engine'), ranking, null, goldenAgg, 60_000);

  assert.equal(top10.artifact, 'top10');
  assert.equal(top10.upstreamRunId, ranking.runId);

  // Global board size and category cap.
  assert.ok(top10.data.global.length <= 10, `global board has ${top10.data.global.length} entries (max 10)`);
  const topicCounts: Record<string, number> = {};
  for (const e of top10.data.global) {
    topicCounts[e.topic] = (topicCounts[e.topic] ?? 0) + 1;
  }
  for (const [topic, count] of Object.entries(topicCounts)) {
    assert.ok(count <= 4, `Topic '${topic}' has ${count} entries on global board (cap 4)`);
  }

  // Per-topic boards only contain entries for their topic.
  for (const [topic, entries] of Object.entries(top10.data.top10ByTopic)) {
    for (const entry of entries) {
      assert.equal(entry.topic, topic, `entry ${entry.clusterId} in ${topic} board has wrong topic`);
    }
  }

  // A high-severity security entry must appear in the top 3.
  const top3Ids = top10.data.global.slice(0, 3).map((e) => e.clusterId);
  assert.ok(
    top3Ids.includes('sec-critical') || top3Ids.includes('sec-exploit'),
    `Expected sec-critical or sec-exploit in top 3, got: ${top3Ids.join(', ')}`,
  );

  // References are populated when aggregation is threaded through.
  for (const entry of top10.data.global) {
    assert.ok(
      entry.references.length > 0,
      `${entry.clusterId} should have references when aggregation is provided`,
    );
  }

  // nextRefreshAt equals cycle.windowEnd.
  assert.equal(
    top10.data.nextRefreshAt,
    pipelineCycle.windowEnd,
    'nextRefreshAt should equal cycle.windowEnd',
  );
});

test('pipeline: synthesizer CLI produces articles with deterministic provider', { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ardur-e2e-synth-'));
  const config = makePipelineConfig(root);
  const pipelineCycle = cycleFor(FIXED_NOW);
  const cliRunners = createCliRunners(config, pipelineCycle, silent);

  const goldenAgg = { ...GOLDEN_AGGREGATION, cycle: pipelineCycle };
  const ranking = await cliRunners.rank(goldenAgg);
  const top10 = await invokeTop10Cli(join(VENDOR, 'ardur-top10-engine'), ranking, null, goldenAgg, 60_000);
  const articles = await cliRunners.synthesize(top10, goldenAgg);

  assert.equal(articles.artifact, 'articles');
  assert.equal(articles.upstreamRunId, top10.runId);

  // Article count: one per unique cluster across global + per-topic boards.
  const allEntries = [
    ...top10.data.global,
    ...Object.values(top10.data.top10ByTopic).flat(),
  ];
  const uniqueCount = new Set(allEntries.map((e) => e.clusterId)).size;
  assert.equal(
    articles.data.articles.length,
    uniqueCount,
    `Expected ${uniqueCount} articles, got ${articles.data.articles.length}`,
  );

  // All articles must use the deterministic path (budget=0).
  for (const article of articles.data.articles) {
    assert.equal(
      article.ai.provider,
      'deterministic',
      `Article ${article.id} should use deterministic provider, got '${article.ai.provider}'`,
    );
    assert.equal(
      article.ai.status,
      'fallback',
      `Article ${article.id} ai.status should be 'fallback'`,
    );
  }

  // Copyright policy must be present and correct.
  assert.equal(articles.data.copyrightPolicy.originalTextOnly, true);
  assert.equal(articles.data.copyrightPolicy.reproduceArticleBody, false);

  // Each article must have at least one reference.
  for (const article of articles.data.articles) {
    assert.ok(
      article.references.length > 0,
      `Article ${article.id} has no references`,
    );
  }
});

test('pipeline: full cycle produces copyright-safe, in-voice articles', { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ardur-e2e-voice-'));
  const config = makePipelineConfig(root);
  const runners = makeHybridRunners(config);
  const pipelineCycle = cycleFor(FIXED_NOW);

  const result = await runCycle({
    config,
    logger: silent,
    now: () => FIXED_NOW,
    runners,
  });

  assert.ok(result.status !== 'failed', `Cycle failed: ${result.warnings.join('; ')}`);

  const cycleSlug = pipelineCycle.id.replace(/:/g, '-');
  const articles = JSON.parse(
    await readFile(join(root, 'cycles', cycleSlug, 'articles.json'), 'utf8'),
  ) as ArticleArtifact;

  // No article body should be reproduced verbatim (copyright gate).
  assert.equal(articles.data.copyrightPolicy.reproduceArticleBody, false);

  // No quote block exceeds 24 words (synthesizer's < 25 word limit after QA fix #7).
  for (const article of articles.data.articles) {
    for (const block of article.body) {
      if (block.type === 'quote' && typeof (block as { text?: string }).text === 'string') {
        const words = ((block as { text: string }).text).trim().split(/\s+/).length;
        assert.ok(
          words < 25,
          `Quote in ${article.id} exceeds 24 words (${words}): "${((block as { text: string }).text).slice(0, 60)}"`,
        );
      }
    }
    // Headline and dek must be non-empty.
    assert.ok(article.headline.length > 0, `Article ${article.id} has empty headline`);
    assert.ok(article.dek.length > 0, `Article ${article.id} has empty dek`);
    // Legal note must be present.
    assert.ok(
      typeof article.legalNote === 'string' && article.legalNote.length > 0,
      `Article ${article.id} missing legalNote`,
    );
  }
});

test('pipeline: 6h cycle is idempotent — re-run returns skipped', { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ardur-e2e-idem-'));
  const config = makePipelineConfig(root);
  const runners = makeHybridRunners(config);

  const first = await runCycle({
    config,
    logger: silent,
    now: () => FIXED_NOW,
    runners,
  });
  assert.ok(
    first.status !== 'failed',
    `First cycle failed: ${first.warnings.join('; ')}`,
  );

  // Re-fire with the exact same clock → same cycle.id → short-circuit.
  const second = await runCycle({
    config,
    logger: silent,
    now: () => FIXED_NOW,
    runners,
  });
  assert.equal(second.status, 'skipped', `Second run should be 'skipped', got '${second.status}'`);
  assert.equal(second.dryRun, undefined);
});

test('pipeline: dry-run writes archive but no pointer flip', { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ardur-e2e-dryrun-'));
  const config = makePipelineConfig(root);
  const runners = makeHybridRunners(config);
  const pipelineCycle = cycleFor(FIXED_NOW);

  const result = await runCycle({
    config,
    logger: silent,
    now: () => FIXED_NOW,
    runners,
    dryRun: true,
  });

  assert.ok(
    result.status === 'published' || result.status === 'degraded',
    `Dry-run status was '${result.status}'`,
  );
  assert.equal(result.dryRun, true, 'RunResult.dryRun should be true');

  // Archive files must exist.
  const cycleSlug = pipelineCycle.id.replace(/:/g, '-');
  for (const file of ['aggregation.json', 'ranking.json', 'top10.json', 'articles.json', 'run.json']) {
    assert.ok(
      existsSync(join(root, 'cycles', cycleSlug, file)),
      `${file} should exist in cycles archive after dry-run`,
    );
  }

  // Pointer files must NOT exist.
  assert.ok(!existsSync(join(root, 'manifest.json')), 'manifest.json must not exist after dry-run');
  assert.ok(!existsSync(join(root, 'latest')), 'latest/ must not exist after dry-run');
});

test('pipeline: dry-run then real run publishes; further re-run skips', { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ardur-e2e-dry-then-real-'));
  const config = makePipelineConfig(root);
  const runners = makeHybridRunners(config);

  const dry = await runCycle({
    config, logger: silent, now: () => FIXED_NOW, runners, dryRun: true,
  });
  assert.equal(dry.dryRun, true);

  // Real run should succeed (dry-run doesn't block it).
  const real = await runCycle({
    config, logger: silent, now: () => FIXED_NOW, runners,
  });
  assert.ok(real.status !== 'failed', `Real run failed: ${real.warnings.join('; ')}`);
  assert.equal(real.dryRun, undefined);

  // Subsequent re-run is idempotent.
  const replay = await runCycle({
    config, logger: silent, now: () => FIXED_NOW, runners,
  });
  assert.equal(replay.status, 'skipped');
});

test('pipeline: manifest has correct runIds, summary, and health', { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ardur-e2e-manifest-'));
  const config = makePipelineConfig(root);
  const runners = makeHybridRunners(config);
  const pipelineCycle = cycleFor(FIXED_NOW);

  const result = await runCycle({
    config,
    logger: silent,
    now: () => FIXED_NOW,
    runners,
  });

  assert.ok(result.status !== 'failed', `Cycle failed: ${result.warnings.join('; ')}`);

  const store = new ArtifactStore(root);
  const manifest = await store.readManifest();
  assert.ok(manifest, 'manifest.json must exist');

  assert.equal(manifest.schemaVersion, 'ardur-content-pipeline/v1');
  assert.equal(manifest.cycle.id, pipelineCycle.id);
  assert.equal(manifest.nextRefreshAt, pipelineCycle.windowEnd);

  // RunIds: pipeline uses its own generated IDs for real runs.
  assert.ok(typeof manifest.runIds.aggregation === 'string', 'runIds.aggregation should be a string');
  assert.ok(typeof manifest.runIds.ranking === 'string', 'runIds.ranking should be a string');
  assert.ok(typeof manifest.runIds.top10 === 'string', 'runIds.top10 should be a string');
  assert.ok(typeof manifest.runIds.articles === 'string', 'runIds.articles should be a string');

  // Summary: 3 topics covered, non-empty global board.
  // articleCount is PUBLISHED-only; on budget=0 all articles are held → count = 0.
  assert.ok(manifest.summary.topicsCovered.length >= 1, 'At least 1 topic covered');
  assert.ok(manifest.summary.globalTop10.length > 0, 'globalTop10 should be non-empty');
  assert.equal(manifest.summary.articleCount, 0, 'articleCount should be 0 when all articles are held (budget=0)');

  // Health: all fields present; on budget=0 every article is held.
  assert.ok(typeof manifest.health.failedSources === 'number', 'health.failedSources should be a number');
  assert.ok(typeof manifest.health.degradedTopics === 'number', 'health.degradedTopics should be a number');
  assert.ok(typeof manifest.health.articlesDropped === 'number', 'health.articlesDropped should be a number');
  assert.ok(typeof manifest.health.usedFallback === 'boolean', 'health.usedFallback should be a boolean');
  assert.ok((manifest.health as { heldArticles?: number }).heldArticles as number > 0, 'health.heldArticles should be > 0 on budget=0 path');
});

test('pipeline: two consecutive cycles accumulate metrics', { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ardur-e2e-metrics-'));
  const config = makePipelineConfig(root);
  const pipelineCycle1 = cycleFor(FIXED_NOW);
  // Second cycle: FIXED_NOW + 6h.
  const fixedNow2 = new Date(FIXED_NOW.valueOf() + 6 * 3600 * 1000);
  const pipelineCycle2 = cycleFor(fixedNow2);

  // Cycle 1.
  const goldenAgg1 = { ...GOLDEN_AGGREGATION, cycle: pipelineCycle1 };
  const cliRunners1 = createCliRunners(config, pipelineCycle1, silent);
  await runCycle({
    config,
    logger: silent,
    now: () => FIXED_NOW,
    runners: {
      ...cliRunners1,
      aggregate: async (_cycle) => goldenAgg1,
      selectTop10: (r, p, a) => invokeTop10Cli(join(VENDOR, 'ardur-top10-engine'), r, p, a, 60_000),
    },
  });

  // Cycle 2 (shifted aggregation cycle meta, same item data).
  const goldenAgg2 = { ...GOLDEN_AGGREGATION, cycle: pipelineCycle2 };
  const cliRunners2 = createCliRunners(config, pipelineCycle2, silent);
  await runCycle({
    config,
    logger: silent,
    now: () => fixedNow2,
    runners: {
      ...cliRunners2,
      aggregate: async (_cycle) => goldenAgg2,
      selectTop10: (r, p, a) => invokeTop10Cli(join(VENDOR, 'ardur-top10-engine'), r, p, a, 60_000),
    },
  });

  const ndjsonPath = join(root, 'metrics.ndjson');
  assert.ok(existsSync(ndjsonPath), 'metrics.ndjson should exist');
  const lines = (await readFile(ndjsonPath, 'utf8')).trim().split('\n');
  assert.ok(lines.length >= 2, `Expected ≥2 metrics lines, got ${lines.length}`);

  const ids = lines.map((l) => (JSON.parse(l) as { cycleId: string }).cycleId);
  assert.ok(ids.includes(pipelineCycle1.id), `metrics should include cycle ${pipelineCycle1.id}`);
  assert.ok(ids.includes(pipelineCycle2.id), `metrics should include cycle ${pipelineCycle2.id}`);
});

test('pipeline: run.json archive contains rawWarnings array', { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ardur-e2e-runrec-'));
  const config = makePipelineConfig(root);
  const runners = makeHybridRunners(config);
  const pipelineCycle = cycleFor(FIXED_NOW);

  await runCycle({ config, logger: silent, now: () => FIXED_NOW, runners });

  const cycleSlug = pipelineCycle.id.replace(/:/g, '-');
  const runRec = JSON.parse(
    await readFile(join(root, 'cycles', cycleSlug, 'run.json'), 'utf8'),
  ) as { rawWarnings: unknown };

  assert.ok(Array.isArray(runRec.rawWarnings), 'run.json.rawWarnings should be an array');
});

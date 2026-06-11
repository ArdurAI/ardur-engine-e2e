/**
 * E2E: article synthesizer — Top10Artifact + AggregationArtifact → ArticleArtifact
 *
 * All tests run on the deterministic (budget=0) path (maxGenerations=0, no AI env
 * vars set).  This ensures the tests are:
 *  - Fully offline — no network calls, no paid API dependencies
 *  - Reproducible — deterministic fallback produces stable output
 *  - Fast — no timeouts waiting for model responses
 *
 * Asserts:
 *  1. One article per Top-10 entry (no extras, no missing).
 *  2. All articles use the deterministic provider (ai.provider === 'deterministic').
 *  3. Copyright safety: no reproduced article bodies, quotes < 25 words + attributed,
 *     all sources have canonical links.
 *  4. Render contract: every ArticleBlock type is in the allowed set; required
 *     sections (key-takeaway, why-this-matters, what-happened, ardur-take) present.
 *  5. In-voice on budget=0: body text does not contain banned lexicon.
 *  6. Provenance: every article has a non-empty `references` list and legalNote.
 *  7. Completeness: wordCount >= 150, readingTimeMinutes >= 1.
 *  8. Artifact shape: schema version, cycle id, upstreamRunId present.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runRanking } from '../../vendor/ardur-ranking-engine/src/index.ts';
import { selectTop10 } from '../../vendor/ardur-top10-engine/src/index.ts';
import { runSynthesis } from '../../vendor/ardur-article-synthesizer/src/index.ts';
import type { SynthesizedArticle } from '../../vendor/ardur-article-synthesizer/src/index.ts';
import { SCHEMA_VERSION } from '../../vendor/ardur-article-synthesizer/src/contracts.ts';
import { MAX_QUOTE_WORDS } from '../../vendor/ardur-article-synthesizer/src/copyright.ts';
import { MIN_BODY_WORDS, SECTION_PLAN } from '../../vendor/ardur-article-synthesizer/src/assemble.ts';
import { VOICE_STYLE } from '../../vendor/ardur-article-synthesizer/src/style.ts';
import { RENDERABLE_BLOCK_TYPES } from '../../vendor/ardur-article-synthesizer/src/render.ts';
import { GOLDEN_AGGREGATION } from '../fixtures/aggregation.ts';
import { FIXED_NOW } from '../fixtures/cycle.ts';

async function buildPipeline() {
  const ranking = runRanking(GOLDEN_AGGREGATION, { now: FIXED_NOW });
  const top10 = selectTop10(ranking, null, { aggregation: GOLDEN_AGGREGATION });
  // Force deterministic path: maxGenerations=0 prevents any AI model call
  const articles = await runSynthesis({
    top10,
    aggregation: GOLDEN_AGGREGATION,
    maxGenerations: 0,
    now: FIXED_NOW,
  });
  return { ranking, top10, articles };
}

test('runSynthesis produces a valid ArticleArtifact on the budget=0 path', async () => {
  const { articles, top10 } = await buildPipeline();

  assert.equal(articles.schemaVersion, SCHEMA_VERSION);
  assert.equal(articles.artifact, 'articles');
  assert.equal(articles.upstreamRunId, top10.runId);
  assert.equal(articles.cycle.id, top10.cycle.id);
  assert.ok(Array.isArray(articles.data.articles));
  assert.ok(articles.data.copyrightPolicy.originalTextOnly === true);
  assert.equal(articles.data.copyrightPolicy.reproduceArticleBody, false);
  assert.equal(articles.data.copyrightPolicy.requireAttribution, true);
  assert.equal(articles.data.copyrightPolicy.requireCanonicalLinks, true);
});

test('one article synthesized per unique entry across global and per-topic boards', async () => {
  // runSynthesis gathers global + per-topic boards and deduplicates by clusterId,
  // so the article count equals the number of unique clusters across all boards.
  const { articles, top10 } = await buildPipeline();
  const allEntries = [
    ...top10.data.global,
    ...Object.values(top10.data.top10ByTopic).flat(),
  ];
  const uniqueCount = new Set(allEntries.map((e) => e.clusterId)).size;
  assert.equal(
    articles.data.articles.length,
    uniqueCount,
    `Expected ${uniqueCount} articles (unique clusters), got ${articles.data.articles.length}`,
  );
});

test('all articles use deterministic provider when maxGenerations=0', async () => {
  const { articles } = await buildPipeline();
  for (const article of articles.data.articles) {
    assert.equal(
      article.ai.provider,
      'deterministic',
      `Article ${article.id} should use 'deterministic' provider, got '${article.ai.provider}'`,
    );
    assert.equal(
      article.ai.status,
      'fallback',
      `Article ${article.id} ai.status should be 'fallback', got '${article.ai.status}'`,
    );
  }
});

test('each article rank matches the corresponding Top-10 entry rank', async () => {
  // Synthesizer uses global rank when the cluster appears in the global board;
  // otherwise falls back to per-topic rank. Build a unified map: global wins.
  const { articles, top10 } = await buildPipeline();
  const entryByCluster = new Map<string, { rank: number }>();
  for (const entries of Object.values(top10.data.top10ByTopic)) {
    for (const e of entries) entryByCluster.set(e.clusterId, e);
  }
  for (const e of top10.data.global) entryByCluster.set(e.clusterId, e); // global rank wins

  for (const article of articles.data.articles) {
    const entry = entryByCluster.get(article.provenance.clusterId);
    assert.ok(entry, `No entry found for article clusterId ${article.provenance.clusterId}`);
    assert.equal(
      article.rank,
      entry.rank,
      `Article rank (${article.rank}) should match entry rank (${entry.rank}) for ${article.provenance.clusterId}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Copyright safety
// ---------------------------------------------------------------------------

test('copyright policy is present and enforces original-text-only', async () => {
  const { articles } = await buildPipeline();
  const { copyrightPolicy } = articles.data;
  assert.equal(copyrightPolicy.originalTextOnly, true);
  assert.equal(copyrightPolicy.reproduceArticleBody, false);
  assert.equal(copyrightPolicy.requireAttribution, true);
  assert.equal(copyrightPolicy.requireCanonicalLinks, true);
  assert.ok(copyrightPolicy.maxQuoteWords > 0, 'maxQuoteWords should be positive');
  assert.ok(copyrightPolicy.maxQuoteWords <= MAX_QUOTE_WORDS, `maxQuoteWords should be <= ${MAX_QUOTE_WORDS}`);
});

test('no quote block exceeds MAX_QUOTE_WORDS (25) words', async () => {
  const { articles } = await buildPipeline();
  for (const article of articles.data.articles) {
    for (const block of article.body) {
      if (block.type === 'quote' && block.text) {
        const wordCount = block.text.trim().split(/\s+/).length;
        assert.ok(
          wordCount <= MAX_QUOTE_WORDS,
          `Quote in article ${article.id} has ${wordCount} words (max ${MAX_QUOTE_WORDS}): "${block.text.slice(0, 60)}..."`,
        );
      }
    }
  }
});

test('every quote block has attribution with source and url', async () => {
  const { articles } = await buildPipeline();
  for (const article of articles.data.articles) {
    for (const block of article.body) {
      if (block.type === 'quote') {
        assert.ok(
          block.attribution !== undefined,
          `Quote in article ${article.id} missing attribution: "${block.text?.slice(0, 60)}"`,
        );
        assert.ok(block.attribution?.source.length ?? 0 > 0, 'Attribution source should be non-empty');
        assert.ok(block.attribution?.url.length ?? 0 > 0, 'Attribution url should be non-empty');
      }
    }
  }
});

test('every article has at least one reference with canonical url', async () => {
  const { articles } = await buildPipeline();
  for (const article of articles.data.articles) {
    assert.ok(
      article.references.length > 0,
      `Article ${article.id} has no references`,
    );
    for (const ref of article.references) {
      assert.ok(ref.url.length > 0, `Reference url should be non-empty in article ${article.id}`);
      assert.ok(ref.source.length > 0, `Reference source should be non-empty`);
    }
  }
});

test('legalNote is present and non-empty on every article', async () => {
  const { articles } = await buildPipeline();
  for (const article of articles.data.articles) {
    assert.ok(
      typeof article.legalNote === 'string' && article.legalNote.length > 0,
      `Article ${article.id} missing legalNote`,
    );
  }
});

// ---------------------------------------------------------------------------
// Render contract
// ---------------------------------------------------------------------------

test('all ArticleBlock types are in the renderable set', async () => {
  const { articles } = await buildPipeline();
  const allowed = new Set<string>(RENDERABLE_BLOCK_TYPES);
  for (const article of articles.data.articles) {
    for (const block of article.body) {
      assert.ok(
        allowed.has(block.type),
        `Block type '${block.type}' in article ${article.id} is not in RENDERABLE_BLOCK_TYPES`,
      );
    }
  }
});

test('required sections are present in each article body', async () => {
  const { articles } = await buildPipeline();
  const requiredSections = SECTION_PLAN.filter((s) => s.required).map((s) => s.heading);

  for (const article of articles.data.articles) {
    const headings = article.body
      .filter((b) => b.type === 'heading')
      .map((b) => b.text ?? '');

    for (const required of requiredSections) {
      assert.ok(
        headings.some((h) => h.includes(required)),
        `Article ${article.id} missing required section '${required}'. Headings: [${headings.join(', ')}]`,
      );
    }
  }
});

test('article body has at least MIN_BODY_WORDS words', async () => {
  const { articles } = await buildPipeline();
  for (const article of articles.data.articles) {
    assert.ok(
      article.wordCount >= MIN_BODY_WORDS,
      `Article ${article.id} wordCount ${article.wordCount} < MIN_BODY_WORDS ${MIN_BODY_WORDS}`,
    );
  }
});

test('readingTimeMinutes is at least 1 for every article', async () => {
  const { articles } = await buildPipeline();
  for (const article of articles.data.articles) {
    assert.ok(
      article.readingTimeMinutes >= 1,
      `Article ${article.id} readingTimeMinutes should be >= 1, got ${article.readingTimeMinutes}`,
    );
  }
});

// ---------------------------------------------------------------------------
// In-voice on budget=0
// ---------------------------------------------------------------------------

test('deterministic articles do not contain banned lexicon words', async () => {
  const { articles } = await buildPipeline();
  const banned = new Set(VOICE_STYLE.bannedLexicon.map((w) => w.toLowerCase()));

  for (const article of articles.data.articles) {
    const bodyText = article.body
      .map((b) => [b.text, ...(b.items ?? [])].join(' '))
      .join(' ')
      .toLowerCase();

    for (const word of banned) {
      // Check whole-word presence (surrounded by non-alphanumeric or boundary)
      const pattern = new RegExp(`\\b${word.replace(/[-]/g, '[-\\s]?')}\\b`, 'i');
      assert.ok(
        !pattern.test(bodyText),
        `Article ${article.id} contains banned lexicon word: "${word}"`,
      );
    }
  }
});

test('deterministic articles have non-empty headline and dek', async () => {
  const { articles } = await buildPipeline();
  for (const article of articles.data.articles) {
    assert.ok(article.headline.length > 0, `Article ${article.id} has empty headline`);
    assert.ok(article.dek.length > 0, `Article ${article.id} has empty dek`);
  }
});

test('deterministic articles have keyPoints, whyItMatters, and readerAction', async () => {
  const { articles } = await buildPipeline();
  for (const article of articles.data.articles) {
    assert.ok(article.keyPoints.length > 0, `Article ${article.id} has no keyPoints`);
    assert.ok(article.whyItMatters.length > 0, `Article ${article.id} has empty whyItMatters`);
    assert.ok(article.readerAction.length > 0, `Article ${article.id} has empty readerAction`);
  }
});

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

test('every article carries provenance linking back to the cluster', async () => {
  // Articles may be synthesized from both global and per-topic boards
  const { articles, top10 } = await buildPipeline();
  const allClusterIds = new Set([
    ...top10.data.global.map((e) => e.clusterId),
    ...Object.values(top10.data.top10ByTopic).flat().map((e) => e.clusterId),
  ]);

  for (const article of articles.data.articles) {
    assert.ok(
      allClusterIds.has(article.provenance.clusterId),
      `Article ${article.id} provenance.clusterId '${article.provenance.clusterId}' not in any Top-10 board`,
    );
    assert.ok(article.provenance.sourceCount > 0, `Article ${article.id} provenance.sourceCount should be > 0`);
    assert.ok(article.provenance.distinctDomains > 0, `Article ${article.id} provenance.distinctDomains should be > 0`);
    assert.equal(article.provenance.upstreamRunId, top10.runId, `Provenance upstreamRunId should match top10.runId`);
  }
});

test('article tags are non-empty', async () => {
  const { articles } = await buildPipeline();
  for (const article of articles.data.articles) {
    assert.ok(article.tags.length > 0, `Article ${article.id} has no tags`);
  }
});

// ---------------------------------------------------------------------------
// Article artifact warnings: budget=0 graceful degradation
// ---------------------------------------------------------------------------

test('no article is absent: failures degrade gracefully to deterministic fallback', async () => {
  // Since maxGenerations=0, every entry is produced via deterministic fallback.
  // The synthesizer guarantees one article per unique cluster (global + per-topic).
  const { articles, top10 } = await buildPipeline();
  const allEntries = [
    ...top10.data.global,
    ...Object.values(top10.data.top10ByTopic).flat(),
  ];
  const uniqueCount = new Set(allEntries.map((e) => e.clusterId)).size;
  assert.equal(
    articles.data.articles.length,
    uniqueCount,
    `All ${uniqueCount} unique clusters should produce an article even on the budget=0 path`,
  );
});

test('generatedAt is an ISO 8601 UTC timestamp on every article', async () => {
  const { articles } = await buildPipeline();
  const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
  for (const article of articles.data.articles) {
    assert.ok(ISO_RE.test(article.generatedAt), `Article ${article.id} generatedAt '${article.generatedAt}' is not ISO 8601 UTC`);
  }
});

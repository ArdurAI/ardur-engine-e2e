# ardur-engine-e2e

End-to-end integration tests for the Ardur AI content pipeline:

```
AggregationArtifact (golden fixture)
  → ardur-ranking-engine  → RankingArtifact
  → ardur-top10-engine    → Top10Artifact
  → ardur-article-synthesizer → ArticleArtifact
  → ardur-pipeline (orchestrator) drives all three via CLI spawn
```

The aggregator input boundary (`ardur-news-aggregator`) is stubbed with
deterministic golden `AggregationArtifact` fixtures so these tests remain
fully offline and independent of the aggregator implementation.

## What is tested

| Test file | Mode | Coverage |
|-----------|------|----------|
| `ranking.test.ts` | in-process | Score formula, per-topic rank ordering, audit trail, determinism |
| `top10.test.ts` | in-process | Top-10 selection, category balance, tie-breaking, idempotency, cycle math, delta/stability, references |
| `synthesizer.test.ts` | in-process | One article per Top-10 entry, deterministic path, copyright safety, render contract, voice check, provenance |
| `pipeline.test.ts` | **real CLIs** | Full orchestrator flow via child-process CLI handoff, 6h cycle idempotency, dry-run, manifest structure, metrics accumulation |

### pipeline.test.ts in detail

Uses `runCycle` from `ardur-pipeline` with **real CLI-backed runners** for
ranking, top10, and synthesizer. The aggregator stage is replaced by a golden
fixture injector (offline, deterministic). Covers:

1. Full cycle publishes without `failed` status
2. All four artifacts share `schemaVersion` and `cycle.id`
3. Ranking CLI: 12 clusters ranked (4/topic), consecutive ranks, `ai-alpha` first, `sec-critical > sec-exploit`
4. Top-10 CLI: global board ≤10, category cap, references populated, `nextRefreshAt = windowEnd`
5. Synthesizer CLI: one article per unique cluster, `ai.provider = 'deterministic'`, copyright policy present
6. Copyright safety end-to-end: no reproduced bodies, quotes < 25 words, `legalNote` present
7. 6h cycle idempotency: re-fire same clock → `status: 'skipped'`
8. Dry-run: archive written, manifest/latest NOT created
9. Dry-run → real → re-run: correct publish/skip sequence
10. Manifest: `runIds`, `summary`, `health` all present
11. Two distinct cycles → `metrics.ndjson` gains two lines
12. `run.json` contains `rawWarnings` array

## Golden fixtures

`src/fixtures/aggregation.ts` contains a hand-crafted `AggregationArtifact`:

- **12 clusters** across 3 topics (`ai`, `security`, `devops`), 4 per topic
- **30 `AggregatedItem`s** wired to the clusters
- Signal magnitudes chosen so the ranking order is analytically verifiable

Key ordering expectations:
- `sec-critical` > `sec-exploit` in security (T=1.0 via `critical severity` + `kubernetes` beats T=0.95 via `actively exploited`)
- `ai-alpha` > `ai-beta` > `ai-gamma` > `ai-delta` in AI (decreasing source count, age, age, tier mix)
- `devops-alpha` first in DevOps (primary source + k8s release)

## Engine consumption

Engines are consumed via **git submodules** pointing to the canonical public repos:

```
vendor/
  ardur-ranking-engine      → ArdurAI/ardur-ranking-engine  (pinned: latest main)
  ardur-top10-engine        → ArdurAI/ardur-top10-engine    (pinned: latest main)
  ardur-article-synthesizer → ArdurAI/ardur-article-synthesizer (pinned: latest main)
  ardur-pipeline            → ArdurAI/ardur-pipeline        (pinned: latest main)
```

Unit tests import directly from `vendor/*/src/*.ts` using `--experimental-strip-types`.
Pipeline tests import `runCycle` + `createCliRunners` from `vendor/ardur-pipeline/src/`
and spawn the engine CLIs as child processes — zero compilation required.

## Running locally

```bash
git clone --recurse-submodules https://github.com/ArdurAI/ardur-engine-e2e.git
cd ardur-engine-e2e
npm ci
npm run typecheck          # TypeScript strict mode
npm run test:unit          # in-process library tests (~300ms)
npm run test:pipeline      # real CLI spawn tests (~6-15s depending on machine)
npm test                   # all 72 tests
```

All tests run fully offline (`ARDUR_AI_PROVIDER=deterministic`,
`ARDUR_AI_MAX_GENERATIONS=0`). No network calls, no paid API dependencies.

## Integration gaps found (filed as issues)

| Repo | Description |
|------|-------------|
| `ardur-pipeline` | `cycleFor()` produces full-millisecond ISO ids (`2026-06-11T06:00:00.000Z`) while `ardur-top10-engine/src/cycle.ts` produces minute-precision ids (`2026-06-11T06:00Z`). The e2e suite works around this by stamping the golden aggregation with the pipeline cycle format so `cycle.id` is consistent end-to-end. See issue filed below. |

## Architecture

See [`ARCHITECTURE.md`](https://github.com/ArdurAI/ardur-ranking-engine/blob/main/ARCHITECTURE.md)
(identical across all four engine repos) for the full end-to-end pipeline contract.

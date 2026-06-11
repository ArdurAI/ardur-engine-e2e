# ardur-engine-e2e

End-to-end integration tests for the Ardur AI content pipeline:

```
Cluster[] (golden fixture)
  → ardur-ranking-engine  → RankingArtifact
  → ardur-top10-engine    → Top10Artifact
  → ardur-article-synthesizer → ArticleArtifact
```

The aggregator input boundary (`ardur-news-aggregator`) is stubbed with deterministic golden `Cluster` fixtures so these tests remain fully offline and independent of the aggregator implementation.

## What is tested

| Test file | Coverage |
|-----------|----------|
| `ranking.test.ts` | Score formula `Score = Recency × [0.30·C + 0.28·T + 0.22·S + 0.20·E] × Diversity`, per-topic rank ordering, audit trail, determinism |
| `top10.test.ts` | 6h Top-10 selection, category balance (`ceil(10/3)=4` cap), tie-breaking cascade, idempotency, cycle math, delta/stability, reference population |
| `synthesizer.test.ts` | One article per Top-10 entry, deterministic (`budget=0`) path, copyright safety (no reproduced bodies, quotes <25 words, canonical links), render contract, in-voice check (banned lexicon), provenance |

## Golden fixtures

`src/fixtures/aggregation.ts` contains a hand-crafted `AggregationArtifact` with:
- **12 clusters** across 3 topics (`ai`, `security`, `devops`), 4 per topic
- **30 `AggregatedItem`s** wired to the clusters
- Designed signal magnitudes (see inline comments) so the expected ranking order is analytically verifiable

Key ordering expectations:
- `sec-critical` > `sec-exploit` in security (T=1.0 via `critical severity` + `kubernetes` beats T=0.95 via `actively exploited`)
- `ai-alpha` > `ai-beta` > `ai-gamma` > `ai-delta` in AI (decreasing source count, age, and tier mix)
- `devops-alpha` > others in DevOps (primary source + k8s release)

## Engine consumption

Engines are consumed via **git submodules** pointing to the canonical public repos:

```
vendor/
  ardur-ranking-engine     → ArdurAI/ardur-ranking-engine
  ardur-top10-engine       → ArdurAI/ardur-top10-engine
  ardur-article-synthesizer → ArdurAI/ardur-article-synthesizer
```

Tests import directly from `vendor/*/src/index.ts` using Node.js `--experimental-strip-types`. No build step is required; the engines' TypeScript source is imported directly. The shared `contracts.ts` contract (byte-identical across all four repos) is the wire format.

## Running locally

```bash
git clone --recurse-submodules https://github.com/ArdurAI/ardur-engine-e2e.git
cd ardur-engine-e2e
npm ci
npm run typecheck  # TypeScript strict mode
npm test           # node:test runner, fully offline
npm run test:verbose  # spec reporter
```

All tests run in ~1–2 seconds with zero network calls (`ARDUR_AI_ENABLED=0` is set in CI; the synthesizer defaults to deterministic when no AI provider is configured).

## Integration gaps (filed issues)

See the repo Issues tab for gaps found during the authoring of these tests:

- **#1** — `contracts.ts` `ScoreBreakdown` does not expose the Technical-Significance signal value `T` as a typed field; it is only present in the `AuditEntry.inputs` map. Ranking tests must use pure signal functions for independent T computation.
- **#2** — `runRanking` does not yet accept a per-topic weight override; a single `weightProfile` applies globally.

## Architecture

See [`ARCHITECTURE.md`](https://github.com/ArdurAI/ardur-ranking-engine/blob/main/ARCHITECTURE.md) (identical across all four engine repos) for the full end-to-end pipeline contract.

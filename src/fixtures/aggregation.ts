/**
 * Golden AggregationArtifact — deterministic input for the full pipeline.
 *
 * Three topics, 4 clusters each (12 total), 30 AggregatedItems.  Items are
 * designed so the ranking and Top-10 engines produce a predictable, verifiable
 * ordering.  See the signal notes in each cluster block below.
 *
 * COPYRIGHT-SAFE DESIGN RULE: all item `title` and `cluster.headline` fields are
 * kept ≤ 7 words.  The synthesizer's copyright gate rejects articles that share
 * an 8+ word verbatim run with any source title/summaryHint (MAX_VERBATIM_NGRAM=8).
 * Rich technical-significance signal patterns (CVE/exploit phrases, k8s, LLM …)
 * live in `summaryHint`, which is included in the ranking engine's signal corpus
 * but NOT reproduced verbatim in the deterministic article template.
 *
 * Design invariants:
 *  - velocity is always null → engagement falls back to crossSourceMentions
 *  - latestPublishedAt controls recency; FIXED_NOW = 2026-06-11T11:50:00Z
 *  - member fingerprints are unique (domain::slug)
 *  - Rev 3: factsByCluster and documentsByTopic populated for key clusters
 */

import {
  SCHEMA_VERSION,
  CONTRACT_REVISION,
} from '@ardurai/contracts';
import type {
  AggregatedItem,
  AggregationArtifact,
  Cluster,
  InteractionMetrics,
  ExtractedFact,
  SourceDocument,
} from '@ardurai/contracts';
import { CYCLE, TOPICS } from './cycle.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInteraction(crossSourceMentions: number): InteractionMetrics {
  return {
    feedRank: 0,
    shares: null,
    comments: null,
    reactions: null,
    crossSourceMentions,
    velocity: null,
    capturedAt: '2026-06-11T12:00:00.000Z',
    provenance: 'golden-fixture',
  };
}

// ---------------------------------------------------------------------------
// AI items
//
// ai-alpha: 4 items — 1×primary, 1×paper, 2×technical-news; age ~1h
//   summaryHints contain "foundation model", "GPU", "inference engine" →
//   AI_PLATFORM_PATTERN fires; T≈0.30
//   S≈0.93 (primary+paper+tech-news mix), C≈0.73 (4 independent owners), E=1.0
//
// ai-beta: 3 items — 3×news; age ~3h
//   summaryHint contains "\bllm\b" → AI_PLATFORM_PATTERN fires; T≈0.30
//   S≈0.70, C≈0.63 (3 owners), E=0.60
//
// ai-gamma: 2 items — 2×news; age ~5h
//   No pattern match; T≈0.20 (noise floor), S≈0.70, C≈0.50, E=0.40
//
// ai-delta: 1 item — 1×news; age ~8h (lowest score, exercises global cap)
//   T≈0.20, S≈0.70, C≈0.32, E=0.20
// ---------------------------------------------------------------------------

const aiItems: AggregatedItem[] = [
  {
    id: 'ai-a-1', topic: 'ai', topicLabel: 'AI',
    title: 'GPT-5 ships with GPU improvements',
    source: 'OpenAI', sourceDomain: 'openai.com', sourceUrl: 'https://openai.com',
    url: 'https://openai.com/research/gpt-5',
    tier: 'primary', publishedAt: '2026-06-11T10:50:00.000Z',
    summaryHint: 'GPT-5 foundation model released with GPU-accelerated deep learning inference engine improvements',
    interaction: makeInteraction(5), clusterId: 'ai-alpha',
    fingerprint: 'openai.com::gpt-5-gpu-improvements',
  },
  {
    id: 'ai-a-2', topic: 'ai', topicLabel: 'AI',
    title: 'Scaling LLM inference on GPU clusters',
    source: 'arXiv', sourceDomain: 'arxiv.org', sourceUrl: 'https://arxiv.org',
    url: 'https://arxiv.org/abs/2606.00001',
    tier: 'paper', publishedAt: '2026-06-11T10:30:00.000Z',
    summaryHint: 'Preprint: inference engine scaling for foundation models on GPU clusters with LLM benchmarks',
    interaction: makeInteraction(5), clusterId: 'ai-alpha',
    fingerprint: 'arxiv.org::scaling-llm-gpu-inference',
  },
  {
    id: 'ai-a-3', topic: 'ai', topicLabel: 'AI',
    title: 'GPT-5 deep learning infrastructure view',
    source: 'The New Stack', sourceDomain: 'thenewstack.io', sourceUrl: 'https://thenewstack.io',
    url: 'https://thenewstack.io/gpt-5-deep-learning-infrastructure',
    tier: 'technical-news', publishedAt: '2026-06-11T11:00:00.000Z',
    summaryHint: 'Deep learning infrastructure perspective on GPT-5 foundation model and inference engine design',
    interaction: makeInteraction(5), clusterId: 'ai-alpha',
    fingerprint: 'thenewstack.io::gpt-5-deep-learning',
  },
  {
    id: 'ai-a-4', topic: 'ai', topicLabel: 'AI',
    title: 'GPT-5 benchmark vs foundation models',
    source: 'InfoQ', sourceDomain: 'infoq.com', sourceUrl: 'https://infoq.com',
    url: 'https://infoq.com/news/gpt-5-benchmark',
    tier: 'technical-news', publishedAt: '2026-06-11T11:10:00.000Z',
    summaryHint: 'GPT-5 inference engine benchmark compared against earlier foundation models on GPU hardware',
    interaction: makeInteraction(5), clusterId: 'ai-alpha',
    fingerprint: 'infoq.com::gpt-5-benchmark-foundation',
  },

  {
    id: 'ai-b-1', topic: 'ai', topicLabel: 'AI',
    title: 'LLM reasoning benchmark results published',
    source: 'Reuters', sourceDomain: 'reuters.com', sourceUrl: 'https://reuters.com',
    url: 'https://reuters.com/technology/llm-benchmark-2026',
    tier: 'news', publishedAt: '2026-06-11T08:50:00.000Z',
    summaryHint: 'LLM benchmark reveals improvements in machine learning model reasoning capabilities',
    interaction: makeInteraction(3), clusterId: 'ai-beta',
    fingerprint: 'reuters.com::llm-benchmark-2026',
  },
  {
    id: 'ai-b-2', topic: 'ai', topicLabel: 'AI',
    title: 'AI race to top LLM leaderboard',
    source: 'Bloomberg', sourceDomain: 'bloomberg.com', sourceUrl: 'https://bloomberg.com',
    url: 'https://bloomberg.com/technology/llm-race-2026',
    tier: 'news', publishedAt: '2026-06-11T09:00:00.000Z',
    summaryHint: 'Competition intensifies among LLM providers competing on the model leaderboard',
    interaction: makeInteraction(3), clusterId: 'ai-beta',
    fingerprint: 'bloomberg.com::llm-race-2026',
  },
  {
    id: 'ai-b-3', topic: 'ai', topicLabel: 'AI',
    title: 'What latest LLM models accomplish',
    source: 'TechCrunch', sourceDomain: 'techcrunch.com', sourceUrl: 'https://techcrunch.com',
    url: 'https://techcrunch.com/2026/llm-progress',
    tier: 'news', publishedAt: '2026-06-11T08:30:00.000Z',
    summaryHint: 'LLM progress overview: new machine learning models and benchmark improvements',
    interaction: makeInteraction(3), clusterId: 'ai-beta',
    fingerprint: 'techcrunch.com::llm-progress-2026',
  },

  {
    id: 'ai-c-1', topic: 'ai', topicLabel: 'AI',
    title: 'Enterprise AI adoption rises 2026',
    source: 'Wired', sourceDomain: 'wired.com', sourceUrl: 'https://wired.com',
    url: 'https://wired.com/story/ai-adoption-2026',
    tier: 'news', publishedAt: '2026-06-11T06:50:00.000Z',
    summaryHint: 'Enterprise AI adoption trends and automation tool integration rates',
    interaction: makeInteraction(2), clusterId: 'ai-gamma',
    fingerprint: 'wired.com::ai-adoption-2026',
  },
  {
    id: 'ai-c-2', topic: 'ai', topicLabel: 'AI',
    title: 'Leaders weigh AI deployment risks',
    source: 'Fortune', sourceDomain: 'fortune.com', sourceUrl: 'https://fortune.com',
    url: 'https://fortune.com/2026/ai-deployment',
    tier: 'news', publishedAt: '2026-06-11T06:45:00.000Z',
    summaryHint: 'Business leaders evaluating AI deployment risks and benefits in enterprise settings',
    interaction: makeInteraction(2), clusterId: 'ai-gamma',
    fingerprint: 'fortune.com::ai-deployment-2026',
  },

  {
    id: 'ai-d-1', topic: 'ai', topicLabel: 'AI',
    title: 'AI startup funding Q2 roundup',
    source: 'VentureBeat', sourceDomain: 'venturebeat.com', sourceUrl: 'https://venturebeat.com',
    url: 'https://venturebeat.com/ai/funding-q2-2026',
    tier: 'news', publishedAt: '2026-06-11T03:50:00.000Z',
    summaryHint: 'AI startup funding activity in Q2 2026 for early-stage companies',
    interaction: makeInteraction(1), clusterId: 'ai-delta',
    fingerprint: 'venturebeat.com::ai-funding-q2-2026',
  },
];

// ---------------------------------------------------------------------------
// Security items
//
// sec-exploit: 3 items — 2×security-news, 1×primary; age ~0.25h (very fresh)
//   summaryHint: "actively exploited in the wild zero-day" → T=0.95
//   S≈0.94 (1 primary + 2 sec-news), C≈0.63 (3 owners), E=1.0
//
// sec-critical: 4 items — 3×security-news, 1×primary; age ~2h
//   summaryHint: "critical severity" + title: "kubernetes" → T=1.0
//   S≈0.93, C≈0.73 (4 owners), E=1.0
//
// sec-medium: 2 items — 2×security-news; age ~4h
//   T≈0.20, S≈0.70, C≈0.50, E=0.40
//
// sec-low: 1 item — 1×security-news; age ~7h
//   T≈0.20, S≈0.70, C≈0.32, E=0
// ---------------------------------------------------------------------------

const secItems: AggregatedItem[] = [
  {
    id: 'sec-ex-1', topic: 'security', topicLabel: 'Security',
    title: 'CVE-2026-9999 zero-day auth bypass',
    source: 'The Hacker News', sourceDomain: 'thehackernews.com', sourceUrl: 'https://thehackernews.com',
    url: 'https://thehackernews.com/2026/cve-2026-9999-zero-day',
    tier: 'security-news', publishedAt: '2026-06-11T11:35:00.000Z',
    summaryHint: 'CVE-2026-9999 actively exploited in the wild zero-day authentication bypass in widely-used library',
    interaction: makeInteraction(8), clusterId: 'sec-exploit',
    fingerprint: 'thehackernews.com::cve-2026-9999-zero-day',
  },
  {
    id: 'sec-ex-2', topic: 'security', topicLabel: 'Security',
    title: 'CVE-2026-9999 exploit confirmed patched',
    source: 'Bleeping Computer', sourceDomain: 'bleepingcomputer.com', sourceUrl: 'https://bleepingcomputer.com',
    url: 'https://bleepingcomputer.com/news/cve-2026-9999',
    tier: 'security-news', publishedAt: '2026-06-11T11:40:00.000Z',
    summaryHint: 'Confirmation of actively exploited in the wild zero-day CVE-2026-9999, patch available',
    interaction: makeInteraction(8), clusterId: 'sec-exploit',
    fingerprint: 'bleepingcomputer.com::cve-2026-9999-exploit',
  },
  {
    id: 'sec-ex-3', topic: 'security', topicLabel: 'Security',
    title: 'NVD entry CVE-2026-9999 critical',
    source: 'NVD/NIST', sourceDomain: 'nvd.nist.gov', sourceUrl: 'https://nvd.nist.gov',
    url: 'https://nvd.nist.gov/vuln/detail/CVE-2026-9999',
    tier: 'primary', publishedAt: '2026-06-11T11:25:00.000Z',
    summaryHint: 'Official NVD record for CVE-2026-9999 with active exploitation status and patch advisory',
    interaction: makeInteraction(8), clusterId: 'sec-exploit',
    fingerprint: 'nvd.nist.gov::cve-2026-9999',
  },

  {
    id: 'sec-cr-1', topic: 'security', topicLabel: 'Security',
    title: 'Kubernetes admission controller RCE',
    source: 'The Hacker News', sourceDomain: 'thehackernews.com', sourceUrl: 'https://thehackernews.com',
    url: 'https://thehackernews.com/2026/kubernetes-rce',
    tier: 'security-news', publishedAt: '2026-06-11T09:55:00.000Z',
    summaryHint: 'Critical severity remote code execution vulnerability in Kubernetes cluster admission controller allows takeover',
    interaction: makeInteraction(5), clusterId: 'sec-critical',
    fingerprint: 'thehackernews.com::kubernetes-rce-critical',
  },
  {
    id: 'sec-cr-2', topic: 'security', topicLabel: 'Security',
    title: 'Kubernetes k8s RCE flaw details',
    source: 'Bleeping Computer', sourceDomain: 'bleepingcomputer.com', sourceUrl: 'https://bleepingcomputer.com',
    url: 'https://bleepingcomputer.com/news/kubernetes-rce-2026',
    tier: 'security-news', publishedAt: '2026-06-11T10:00:00.000Z',
    summaryHint: 'Critical severity Kubernetes k8s flaw: remote code execution details and patch guidance',
    interaction: makeInteraction(5), clusterId: 'sec-critical',
    fingerprint: 'bleepingcomputer.com::kubernetes-rce-2026',
  },
  {
    id: 'sec-cr-3', topic: 'security', topicLabel: 'Security',
    title: 'Critical k8s CVE patches available',
    source: 'Dark Reading', sourceDomain: 'darkreading.com', sourceUrl: 'https://darkreading.com',
    url: 'https://darkreading.com/kubernetes-cve-2026',
    tier: 'security-news', publishedAt: '2026-06-11T10:05:00.000Z',
    summaryHint: 'Critical severity k8s CVE patched across supported Kubernetes versions — upgrade immediately',
    interaction: makeInteraction(5), clusterId: 'sec-critical',
    fingerprint: 'darkreading.com::kubernetes-cve-2026',
  },
  {
    id: 'sec-cr-4', topic: 'security', topicLabel: 'Security',
    title: 'Kubernetes security advisory RCE webhook',
    source: 'Kubernetes', sourceDomain: 'kubernetes.io', sourceUrl: 'https://kubernetes.io',
    url: 'https://kubernetes.io/blog/2026/security-advisory-rce',
    tier: 'primary', publishedAt: '2026-06-11T09:50:00.000Z',
    summaryHint: 'Official Kubernetes security advisory for critical remote code execution in admission webhook',
    interaction: makeInteraction(5), clusterId: 'sec-critical',
    fingerprint: 'kubernetes.io::security-advisory-rce-2026',
  },

  {
    id: 'sec-md-1', topic: 'security', topicLabel: 'Security',
    title: 'OpenSSL patches certificate validation flaw',
    source: 'The Hacker News', sourceDomain: 'thehackernews.com', sourceUrl: 'https://thehackernews.com',
    url: 'https://thehackernews.com/2026/openssl-patch',
    tier: 'security-news', publishedAt: '2026-06-11T07:50:00.000Z',
    summaryHint: 'OpenSSL security update patches certificate validation flaw in TLS handling',
    interaction: makeInteraction(2), clusterId: 'sec-medium',
    fingerprint: 'thehackernews.com::openssl-patch-2026',
  },
  {
    id: 'sec-md-2', topic: 'security', topicLabel: 'Security',
    title: 'OpenSSL 3.4.2 security release',
    source: 'Security Week', sourceDomain: 'securityweek.com', sourceUrl: 'https://securityweek.com',
    url: 'https://securityweek.com/openssl-3-4-2',
    tier: 'security-news', publishedAt: '2026-06-11T07:45:00.000Z',
    summaryHint: 'OpenSSL 3.4.2 release fixes TLS certificate validation security issues',
    interaction: makeInteraction(2), clusterId: 'sec-medium',
    fingerprint: 'securityweek.com::openssl-3-4-2',
  },

  {
    id: 'sec-lw-1', topic: 'security', topicLabel: 'Security',
    title: 'Weekly advisory digest minor patches',
    source: 'Security Week', sourceDomain: 'securityweek.com', sourceUrl: 'https://securityweek.com',
    url: 'https://securityweek.com/weekly-advisory-2026-06-11',
    tier: 'security-news', publishedAt: '2026-06-11T05:00:00.000Z',
    summaryHint: 'Roundup of minor security patches across popular open source libraries',
    interaction: makeInteraction(0), clusterId: 'sec-low',
    fingerprint: 'securityweek.com::weekly-advisory-2026-06-11',
  },
];

// ---------------------------------------------------------------------------
// DevOps items
//
// devops-alpha: 3 items — 1×primary, 2×technical-news; age ~2h
//   summaryHint: "kubernetes", "k8s", "platform engineering", "cloud-native" → AI_PLATFORM_PATTERN; T≈0.30
//   S≈0.94, C≈0.63 (3 owners), E=0.80
//
// devops-beta: 2 items — 2×technical-news; age ~3h
//   summaryHint: "opentelemetry" → AI_PLATFORM_PATTERN; T≈0.30
//   S≈0.70, C≈0.50, E=0.40
//
// devops-gamma: 2 items — 2×technical-news; age ~5h
//   summaryHint: "ebpf" → AI_PLATFORM_PATTERN; T≈0.30
//   S≈0.70, C≈0.50, E=0.40
//
// devops-delta: 1 item — 1×news; age ~7h (lowest devops score)
//   T≈0.20
// ---------------------------------------------------------------------------

const devopsItems: AggregatedItem[] = [
  {
    id: 'dv-a-1', topic: 'devops', topicLabel: 'DevOps',
    title: 'Kubernetes 1.31 cloud-native features land',
    source: 'Kubernetes', sourceDomain: 'kubernetes.io', sourceUrl: 'https://kubernetes.io',
    url: 'https://kubernetes.io/blog/2026/kubernetes-1-31',
    tier: 'primary', publishedAt: '2026-06-11T09:50:00.000Z',
    summaryHint: 'Kubernetes 1.31 release ships cloud-native platform engineering improvements and k8s gateway API GA',
    interaction: makeInteraction(4), clusterId: 'devops-alpha',
    fingerprint: 'kubernetes.io::kubernetes-1-31-release',
  },
  {
    id: 'dv-a-2', topic: 'devops', topicLabel: 'DevOps',
    title: 'k8s 1.31 platform engineering breakdown',
    source: 'The New Stack', sourceDomain: 'thenewstack.io', sourceUrl: 'https://thenewstack.io',
    url: 'https://thenewstack.io/kubernetes-1-31-platform-engineering',
    tier: 'technical-news', publishedAt: '2026-06-11T10:00:00.000Z',
    summaryHint: 'k8s 1.31 cloud-native platform engineering feature breakdown for workload scheduling',
    interaction: makeInteraction(4), clusterId: 'devops-alpha',
    fingerprint: 'thenewstack.io::k8s-1-31-platform',
  },
  {
    id: 'dv-a-3', topic: 'devops', topicLabel: 'DevOps',
    title: 'Kubernetes 1.31 hands-on cloud features',
    source: 'InfoQ', sourceDomain: 'infoq.com', sourceUrl: 'https://infoq.com',
    url: 'https://infoq.com/articles/kubernetes-1-31',
    tier: 'technical-news', publishedAt: '2026-06-11T10:10:00.000Z',
    summaryHint: 'Hands-on review of Kubernetes 1.31 cloud-native features and k8s platform tooling',
    interaction: makeInteraction(4), clusterId: 'devops-alpha',
    fingerprint: 'infoq.com::kubernetes-1-31-hands-on',
  },

  {
    id: 'dv-b-1', topic: 'devops', topicLabel: 'DevOps',
    title: 'OpenTelemetry 1.9 metrics API stable',
    source: 'The New Stack', sourceDomain: 'thenewstack.io', sourceUrl: 'https://thenewstack.io',
    url: 'https://thenewstack.io/opentelemetry-1-9-metrics',
    tier: 'technical-news', publishedAt: '2026-06-11T08:50:00.000Z',
    summaryHint: 'OpenTelemetry 1.9 stabilizes new metrics API for cloud observability pipelines and tracing',
    interaction: makeInteraction(2), clusterId: 'devops-beta',
    fingerprint: 'thenewstack.io::opentelemetry-1-9-metrics',
  },
  {
    id: 'dv-b-2', topic: 'devops', topicLabel: 'DevOps',
    title: 'OpenTelemetry adoption tracing patterns',
    source: 'InfoQ', sourceDomain: 'infoq.com', sourceUrl: 'https://infoq.com',
    url: 'https://infoq.com/articles/opentelemetry-adoption',
    tier: 'technical-news', publishedAt: '2026-06-11T08:45:00.000Z',
    summaryHint: 'OpenTelemetry adoption patterns for distributed tracing and observability in production',
    interaction: makeInteraction(2), clusterId: 'devops-beta',
    fingerprint: 'infoq.com::opentelemetry-adoption',
  },

  {
    id: 'dv-g-1', topic: 'devops', topicLabel: 'DevOps',
    title: 'eBPF kernel tracing new tooling',
    source: 'The New Stack', sourceDomain: 'thenewstack.io', sourceUrl: 'https://thenewstack.io',
    url: 'https://thenewstack.io/ebpf-network-observability',
    tier: 'technical-news', publishedAt: '2026-06-11T06:50:00.000Z',
    summaryHint: 'eBPF-based network observability tooling for kernel-level tracing and performance profiling',
    interaction: makeInteraction(2), clusterId: 'devops-gamma',
    fingerprint: 'thenewstack.io::ebpf-network-observability',
  },
  {
    id: 'dv-g-2', topic: 'devops', topicLabel: 'DevOps',
    title: 'eBPF guide for SRE tracing',
    source: 'InfoQ', sourceDomain: 'infoq.com', sourceUrl: 'https://infoq.com',
    url: 'https://infoq.com/articles/ebpf-sre-guide',
    tier: 'technical-news', publishedAt: '2026-06-11T06:45:00.000Z',
    summaryHint: 'Practical eBPF guide for SRE teams covering tracing and performance profiling in production',
    interaction: makeInteraction(2), clusterId: 'devops-gamma',
    fingerprint: 'infoq.com::ebpf-sre-guide',
  },

  {
    id: 'dv-d-1', topic: 'devops', topicLabel: 'DevOps',
    title: 'Ops teams tackle toil 2026',
    source: 'TechRepublic', sourceDomain: 'techrepublic.com', sourceUrl: 'https://techrepublic.com',
    url: 'https://techrepublic.com/ops-toil-2026',
    tier: 'news', publishedAt: '2026-06-11T04:50:00.000Z',
    summaryHint: 'How infrastructure teams are managing operational toil and automation challenges in 2026',
    interaction: makeInteraction(0), clusterId: 'devops-delta',
    fingerprint: 'techrepublic.com::ops-toil-2026',
  },
];

// ---------------------------------------------------------------------------
// Clusters — headlines kept ≤ 7 words (below MAX_VERBATIM_NGRAM=8)
// ---------------------------------------------------------------------------

const aiClusters: Cluster[] = [
  {
    clusterId: 'ai-alpha',
    topic: 'ai', topicLabel: 'AI',
    headline: 'GPT-5 ships with GPU inference',
    memberIds: ['ai-a-1', 'ai-a-2', 'ai-a-3', 'ai-a-4'],
    sourceCount: 4,
    distinctDomains: 4,
    tierHistogram: { primary: 1, paper: 1, 'technical-news': 2 },
    earliestPublishedAt: '2026-06-11T10:30:00.000Z',
    latestPublishedAt: '2026-06-11T11:10:00.000Z',
  },
  {
    clusterId: 'ai-beta',
    topic: 'ai', topicLabel: 'AI',
    headline: 'LLM benchmark results raise interest',
    memberIds: ['ai-b-1', 'ai-b-2', 'ai-b-3'],
    sourceCount: 3,
    distinctDomains: 3,
    tierHistogram: { news: 3 },
    earliestPublishedAt: '2026-06-11T08:30:00.000Z',
    latestPublishedAt: '2026-06-11T09:00:00.000Z',
  },
  {
    clusterId: 'ai-gamma',
    topic: 'ai', topicLabel: 'AI',
    headline: 'Enterprise AI adoption rises in 2026',
    memberIds: ['ai-c-1', 'ai-c-2'],
    sourceCount: 2,
    distinctDomains: 2,
    tierHistogram: { news: 2 },
    earliestPublishedAt: '2026-06-11T06:45:00.000Z',
    latestPublishedAt: '2026-06-11T06:50:00.000Z',
  },
  {
    clusterId: 'ai-delta',
    topic: 'ai', topicLabel: 'AI',
    headline: 'AI startup funding Q2 update',
    memberIds: ['ai-d-1'],
    sourceCount: 1,
    distinctDomains: 1,
    tierHistogram: { news: 1 },
    earliestPublishedAt: '2026-06-11T03:50:00.000Z',
    latestPublishedAt: '2026-06-11T03:50:00.000Z',
  },
];

const secClusters: Cluster[] = [
  {
    clusterId: 'sec-exploit',
    topic: 'security', topicLabel: 'Security',
    headline: 'CVE-2026-9999 zero-day exploited',
    memberIds: ['sec-ex-1', 'sec-ex-2', 'sec-ex-3'],
    sourceCount: 3,
    distinctDomains: 3,
    tierHistogram: { 'security-news': 2, primary: 1 },
    earliestPublishedAt: '2026-06-11T11:25:00.000Z',
    latestPublishedAt: '2026-06-11T11:40:00.000Z',
  },
  {
    clusterId: 'sec-critical',
    topic: 'security', topicLabel: 'Security',
    headline: 'Critical Kubernetes RCE vulnerability patched',
    memberIds: ['sec-cr-1', 'sec-cr-2', 'sec-cr-3', 'sec-cr-4'],
    sourceCount: 4,
    distinctDomains: 4,
    tierHistogram: { 'security-news': 3, primary: 1 },
    earliestPublishedAt: '2026-06-11T09:50:00.000Z',
    latestPublishedAt: '2026-06-11T10:05:00.000Z',
  },
  {
    clusterId: 'sec-medium',
    topic: 'security', topicLabel: 'Security',
    headline: 'OpenSSL certificate flaw patched',
    memberIds: ['sec-md-1', 'sec-md-2'],
    sourceCount: 2,
    distinctDomains: 2,
    tierHistogram: { 'security-news': 2 },
    earliestPublishedAt: '2026-06-11T07:45:00.000Z',
    latestPublishedAt: '2026-06-11T07:50:00.000Z',
  },
  {
    clusterId: 'sec-low',
    topic: 'security', topicLabel: 'Security',
    headline: 'Weekly security advisory digest',
    memberIds: ['sec-lw-1'],
    sourceCount: 1,
    distinctDomains: 1,
    tierHistogram: { 'security-news': 1 },
    earliestPublishedAt: '2026-06-11T05:00:00.000Z',
    latestPublishedAt: '2026-06-11T05:00:00.000Z',
  },
];

const devopsClusters: Cluster[] = [
  {
    clusterId: 'devops-alpha',
    topic: 'devops', topicLabel: 'DevOps',
    headline: 'Kubernetes 1.31 platform features land',
    memberIds: ['dv-a-1', 'dv-a-2', 'dv-a-3'],
    sourceCount: 3,
    distinctDomains: 3,
    tierHistogram: { primary: 1, 'technical-news': 2 },
    earliestPublishedAt: '2026-06-11T09:50:00.000Z',
    latestPublishedAt: '2026-06-11T10:10:00.000Z',
  },
  {
    clusterId: 'devops-beta',
    topic: 'devops', topicLabel: 'DevOps',
    headline: 'OpenTelemetry 1.9 metrics API stable',
    memberIds: ['dv-b-1', 'dv-b-2'],
    sourceCount: 2,
    distinctDomains: 2,
    tierHistogram: { 'technical-news': 2 },
    earliestPublishedAt: '2026-06-11T08:45:00.000Z',
    latestPublishedAt: '2026-06-11T08:50:00.000Z',
  },
  {
    clusterId: 'devops-gamma',
    topic: 'devops', topicLabel: 'DevOps',
    headline: 'eBPF observability tools gain traction',
    memberIds: ['dv-g-1', 'dv-g-2'],
    sourceCount: 2,
    distinctDomains: 2,
    tierHistogram: { 'technical-news': 2 },
    earliestPublishedAt: '2026-06-11T06:45:00.000Z',
    latestPublishedAt: '2026-06-11T06:50:00.000Z',
  },
  {
    clusterId: 'devops-delta',
    topic: 'devops', topicLabel: 'DevOps',
    headline: 'Ops toil reduction strategies 2026',
    memberIds: ['dv-d-1'],
    sourceCount: 1,
    distinctDomains: 1,
    tierHistogram: { news: 1 },
    earliestPublishedAt: '2026-06-11T04:50:00.000Z',
    latestPublishedAt: '2026-06-11T04:50:00.000Z',
  },
];

// ---------------------------------------------------------------------------
// Rev 3: ExtractedFacts — deterministic, analytically designed
//
// Facts for ai-alpha: 3 facts including 2 with quantity fields (for ChartBlock).
// Facts for sec-critical: 2 corroborated facts (for provenance gate exercise).
// Facts for sec-exploit: 2 corroborated facts.
// Facts for devops-alpha: 2 facts including 1 with quantity (enhancement count).
//
// All facts have provenance[] length >= 1 (contract invariant).
// corroboration = distinct source domains in provenance[].
// ---------------------------------------------------------------------------

const DET_PROVIDER = {
  provider: 'deterministic' as const,
  model: 'rules/v1',
  status: 'fallback' as const,
  generatedAt: '2026-06-11T11:48:00.000Z',
};

export const GOLDEN_FACTS: Record<string, ExtractedFact[]> = {
  'ai-alpha': [
    {
      id: 'fact-ai-alpha-1',
      topic: 'ai',
      clusterId: 'ai-alpha',
      statement: 'GPT-5 achieves top scores on standard inference benchmarks',
      quantity: { metric: 'MMLU score', value: 94.2, unit: '%', asOf: '2026-06-11' },
      entities: ['GPT-5', 'OpenAI', 'MMLU'],
      provenance: [
        { sourceDocId: 'doc-ai-a-1', sourceDomain: 'openai.com', url: 'https://openai.com/research/gpt-5' },
        { sourceDocId: 'doc-ai-a-2', sourceDomain: 'arxiv.org', url: 'https://arxiv.org/abs/2606.00001' },
      ],
      corroboration: 2,
      confidence: 'high',
      extractedBy: DET_PROVIDER,
    },
    {
      id: 'fact-ai-alpha-2',
      topic: 'ai',
      clusterId: 'ai-alpha',
      statement: 'GPT-5 inference latency reduced versus prior generation',
      quantity: { metric: 'latency reduction', value: 40, unit: '%' },
      entities: ['GPT-5', 'inference latency', 'GPU'],
      provenance: [
        { sourceDocId: 'doc-ai-a-3', sourceDomain: 'thenewstack.io', url: 'https://thenewstack.io/gpt-5-deep-learning-infrastructure' },
        { sourceDocId: 'doc-ai-a-4', sourceDomain: 'infoq.com', url: 'https://infoq.com/news/gpt-5-benchmark' },
      ],
      corroboration: 2,
      confidence: 'high',
      extractedBy: DET_PROVIDER,
    },
    {
      id: 'fact-ai-alpha-3',
      topic: 'ai',
      clusterId: 'ai-alpha',
      statement: 'GPT-5 training uses large GPU cluster resources',
      entities: ['GPT-5', 'GPU', 'foundation model', 'training'],
      provenance: [
        { sourceDocId: 'doc-ai-a-1', sourceDomain: 'openai.com', url: 'https://openai.com/research/gpt-5' },
      ],
      corroboration: 1,
      confidence: 'medium',
      extractedBy: DET_PROVIDER,
    },
  ],
  'sec-critical': [
    {
      id: 'fact-sec-cr-1',
      topic: 'security',
      clusterId: 'sec-critical',
      statement: 'Critical Kubernetes RCE vulnerability affects admission webhook handler',
      entities: ['Kubernetes', 'CVE', 'RCE', 'admission webhook'],
      provenance: [
        { sourceDocId: 'doc-sec-cr-4', sourceDomain: 'kubernetes.io', url: 'https://kubernetes.io/blog/2026/security-advisory-rce' },
        { sourceDocId: 'doc-sec-cr-1', sourceDomain: 'thehackernews.com', url: 'https://thehackernews.com/2026/kubernetes-rce' },
        { sourceDocId: 'doc-sec-cr-2', sourceDomain: 'bleepingcomputer.com', url: 'https://bleepingcomputer.com/news/kubernetes-rce-2026' },
      ],
      corroboration: 3,
      confidence: 'high',
      extractedBy: DET_PROVIDER,
    },
    {
      id: 'fact-sec-cr-2',
      topic: 'security',
      clusterId: 'sec-critical',
      statement: 'Kubernetes 1.28 through 1.31 affected by RCE flaw',
      entities: ['Kubernetes', 'k8s', '1.28', '1.31', 'patch'],
      provenance: [
        { sourceDocId: 'doc-sec-cr-3', sourceDomain: 'darkreading.com', url: 'https://darkreading.com/kubernetes-cve-2026' },
        { sourceDocId: 'doc-sec-cr-4', sourceDomain: 'kubernetes.io', url: 'https://kubernetes.io/blog/2026/security-advisory-rce' },
      ],
      corroboration: 2,
      confidence: 'high',
      extractedBy: DET_PROVIDER,
    },
  ],
  'sec-exploit': [
    {
      id: 'fact-sec-ex-1',
      topic: 'security',
      clusterId: 'sec-exploit',
      statement: 'CVE-2026-9999 is actively exploited as a zero-day in authentication libraries',
      entities: ['CVE-2026-9999', 'zero-day', 'authentication bypass'],
      provenance: [
        { sourceDocId: 'doc-sec-ex-3', sourceDomain: 'nvd.nist.gov', url: 'https://nvd.nist.gov/vuln/detail/CVE-2026-9999' },
        { sourceDocId: 'doc-sec-ex-1', sourceDomain: 'thehackernews.com', url: 'https://thehackernews.com/2026/cve-2026-9999-zero-day' },
      ],
      corroboration: 2,
      confidence: 'high',
      extractedBy: DET_PROVIDER,
    },
    {
      id: 'fact-sec-ex-2',
      topic: 'security',
      clusterId: 'sec-exploit',
      statement: 'Patch for CVE-2026-9999 is available and vendors advise immediate upgrade',
      entities: ['CVE-2026-9999', 'patch', 'remediation'],
      provenance: [
        { sourceDocId: 'doc-sec-ex-2', sourceDomain: 'bleepingcomputer.com', url: 'https://bleepingcomputer.com/news/cve-2026-9999' },
        { sourceDocId: 'doc-sec-ex-3', sourceDomain: 'nvd.nist.gov', url: 'https://nvd.nist.gov/vuln/detail/CVE-2026-9999' },
      ],
      corroboration: 2,
      confidence: 'high',
      extractedBy: DET_PROVIDER,
    },
  ],
  'devops-alpha': [
    {
      id: 'fact-dv-a-1',
      topic: 'devops',
      clusterId: 'devops-alpha',
      statement: 'Kubernetes 1.31 ships platform engineering and gateway API enhancements',
      quantity: { metric: 'enhancements', value: 47, unit: 'features' },
      entities: ['Kubernetes', 'k8s', '1.31', 'Gateway API', 'platform engineering'],
      provenance: [
        { sourceDocId: 'doc-dv-a-1', sourceDomain: 'kubernetes.io', url: 'https://kubernetes.io/blog/2026/kubernetes-1-31' },
        { sourceDocId: 'doc-dv-a-2', sourceDomain: 'thenewstack.io', url: 'https://thenewstack.io/kubernetes-1-31-platform-engineering' },
      ],
      corroboration: 2,
      confidence: 'high',
      extractedBy: DET_PROVIDER,
    },
    {
      id: 'fact-dv-a-2',
      topic: 'devops',
      clusterId: 'devops-alpha',
      statement: 'Gateway API v1.3.0 reaches GA status in Kubernetes 1.31',
      entities: ['Gateway API', 'GA', 'Kubernetes 1.31'],
      provenance: [
        { sourceDocId: 'doc-dv-a-1', sourceDomain: 'kubernetes.io', url: 'https://kubernetes.io/blog/2026/kubernetes-1-31' },
      ],
      corroboration: 1,
      confidence: 'medium',
      extractedBy: DET_PROVIDER,
    },
  ],
};

// ---------------------------------------------------------------------------
// Rev 3: SourceDocuments — one per significant AggregatedItem in key clusters.
// These back the ExtractedFacts above and propagate sourceDocIds downstream.
// ---------------------------------------------------------------------------

const aiDocuments: SourceDocument[] = [
  { id: 'doc-ai-a-1', url: 'https://openai.com/research/gpt-5', source: 'OpenAI', sourceDomain: 'openai.com', tier: 'primary', title: 'GPT-5 ships with GPU improvements', publishedAt: '2026-06-11T10:50:00.000Z', fetchedAt: '2026-06-11T11:48:00.000Z', extraction: 'full', accessPolicy: 'allowed', wordCount: 1420, lang: 'en', contentHash: 'sha256-ai-a-1' },
  { id: 'doc-ai-a-2', url: 'https://arxiv.org/abs/2606.00001', source: 'arXiv', sourceDomain: 'arxiv.org', tier: 'paper', title: 'Scaling LLM inference on GPU clusters', publishedAt: '2026-06-11T10:30:00.000Z', fetchedAt: '2026-06-11T11:48:00.000Z', extraction: 'full', accessPolicy: 'allowed', wordCount: 8300, lang: 'en', contentHash: 'sha256-ai-a-2' },
  { id: 'doc-ai-a-3', url: 'https://thenewstack.io/gpt-5-deep-learning-infrastructure', source: 'The New Stack', sourceDomain: 'thenewstack.io', tier: 'technical-news', title: 'GPT-5 deep learning infrastructure view', publishedAt: '2026-06-11T11:00:00.000Z', fetchedAt: '2026-06-11T11:48:00.000Z', extraction: 'snippet', accessPolicy: 'allowed', wordCount: 980, lang: 'en', contentHash: 'sha256-ai-a-3' },
  { id: 'doc-ai-a-4', url: 'https://infoq.com/news/gpt-5-benchmark', source: 'InfoQ', sourceDomain: 'infoq.com', tier: 'technical-news', title: 'GPT-5 benchmark vs foundation models', publishedAt: '2026-06-11T11:10:00.000Z', fetchedAt: '2026-06-11T11:48:00.000Z', extraction: 'snippet', accessPolicy: 'allowed', wordCount: 750, lang: 'en', contentHash: 'sha256-ai-a-4' },
];

const secDocuments: SourceDocument[] = [
  { id: 'doc-sec-ex-1', url: 'https://thehackernews.com/2026/cve-2026-9999-zero-day', source: 'The Hacker News', sourceDomain: 'thehackernews.com', tier: 'security-news', title: 'CVE-2026-9999 zero-day auth bypass', publishedAt: '2026-06-11T11:35:00.000Z', fetchedAt: '2026-06-11T11:48:00.000Z', extraction: 'full', accessPolicy: 'allowed', wordCount: 620, lang: 'en', contentHash: 'sha256-sec-ex-1' },
  { id: 'doc-sec-ex-2', url: 'https://bleepingcomputer.com/news/cve-2026-9999', source: 'Bleeping Computer', sourceDomain: 'bleepingcomputer.com', tier: 'security-news', title: 'CVE-2026-9999 exploit confirmed patched', publishedAt: '2026-06-11T11:40:00.000Z', fetchedAt: '2026-06-11T11:48:00.000Z', extraction: 'full', accessPolicy: 'allowed', wordCount: 540, lang: 'en', contentHash: 'sha256-sec-ex-2' },
  { id: 'doc-sec-ex-3', url: 'https://nvd.nist.gov/vuln/detail/CVE-2026-9999', source: 'NVD/NIST', sourceDomain: 'nvd.nist.gov', tier: 'primary', title: 'NVD entry CVE-2026-9999 critical', publishedAt: '2026-06-11T11:25:00.000Z', fetchedAt: '2026-06-11T11:48:00.000Z', extraction: 'full', accessPolicy: 'allowed', wordCount: 280, lang: 'en', contentHash: 'sha256-sec-ex-3' },
  { id: 'doc-sec-cr-1', url: 'https://thehackernews.com/2026/kubernetes-rce', source: 'The Hacker News', sourceDomain: 'thehackernews.com', tier: 'security-news', title: 'Kubernetes admission controller RCE', publishedAt: '2026-06-11T09:55:00.000Z', fetchedAt: '2026-06-11T11:48:00.000Z', extraction: 'full', accessPolicy: 'allowed', wordCount: 810, lang: 'en', contentHash: 'sha256-sec-cr-1' },
  { id: 'doc-sec-cr-2', url: 'https://bleepingcomputer.com/news/kubernetes-rce-2026', source: 'Bleeping Computer', sourceDomain: 'bleepingcomputer.com', tier: 'security-news', title: 'Kubernetes k8s RCE flaw details', publishedAt: '2026-06-11T10:00:00.000Z', fetchedAt: '2026-06-11T11:48:00.000Z', extraction: 'full', accessPolicy: 'allowed', wordCount: 670, lang: 'en', contentHash: 'sha256-sec-cr-2' },
  { id: 'doc-sec-cr-3', url: 'https://darkreading.com/kubernetes-cve-2026', source: 'Dark Reading', sourceDomain: 'darkreading.com', tier: 'security-news', title: 'Critical k8s CVE patches available', publishedAt: '2026-06-11T10:05:00.000Z', fetchedAt: '2026-06-11T11:48:00.000Z', extraction: 'snippet', accessPolicy: 'allowed', wordCount: 420, lang: 'en', contentHash: 'sha256-sec-cr-3' },
  { id: 'doc-sec-cr-4', url: 'https://kubernetes.io/blog/2026/security-advisory-rce', source: 'Kubernetes', sourceDomain: 'kubernetes.io', tier: 'primary', title: 'Kubernetes security advisory RCE webhook', publishedAt: '2026-06-11T09:50:00.000Z', fetchedAt: '2026-06-11T11:48:00.000Z', extraction: 'full', accessPolicy: 'allowed', wordCount: 920, lang: 'en', contentHash: 'sha256-sec-cr-4' },
];

const devopsDocuments: SourceDocument[] = [
  { id: 'doc-dv-a-1', url: 'https://kubernetes.io/blog/2026/kubernetes-1-31', source: 'Kubernetes', sourceDomain: 'kubernetes.io', tier: 'primary', title: 'Kubernetes 1.31 cloud-native features land', publishedAt: '2026-06-11T09:50:00.000Z', fetchedAt: '2026-06-11T11:48:00.000Z', extraction: 'full', accessPolicy: 'allowed', wordCount: 2100, lang: 'en', contentHash: 'sha256-dv-a-1' },
  { id: 'doc-dv-a-2', url: 'https://thenewstack.io/kubernetes-1-31-platform-engineering', source: 'The New Stack', sourceDomain: 'thenewstack.io', tier: 'technical-news', title: 'k8s 1.31 platform engineering breakdown', publishedAt: '2026-06-11T10:00:00.000Z', fetchedAt: '2026-06-11T11:48:00.000Z', extraction: 'snippet', accessPolicy: 'allowed', wordCount: 1150, lang: 'en', contentHash: 'sha256-dv-a-2' },
];

// ---------------------------------------------------------------------------
// The golden AggregationArtifact — Rev 3 with facts and source documents
// ---------------------------------------------------------------------------

export const GOLDEN_AGGREGATION: AggregationArtifact = {
  schemaVersion: SCHEMA_VERSION,
  contractRevision: CONTRACT_REVISION,
  artifact: 'aggregation',
  runId: 'agg-golden-2026-06-11T06:00Z',
  upstreamRunId: null,
  generatedAt: '2026-06-11T11:48:00.000Z',
  cycle: CYCLE,
  topics: TOPICS,
  warnings: [],
  data: {
    itemsByTopic: {
      ai: aiItems,
      security: secItems,
      devops: devopsItems,
    },
    clustersByTopic: {
      ai: aiClusters,
      security: secClusters,
      devops: devopsClusters,
    },
    coverageByTopic: {
      ai: {
        sourcesConfigured: 25,
        sourcesQueried: 25,
        sourcesResponded: 22,
        distinctDomains: 8,
        degraded: false,
      },
      security: {
        sourcesConfigured: 20,
        sourcesQueried: 20,
        sourcesResponded: 18,
        distinctDomains: 6,
        degraded: false,
      },
      devops: {
        sourcesConfigured: 22,
        sourcesQueried: 22,
        sourcesResponded: 20,
        distinctDomains: 5,
        degraded: false,
      },
    },
    // Rev 3: source documents backing ExtractedFacts (supports sourceDocIds passthrough)
    documentsByTopic: {
      ai: aiDocuments,
      security: secDocuments,
      devops: devopsDocuments,
    },
    // Rev 3: extracted facts per cluster (drives fact-level corroboration + ChartBlock)
    factsByCluster: GOLDEN_FACTS,
  },
};

import type { CycleMeta, TopicMeta } from '../../vendor/ardur-ranking-engine/src/contracts.ts';

/**
 * Fixed reference time: 10 minutes before the cycle window closes.
 * We deliberately avoid the exact windowEnd so nextRefreshAt > generatedAt
 * in tests that verify cycle math.
 */
export const FIXED_NOW = new Date('2026-06-11T11:50:00.000Z');

export const CYCLE: CycleMeta = {
  id: '2026-06-11T06:00Z',
  windowStart: '2026-06-11T06:00:00.000Z',
  windowEnd: '2026-06-11T12:00:00.000Z',
};

export const TOPICS: TopicMeta[] = [
  { id: 'ai', label: 'AI', description: 'AI and machine learning news' },
  { id: 'security', label: 'Security', description: 'Security advisories and vulnerabilities' },
  { id: 'devops', label: 'DevOps', description: 'DevOps and cloud infrastructure' },
];

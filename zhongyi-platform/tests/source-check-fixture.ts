import type { ManagedSource, SourceCheckInput } from '../shared/contracts.js';
import { sourceDigest, SOURCE_DOMAINS } from '../server/source-check-values.js';
export const sourceCheckInput = (source: ManagedSource): SourceCheckInput => ({ sourceRevision: source.revision, sourceDigest: sourceDigest(source), decision: 'verified', evidenceKind: 'test-fixture', ingredientIds: ['huang-qi'],
  domains: [...SOURCE_DOMAINS], authority: 'official', checkedAt: new Date(Date.now() - 60000).toISOString(), validUntil: new Date(Date.now() + 86400000).toISOString(), evidenceReference: 'engineering-fixture-only', comment: '工程测试来源核验，非真实资料查证或专业批准。', verificationConfirmed: true });

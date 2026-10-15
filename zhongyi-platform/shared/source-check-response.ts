// Structural and contextual validation only. Source truth, digest computation,
// account authority, professional eligibility and release gates stay server-side.
import type { PublicationPreflight, SessionInfo, SourceCheck, SourceCheckDetail, SourceCheckInput } from './contracts.js';
import { choice, date, digest, id, invalid, list, literal, number, object, parseManagedSource, text, unique } from './workflow-response.js';

const domains = ['identity', 'edible_part', 'processing', 'safety_boundary', 'directory_scope'] as const;
const checkReasons = ['source_check_missing', 'source_changed', 'source_check_returned', 'source_check_revoked', 'source_check_expired', 'source_check_authority_changed', 'source_check_test_fixture'] as const;
const sourceReasons = [...checkReasons, 'source_check_required', 'source_scope_mismatch'] as const;
const preflightReasons = ['content_missing', 'editorial_review_required', 'professional_review_required', 'education_fields_incomplete', 'source_references_required', 'source_checks_required', 'source_domains_incomplete', 'official_directory_scope_required'] as const;
function boolean(value: unknown): boolean { return typeof value === 'boolean' ? value : invalid(); }
function reasons<T extends string>(value: unknown, options: readonly T[]): T[] {
  const result = list(value, entry => choice(entry, options), options.length); unique(result); return result;
}
export function parseSourceCheck(value: unknown, sourceId?: string): SourceCheck {
  const item = object(value, 'sourceRevision sourceDigest decision evidenceKind ingredientIds domains authority checkedAt validUntil evidenceReference comment verificationConfirmed sourceId version actorId actor accountRevision recordedAt digest');
  const result: SourceCheck = {
    sourceId: id(item.sourceId), sourceRevision: number(item.sourceRevision), sourceDigest: digest(item.sourceDigest), version: number(item.version),
    decision: choice(item.decision, ['verified', 'return', 'revoke']), evidenceKind: choice(item.evidenceKind, ['manual-check', 'test-fixture']),
    ingredientIds: list(item.ingredientIds, id, 200), domains: reasons(item.domains, domains), authority: choice(item.authority, ['official', 'research', 'reference']),
    checkedAt: date(item.checkedAt), validUntil: date(item.validUntil), evidenceReference: text(item.evidenceReference, 200), comment: text(item.comment, 1000),
    verificationConfirmed: boolean(item.verificationConfirmed), actorId: id(item.actorId), actor: text(item.actor, 40), accountRevision: number(item.accountRevision),
    recordedAt: date(item.recordedAt), digest: digest(item.digest),
  };
  unique(result.ingredientIds);
  if ((sourceId !== undefined && result.sourceId !== sourceId) || !result.ingredientIds.length || !result.domains.length ||
      Date.parse(result.validUntil) <= Date.parse(result.checkedAt) || (result.decision === 'verified' && !result.verificationConfirmed)) invalid();
  return result;
}
export function parseSourceCheckDetail(value: unknown, expected: { id: string; revision: number }): SourceCheckDetail {
  const item = object(value, 'source sourceDigest checkVersion checks latest state reasons publicationEnabled visibility');
  const result: SourceCheckDetail = {
    source: parseManagedSource(item.source, expected), sourceDigest: digest(item.sourceDigest), checkVersion: number(item.checkVersion, 0),
    checks: list(item.checks, entry => parseSourceCheck(entry, expected.id), 20), latest: item.latest === null ? null : parseSourceCheck(item.latest, expected.id),
    state: choice(item.state, ['pending', 'verified', 'returned', 'revoked', 'expired', 'invalidated', 'recorded']), reasons: reasons(item.reasons, checkReasons),
    publicationEnabled: literal(item.publicationEnabled, false), visibility: literal(item.visibility, 'private'),
  };
  // The recent window spans all revisions of this source. A selected historical
  // revision's latest check can legitimately be older than the entire window.
  if (result.checks.length !== Math.min(result.checkVersion, 20) || result.checks.some((check, index) => check.version !== result.checkVersion - index)) invalid();
  const latest = result.latest, recent = result.checks.find(check => check.sourceRevision === expected.revision);
  if (latest && (latest.sourceRevision !== expected.revision || latest.version > result.checkVersion ||
      (recent ? JSON.stringify(recent) !== JSON.stringify(latest) : latest.version >= (result.checks.at(-1)?.version ?? 0)))) invalid();
  if (!latest && recent) invalid();
  const has = (reason: string) => result.reasons.includes(reason);
  if (!latest) { if (result.state !== 'pending' || result.reasons.length !== 1 || !has('source_check_missing')) invalid(); }
  else {
    if (result.state === 'pending') invalid();
    if (result.state !== 'invalidated' && latest.sourceDigest !== result.sourceDigest) invalid();
    if (result.state === 'verified' && (latest.decision !== 'verified' || latest.evidenceKind !== 'manual-check' || result.reasons.length)) invalid();
    if (result.state === 'recorded' && (latest.decision !== 'verified' || latest.evidenceKind !== 'test-fixture' || result.reasons.length !== 1 || !has('source_check_test_fixture'))) invalid();
    if (result.state === 'returned' && (latest.decision !== 'return' || result.reasons.length !== 1 || !has('source_check_returned'))) invalid();
    if (result.state === 'revoked' && (latest.decision !== 'revoke' || result.reasons.length !== 1 || !has('source_check_revoked'))) invalid();
    if (result.state === 'expired' && (latest.decision !== 'verified' || result.reasons.length !== 1 || !has('source_check_expired'))) invalid();
    if (result.state === 'invalidated' && (result.reasons.length !== 1 || !(has('source_changed') || has('source_check_authority_changed')))) invalid();
  }
  return result;
}
export function parseSavedSourceCheck(value: unknown, previous: SourceCheckDetail, input: SourceCheckInput, session: SessionInfo): SourceCheckDetail {
  const result = parseSourceCheckDetail(value, { id: previous.source.id, revision: previous.source.revision });
  const latest = result.latest;
  const normalized: SourceCheckInput = { sourceRevision: input.sourceRevision, sourceDigest: input.sourceDigest, decision: input.decision, evidenceKind: input.evidenceKind,
    ingredientIds: [...input.ingredientIds], domains: [...input.domains], authority: input.authority, checkedAt: input.checkedAt, validUntil: input.validUntil,
    evidenceReference: input.evidenceReference.trim(), comment: input.comment.trim(), verificationConfirmed: input.verificationConfirmed };
  if (!latest || result.checkVersion !== previous.checkVersion + 1 || latest.version !== result.checkVersion ||
      JSON.stringify(result.source) !== JSON.stringify(parseManagedSource(previous.source)) || result.sourceDigest !== previous.sourceDigest || latest.actorId !== session.user.id ||
      latest.actor !== session.user.username || latest.accountRevision !== session.user.revision) invalid();
  for (const key of Object.keys(normalized) as (keyof SourceCheckInput)[]) if (JSON.stringify(latest[key]) !== JSON.stringify(normalized[key])) invalid();
  return result;
}
export function parsePublicationPreflight(value: unknown, ingredientId: string, publicationAuthority = false): PublicationPreflight {
  const item = object(value, 'ingredientId contentRevision contentDigest baseReleaseId lockVersion professionalReviewVersion sources missingDomains reasons readyForReleaseApproval publicationEnabled visibility');
  const result: PublicationPreflight = {
    ingredientId: id(item.ingredientId), contentRevision: item.contentRevision === null ? null : number(item.contentRevision),
    contentDigest: item.contentDigest === null ? null : digest(item.contentDigest), baseReleaseId: item.baseReleaseId === null ? null : id(item.baseReleaseId),
    lockVersion: number(item.lockVersion, 0), professionalReviewVersion: number(item.professionalReviewVersion, 0),
    sources: list(item.sources, entry => { const source = object(entry, 'sourceId sourceRevision checkVersion checkDigest ready reasons');
      const parsed = { sourceId: id(source.sourceId), sourceRevision: number(source.sourceRevision), checkVersion: number(source.checkVersion, 0),
        checkDigest: source.checkDigest === null ? null : digest(source.checkDigest), ready: boolean(source.ready), reasons: reasons(source.reasons, sourceReasons) };
      if ((parsed.checkDigest !== null && !parsed.checkVersion) || parsed.ready !== (parsed.reasons.length === 0) ||
          (parsed.ready && (!parsed.checkVersion || parsed.checkDigest === null))) invalid();
      return parsed;
    }, 10),
    missingDomains: reasons(item.missingDomains, domains), reasons: reasons(item.reasons, publicationAuthority ? [...preflightReasons, 'editorial_authority_changed'] : preflightReasons), readyForReleaseApproval: boolean(item.readyForReleaseApproval),
    publicationEnabled: literal(item.publicationEnabled, false), visibility: literal(item.visibility, 'private'),
  };
  unique(result.sources.map(source => source.sourceId));
  const has = (reason: string) => result.reasons.includes(reason);
  if (result.ingredientId !== ingredientId || (result.contentRevision === null) !== (result.contentDigest === null) ||
      (result.contentRevision === null) !== (result.baseReleaseId === null) || has('content_missing') !== (result.contentRevision === null) ||
      (result.contentRevision === null ? result.lockVersion !== 0 || result.sources.length > 0 : result.lockVersion < result.contentRevision) ||
      has('source_references_required') !== (result.sources.length === 0) || has('source_checks_required') !== result.sources.some(source => !source.ready) ||
      has('source_domains_incomplete') !== (result.missingDomains.length > 0) || result.readyForReleaseApproval !== (result.reasons.length === 0) ||
      (result.readyForReleaseApproval && (!result.contentRevision || !result.sources.length || !result.professionalReviewVersion || result.missingDomains.length))) invalid();
  return result;
}

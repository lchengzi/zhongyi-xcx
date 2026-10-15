export interface SourceSummary {
  id: string;
  title: string;
  publisher: string;
  url: string;
  status: string;
  checkedAt: string;
}

export interface Ingredient {
  id: string;
  name: string;
  pinyin: string;
  aliases: string[];
  batch: string;
  latinName: string;
  ediblePart: string;
  identityState: string;
  professionalReviewState: string;
  restriction: string;
  sources: SourceSummary[];
}

export interface CatalogSeed {
  schemaVersion: 1;
  releaseId: string;
  releaseDigest: string;
  contentVersion: string;
  sourceAsOf: string;
  ingredients: Ingredient[];
  digest: string;
}

export interface EditorialNote {
  ingredientId: string;
  text: string;
  revision: number;
  updatedAt: string | null;
}

export interface IngredientDetail {
  ingredient: Ingredient;
  note: EditorialNote;
}

export interface IngredientPage {
  items: Ingredient[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PlatformSummary {
  mode: 'local_editorial_demo';
  releaseId: string;
  contentVersion: string;
  sourceAsOf: string;
  importedAt: string;
  ingredientCount: number;
  noteCount: number;
  eventCount: number;
  publicationEnabled: false;
}

export interface AuditEvent {
  id: number;
  ingredientId: string;
  action: 'note_saved' | 'note_cleared';
  revision: number;
  createdAt: string;
  actor: string;
}

export type UserRole = 'admin' | 'editor' | 'reviewer';
export interface Account {
  id: string;
  username: string;
  role: UserRole;
  active: boolean;
  revision: number;
  createdAt: string;
}
export interface SessionInfo {
  user: Account;
  csrfToken: string;
  expiresAt: string;
}
// Non-secret intent can be retained while a create acknowledgement is unknown.
export interface AccountCreationIntent { username: string; role: UserRole }
export interface AccountUpdateInput { role: UserRole; active: boolean; expectedRevision: number }
export interface AuthConfig { mode: 'accounts' | 'local-key' }
export interface SecurityEvent {
  id: number;
  actor: string;
  action: 'account_created' | 'account_updated' | 'login_succeeded' | 'login_failed' | 'logout';
  target: string | null;
  createdAt: string;
}

export interface SourceInput { title: string; publisher: string; url: string }
export interface ManagedSource extends SourceInput {
  id: string;
  revision: number;
  recordedBy: string;
  recordedAt: string;
  verificationState: 'pending';
  visibility: 'private';
}
export interface SourcePage { items: ManagedSource[]; total: number; page: number; pageSize: number }
export interface ReviewTaskPage { items: ReviewTask[]; total: number; page: number; pageSize: number }
export type SourceDomain = 'identity' | 'edible_part' | 'processing' | 'safety_boundary' | 'directory_scope';
export interface SourceCheckInput {
  sourceRevision: number; sourceDigest: string;
  decision: 'verified' | 'return' | 'revoke'; evidenceKind: 'manual-check' | 'test-fixture';
  ingredientIds: string[]; domains: SourceDomain[]; authority: 'official' | 'research' | 'reference';
  checkedAt: string; validUntil: string; evidenceReference: string; comment: string; verificationConfirmed: boolean;
}
export interface SourceCheck extends SourceCheckInput {
  sourceId: string; version: number; actorId: string; actor: string; accountRevision: number; recordedAt: string; digest: string;
}
export interface SourceCheckDetail {
  source: ManagedSource; sourceDigest: string; checkVersion: number; checks: SourceCheck[]; latest: SourceCheck | null;
  state: 'pending' | 'verified' | 'returned' | 'revoked' | 'expired' | 'invalidated' | 'recorded';
  reasons: string[]; publicationEnabled: false; visibility: 'private';
}
export interface PublicationPreflight {
  ingredientId: string; contentRevision: number | null; contentDigest: string | null; baseReleaseId: string | null;
  lockVersion: number; professionalReviewVersion: number;
  sources: { sourceId: string; sourceRevision: number; checkVersion: number; checkDigest: string | null; ready: boolean; reasons: string[] }[];
  missingDomains: SourceDomain[]; reasons: string[]; readyForReleaseApproval: boolean;
  publicationEnabled: false; visibility: 'private';
}
export interface SourceReference { id: string; revision: number; locator: string }
export interface PublicationBasis {
  scope: 'ingredient_education'; ingredientName: string; draft: ContentDraft;
  editorial: { taskId: string; reviewerId: string; accountRevision: number };
  professionalReviews: ProfessionalReview[]; qualifications: ProfessionalQualification[];
  sourceChecks: SourceCheck[];
}
export interface PublicationSnapshot {
  id: string; ingredientId: string; version: number; basis: PublicationBasis; basisDigest: string;
  actorId: string; actor: string; accountRevision: number; comment: string; recordedAt: string; digest: string;
}
export interface PublicationApproval {
  snapshotId: string; version: number; snapshotDigest: string; decision: 'approve' | 'revoke'; controlEpoch: string;
  actorId: string; actor: string; accountRevision: number; comment: string; recordedAt: string; digest: string;
}
export interface PublicationEvent {
  ingredientId: string; version: number; action: 'publish' | 'withdraw' | 'rollback'; snapshotId: string;
  approvalVersion: number; controlEpoch: string; previousDigest: string | null;
  actorId: string; actor: string; accountRevision: number; comment: string; recordedAt: string; digest: string;
}
export interface PublicationControl {
  version: number; action: 'freeze' | 'resume'; epoch: string; kind: 'operator' | 'recovery';
  actorId: string | null; actor: string; accountRevision: number | null;
  evidenceReference: string; comment: string; recordedAt: string; digest: string;
}
export interface PublicationSnapshotInput { expectedBasisDigest: string; comment: string; confirmed: boolean }
export interface PublicationApprovalInput {
  snapshotId: string; snapshotDigest: string; expectedApprovalVersion: number; expectedControlVersion: number;
  decision: 'approve' | 'revoke'; comment: string; confirmed: boolean;
}
export interface PublicationActionInput {
  action: PublicationEvent['action']; snapshotId: string; expectedVersion: number; expectedControlVersion: number;
  comment: string; confirmed: boolean;
}
export interface PublicationControlInput {
  action: PublicationControl['action']; expectedVersion: number; evidenceReference: string; comment: string; confirmed: boolean;
}
export interface PublicationWorkspace {
  ingredientId: string; preflight: PublicationPreflight; basisDigest: string | null;
  snapshots: PublicationSnapshot[]; approvals: PublicationApproval[]; events: PublicationEvent[];
  eventVersion: number; control: PublicationControl | null; enabled: boolean;
  activeSnapshotId: string | null; blockedReasons: string[];
}
// HTTP views do not expose another person's private qualification evidence.
// Digests identify the complete server-side snapshot, not this reduced view.
export type PublicationQualificationSummary = Pick<ProfessionalQualification,
  'userId' | 'revision' | 'accountRevision' | 'profession' | 'status' | 'evidenceKind' | 'validUntil' | 'digest'>;
export type PublicationSnapshotView = Omit<PublicationSnapshot, 'basis'> & {
  basis: Omit<PublicationBasis, 'qualifications'> & { qualifications: PublicationQualificationSummary[] };
};
export type PublicationWorkspaceView = Omit<PublicationWorkspace, 'snapshots'> & { snapshots: PublicationSnapshotView[] };
export interface PublishedEducation {
  scope: 'ingredient_education'; ingredientId: string; name: string; snapshotId: string; snapshotVersion: number;
  contentRevision: number; baseReleaseId: string; publishedAt: string;
  ediblePart: string; latinName: string; educationText: string; safetyText: string;
  sources: { title: string; publisher: string; url: string; locator: string; checkedAt: string; validUntil: string }[];
  boundary: '非医疗食养教育，不用于诊断、治疗、个体化开方或用药指导。';
}
export interface DraftContent {
  ediblePart: string;
  latinName: string;
  educationText: string;
  safetyText: string;
  sourceRefs: SourceReference[];
}
export type DraftState = 'draft' | 'submitted' | 'changes_requested' | 'editorial_accepted';
export interface ContentRevision {
  ingredientId: string;
  revision: number;
  content: DraftContent;
  sources: ManagedSource[];
  digest: string;
  baseReleaseId: string;
  authorId: string;
  author: string;
  createdAt: string;
}
export interface ContentDraft extends ContentRevision {
  lockVersion: number;
  state: DraftState;
  ownerId: string;
  owner: string;
  updatedAt: string;
  visibility: 'private';
  professionalReviewState: 'pending';
  publicationEnabled: false;
}
export interface ReviewTask {
  id: string;
  ingredientId: string;
  ingredientName: string;
  revision: number;
  digest: string;
  status: 'pending' | 'accepted' | 'returned';
  submittedById: string;
  submittedBy: string;
  submittedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  comment: string | null;
}
export interface WorkflowEvent {
  id: number;
  ingredientId: string | null;
  sourceId: string | null;
  revision: number;
  action: 'source_created' | 'source_updated' | 'draft_saved' | 'draft_submitted' | 'review_returned' | 'review_accepted';
  actor: string;
  createdAt: string;
}
export interface DraftDetail {
  draft: ContentDraft | null;
  revisions: ContentRevision[];
  tasks: ReviewTask[];
  contributorIds: string[];
}

export type ProfessionalKind = 'tcm_physician' | 'pharmacist';
export interface QualificationInput {
  profession: ProfessionalKind;
  status: 'verified' | 'revoked';
  evidenceKind: 'manual-verification' | 'test-fixture';
  evidenceReference: string;
  validUntil: string;
  comment: string;
  verificationConfirmed: boolean;
}
export interface ProfessionalQualification extends QualificationInput {
  userId: string;
  revision: number;
  accountRevision: number;
  recordedById: string;
  recordedBy: string;
  recordedAt: string;
  digest: string;
}
export interface QualificationHistory { userId: string; items: ProfessionalQualification[] }
export interface ProfessionalDecisionInput {
  profession: ProfessionalKind;
  decision: 'approve' | 'return' | 'revoke';
  contentRevision: number;
  contentDigest: string;
  expectedLockVersion: number;
  expectedReviewVersion: number;
  expectedQualificationRevision: number;
  comment: string;
}
export interface ProfessionalReview {
  ingredientId: string;
  version: number;
  contentRevision: number;
  contentDigest: string;
  profession: ProfessionalKind;
  decision: ProfessionalDecisionInput['decision'];
  qualificationUserId: string;
  qualificationRevision: number;
  actorId: string;
  actor: string;
  accountRevision: number;
  comment: string;
  recordedAt: string;
  digest: string;
}
export interface ProfessionalDetail {
  scope: 'ingredient_education';
  ingredientId: string;
  draft: ContentDraft | null;
  reviews: ProfessionalReview[];
  latestReviews: ProfessionalReview[];
  reviewVersion: number;
  state: 'pending' | 'changes_requested' | 'recorded' | 'eligible_for_publication_approval';
  reasons: string[];
  publicationEnabled: false;
  visibility: 'private';
}

export interface ExcerptInput {
  sourceId: string;
  sourceRevision: number;
  locator: string;
  text: string;
  allowExternal: boolean;
}
export interface EvidenceExcerpt extends ExcerptInput {
  id: string;
  ingredientId: string;
  digest: string;
  recordedBy: string;
  recordedAt: string;
  visibility: 'private';
  verificationState: 'pending';
  externalPermission: { allowed: boolean; revision: number; updatedBy: string; updatedAt: string };
}
export interface AssistantLimits { dailyTotal: number; dailyPerActor: number; concurrentTotal: number; concurrentPerActor: number; leaseMs: number }
export interface AssistantQuota { day: string; limits: AssistantLimits; usedTotal: number; usedByActor: number; activeTotal: number; activeByActor: number; policyMatches: boolean }
export interface EvidenceLeaseRef { id: string; digest: string; permissionRevision: number }
export interface AssistantReservation { id: string; ingredientId: string; actorId: string; day: string; expiresAt: number }
export interface AssistantMetrics {
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
}
export interface AssistantEvent {
  id: string;
  ingredientId: string;
  actorId: string;
  actor: string;
  provider: 'disabled' | 'openai' | 'test-fixture';
  model: string;
  status: 'completed' | 'failed' | 'refused';
  requestDigest: string;
  resultDigest: string | null;
  errorCode: string | null;
  metrics: AssistantMetrics;
  createdAt: string;
}
export type AssistantMode = 'extract' | 'summary' | 'review';
export type SummaryField = 'identity' | 'edible_part' | 'processing';
export interface SummarySection { field: SummaryField; text: string; evidenceIds: string[] }
export interface ReviewFinding { field: SummaryField; kind: 'candidate' | 'gap' | 'conflict'; text: string; evidenceIds: string[] }
interface AssistantResultBase {
  id: string;
  ingredientId: string;
  statements: { evidenceId: string; quote: string }[];
  gaps: ('identity' | 'edible_part' | 'processing' | 'safety_boundary')[];
  citations: EvidenceExcerpt[];
  metrics: AssistantMetrics;
  provider: AssistantEvent['provider'];
  model: string;
  simulated: boolean;
  publicationEnabled: false;
  professionalReviewState: 'pending';
}
export type AssistantResult = AssistantResultBase & (
  { mode: 'extract' | 'summary'; sections: SummarySection[] } |
  { mode: 'review'; sections: []; findings: ReviewFinding[] }
);
export interface AssistantConfig {
  enabled: boolean;
  provider: AssistantEvent['provider'];
  model: string;
  simulated: boolean;
  scope: 'editorial_extracts_only' | 'editorial_extracts_and_summary' | 'editorial_extracts_summary_and_review';
}

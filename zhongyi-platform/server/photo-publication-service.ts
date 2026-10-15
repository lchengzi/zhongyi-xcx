import { AccountError } from './auth.js';
import type { RepositoryBundle, WriteAuthority } from './stores.js';
import { PhotoDerivativeRegistry } from './photo-derivative-registry.js';
import { PhotoPublicationJournal, photoPublicationDigest } from './photo-publication-journal.js';
import { parsePhotoPublicationInput, parsePublishedPhoto, type PhotoPublicationEntry, type PhotoPublicationRecord, type PhotoPublicationSelection, type PublishedPhotoGallery } from '../shared/photo-publications.js';
import { photoRecoveryAllows } from './photo-resource-guard.js';

type PhotoStores = Pick<RepositoryBundle, 'catalog' | 'auth' | 'workflow' | 'publication' | 'photoSubmissions' | 'photoRights' | 'photoProfessional'>;
const unavailable = () => new AccountError(410, 'photo_unavailable', '图片暂不可用。');
export class PhotoPublicationService {
  constructor(readonly stores: PhotoStores, readonly derivatives: PhotoDerivativeRegistry, readonly journal: PhotoPublicationJournal, readonly enabled: boolean) {
    derivatives.assertIsolation(journal.root);
  }
  async history(id: string) {
    const seed = await this.stores.catalog.publicSnapshot();
    const ingredient = seed.ingredients.find(item => item.id === id); if (!ingredient) throw unavailable();
    const control = (await this.stores.publication.controlHistory())[0];
    return { schemaVersion: 'photo-publication-history.1' as const, enabled: this.enabled, ingredientId: id, name: ingredient.name, baseReleaseId: seed.releaseId,
      control: control ? { action: control.action, epoch: control.epoch } : null, recoveryRequired: !photoRecoveryAllows(this.journal.root, control), items: this.journal.history(id).slice(0, 50) };
  }
  private async authority(authority: WriteAuthority) {
    const current = (await this.stores.auth.session(authority.token))?.user, actor = authority.account;
    if (!current) throw new AccountError(401, 'unauthorized', '会话已失效。');
    if (!current.active || current.role !== 'admin' || current.id !== actor.id || current.username !== actor.username || current.revision !== actor.revision || current.role !== actor.role) throw new AccountError(403, 'forbidden', '图片发布需要管理员权限。');
    return current;
  }
  private async entry(selection: PhotoPublicationSelection, ingredientId: string) {
    const derivative = this.derivatives.metadata(selection.candidateId), candidate = derivative?.candidate;
    if (!derivative || !candidate || candidate.ingredientId !== ingredientId || derivative.digest !== selection.derivativeDigest) throw unavailable();
    const [professional, rights, submission] = await Promise.all([
      this.stores.photoProfessional.detail(candidate), this.stores.photoRights.detail(candidate), this.stores.photoSubmissions.detail(candidate)
    ]);
    const latest = submission.history[0], permission = rights.history[0];
    if (!latest || !permission || professional.state !== 'eligible_for_derivative_review' || rights.state !== 'rights_verified' ||
        professional.version !== selection.professionalVersion || rights.version !== selection.rightsVersion || submission.version !== selection.submissionVersion ||
        professional.bindingDigest !== derivative.bindingDigest || rights.bindingDigest !== derivative.bindingDigest || latest.bindingDigest !== derivative.bindingDigest ||
        professional.submissionDigest !== latest.digest || rights.submissionDigest !== latest.digest || professional.rightsDigest !== permission.digest ||
        professional.noteVersion !== submission.noteVersion || professional.noteDigest !== submission.noteDigest || latest.noteDigest !== submission.noteDigest || latest.noteVersion !== submission.noteVersion ||
        professional.latestReviews.length !== 2 || professional.latestReviews.some(review => review.evidenceKind !== 'manual-verification' || review.decision !== 'approve')) throw unavailable();
    const credentials = await Promise.all(professional.latestReviews.map(review => this.stores.workflow.qualificationHistory(review.qualificationUserId)));
    const expiry = [Date.parse(permission.validUntil)];
    for (const [index, history] of credentials.entries()) {
      const current = history[0], review = professional.latestReviews[index];
      if (!current || !review || current.digest !== review.qualificationDigest || current.revision !== review.qualificationRevision || current.status !== 'verified' || current.evidenceKind !== 'manual-verification') throw unavailable();
      expiry.push(Date.parse(current.validUntil));
    }
    const validUntil = new Date(Math.min(...expiry)).toISOString();
    if (Date.parse(validUntil) <= Date.now()) throw unavailable();
    const photo = parsePublishedPhoto({ sha256: derivative.sha256, width: derivative.width, height: derivative.height, bytes: derivative.bytes,
      caption: latest.caption, part: latest.partDescription, processing: latest.processingDescription, author: candidate.author,
      sourceUrl: `${candidate.sourcePage}?oldid=${candidate.sourceRevision}`, license: candidate.declaredLicense, licenseUrl: candidate.licenseUrl, modification: derivative.transformationNotice });
    const bytes = this.derivatives.asset(candidate.id); if (!bytes) throw unavailable();
    return { entry: { ...selection, photo } satisfies PhotoPublicationEntry, validUntil, bytes };
  }
  async publish(id: string, raw: unknown, authority: WriteAuthority): Promise<PhotoPublicationRecord> {
    let input;
    try { input = parsePhotoPublicationInput(raw); } catch { throw new AccountError(400, 'invalid_photo_publication', '请核对图片版本、展示确认和发布说明。'); }
    const actor = await this.authority(authority);
    const control = (await this.stores.publication.controlHistory())[0];
    // Withdrawal remains possible even while anonymous reads are disabled.
    if (!this.enabled && input.action === 'publish') throw new AccountError(503, 'photo_publication_disabled', '图片发布尚未启用。');
    if (input.action === 'publish' && control?.action !== 'resume') throw new AccountError(409, 'photo_publication_frozen', '请先核对并恢复发布状态。');
    if (input.action === 'publish' && !photoRecoveryAllows(this.journal.root, control)) throw new AccountError(409, 'photo_recovery_required', '图片已恢复，请核对备份并重新冻结、恢复发布，再明确发布图集。');
    const seed = await this.stores.catalog.publicSnapshot(), ingredient = seed.ingredients.find(item => item.id === id);
    if (!ingredient) throw unavailable();
    const current = this.journal.history(id)[0];
    if ((current?.version ?? 0) !== input.expectedVersion) throw new AccountError(409, 'photo_publication_conflict', '图片发布版本已变化，请重新读取。');
    const prepared = await Promise.all(input.selections.map(selection => this.entry(selection, id)));
    await this.authority(authority);
    const latestControl = (await this.stores.publication.controlHistory())[0];
    if (input.action === 'publish' && (latestControl?.action !== 'resume' || latestControl.epoch !== control?.epoch || !photoRecoveryAllows(this.journal.root, latestControl))) throw new AccountError(409, 'photo_publication_frozen', '发布状态已变化，请重新读取。');
    const createdAt = new Date().toISOString(), validUntil = prepared.length ? prepared.map(item => item.validUntil).sort()[0]! : createdAt;
    const record: PhotoPublicationRecord = { schemaVersion: 'photo-publication.1', ingredientId: id, name: ingredient.name, baseReleaseId: seed.releaseId,
      version: input.expectedVersion + 1, action: input.action, entries: prepared.map(item => item.entry), displayReviewConfirmed: true, visualPrivacyConfirmed: true,
      reason: input.reason, actorId: actor.id, actorName: actor.username, accountRevision: actor.revision, controlEpoch: control?.epoch ?? 'uninitialized', createdAt, validUntil, previousDigest: current?.digest ?? null, digest: `sha256:${'0'.repeat(64)}` };
    record.digest = photoPublicationDigest(record);
    return this.journal.append(record);
  }
  async gallery(id: string): Promise<PublishedPhotoGallery> {
    if (!this.enabled) throw new AccountError(503, 'photo_publication_disabled', '图片暂不可用。');
    const head = this.journal.history(id)[0];
    if (!head) throw new AccountError(404, 'not_found', '暂无可用图片。');
    if (head.action !== 'publish' || Date.parse(head.validUntil) <= Date.now() || Date.parse(head.createdAt) > Date.now()) throw unavailable();
    const control = (await this.stores.publication.controlHistory())[0];
    if (control?.action !== 'resume' || control.epoch !== head.controlEpoch || !photoRecoveryAllows(this.journal.root, control)) throw unavailable();
    const seed = await this.stores.catalog.publicSnapshot(), ingredient = seed.ingredients.find(item => item.id === id);
    if (!ingredient || head.baseReleaseId !== seed.releaseId || head.name !== ingredient.name) throw unavailable();
    const publisher = (await this.stores.auth.users()).find(item => item.id === head.actorId);
    if (!publisher?.active || publisher.role !== 'admin' || publisher.revision !== head.accountRevision || publisher.username !== head.actorName) throw unavailable();
    for (const entry of head.entries) {
      const current = await this.entry(entry, id);
      if (JSON.stringify(current.entry.photo) !== JSON.stringify(entry.photo) || current.validUntil < head.validUntil) throw unavailable();
    }
    if (this.journal.history(id)[0]?.digest !== head.digest) throw unavailable();
    const latestControl = (await this.stores.publication.controlHistory())[0];
    if (latestControl?.action !== 'resume' || latestControl.epoch !== head.controlEpoch) throw unavailable();
    // Explicit projection: editorial identities, evidence and paths stay private.
    return { schemaVersion: 'public-photo-gallery.1', ingredientId: head.ingredientId, name: head.name, baseReleaseId: head.baseReleaseId,
      version: head.version, publishedAt: head.createdAt, validUntil: head.validUntil, photos: head.entries.map(entry => parsePublishedPhoto(entry.photo)) };
  }
  async asset(id: string, version: number, hash: string): Promise<Buffer> {
    const gallery = await this.gallery(id), head = this.journal.history(id)[0];
    if (gallery.version !== version || head?.version !== version || head.action !== 'publish') throw unavailable();
    const entry = head.entries.find(item => item.photo.sha256 === `sha256:${hash}`);
    const bytes = entry && this.derivatives.asset(entry.candidateId);
    if (!bytes || this.journal.history(id)[0]?.digest !== head.digest) throw unavailable();
    return bytes;
  }
  async batch(ids: readonly string[]) {
    if (!this.enabled) throw new AccountError(503, 'photo_publication_disabled', '图片暂不可用。');
    if (!ids.length || ids.length > 12 || new Set(ids).size !== ids.length || ids.some(id => !/^[a-z0-9][a-z0-9-]{0,79}$/.test(id))) throw new AccountError(400, 'invalid_photo_batch', '图片批次无效。');
    const seed = await this.stores.catalog.publicSnapshot(), galleries: PublishedPhotoGallery[] = [];
    for (const id of ids) {
      if (!seed.ingredients.some(item => item.id === id)) throw new AccountError(404, 'not_found', '未找到食材。');
      try {
        const gallery = await this.gallery(id);
        if (gallery.baseReleaseId !== seed.releaseId) throw new Error('Photo batch release changed');
        galleries.push(gallery);
      } catch (error) { if (!(error instanceof AccountError) || ![404, 410].includes(error.status)) throw error; }
    }
    return { schemaVersion: 'public-photo-batch.1' as const, baseReleaseId: seed.releaseId, requestedIds: [...ids], galleries };
  }
}

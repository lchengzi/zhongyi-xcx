import type { ProfessionalKind } from '../shared/contracts.js';
import type { PhotoProfessionalDetail, PhotoProfessionalInput } from '../shared/photo-professional.js';
import type { PhotoProfessionalCredential } from '../shared/photo-professional-response.js';
import type { PhotoProfessionalWorkspace } from '../web/photo-professional-api.js';
import { migrationFixture } from './migration-fixture.js';
import { openConfiguredStore } from '../server/store-config.js';
import { preparePhotoProfessional } from './photo-professional-fixture.js';

export function professionalReviewInput(detail: PhotoProfessionalDetail, credential: PhotoProfessionalCredential,
  decision: PhotoProfessionalInput['decision'] = 'approve'): PhotoProfessionalInput {
  if (!detail.submissionDigest || !detail.noteDigest || !detail.rightsDigest) throw new Error('Engineering fixture basis missing');
  return { bindingDigest: detail.bindingDigest, expectedVersion: detail.version, expectedSubmissionVersion: detail.submissionVersion, submissionDigest: detail.submissionDigest,
    expectedNoteVersion: detail.noteVersion, noteDigest: detail.noteDigest, expectedRightsVersion: detail.rightsVersion, rightsDigest: detail.rightsDigest,
    profession: credential.profession, expectedQualificationRevision: credential.revision, qualificationDigest: credential.digest, decision,
    identity: 'matches', part: 'matches', processing: 'matches', evidenceReference: 'ENGINEERING_SIMULATION_NOT_REAL:fixed-evidence',
    comment: '工程演练，不是真人鉴定、可食性结论或发布批准。', verificationConfirmed: true };
}
export async function professionalResponseFixture() {
  const f = await migrationFixture(undefined, false);
  const stores = await openConfiguredStore(f.seed, { DATABASE_PROVIDER: 'sqlite', DB_PATH: f.filename });
  try {
    const prepared = await preparePhotoProfessional(stores), photo = prepared.photo;
    const credential = async (profession: ProfessionalKind): Promise<PhotoProfessionalCredential> => {
      const q = (await stores.workflow.qualificationHistory(prepared.authority(profession).account.id))[0];
      if (!q) throw new Error('Missing engineering qualification');
      return { userId: q.userId, revision: q.revision, digest: q.digest, profession: q.profession, evidenceKind: q.evidenceKind };
    };
    const input = professionalReviewInput(await stores.photoProfessional.detail(photo), await credential('tcm_physician'));
    const saved = await stores.photoProfessional.review(photo, input, prepared.authority('tcm_physician'));
    const session = await stores.auth.session(prepared.authority('tcm_physician').token); if (!session) throw new Error('Fixture session missing');
    const workspace = async (): Promise<PhotoProfessionalWorkspace> => ({ detail: await stores.photoProfessional.detail(photo), rights: {
      detail: await stores.photoRights.detail(photo), submissions: { detail: await stores.photoSubmissions.detail(photo), notes: await stores.photoNotes.detail(photo) } } });
    return { stores, prepared, photo, credential, input, saved, session, workspace, async close() { await stores.close(); f.dispose(); } };
  } catch (error) { await stores.close(); f.dispose(); throw error; }
}

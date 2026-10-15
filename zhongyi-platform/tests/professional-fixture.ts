import type { Account, ProfessionalDecisionInput, ProfessionalKind, QualificationInput } from '../shared/contracts.js';
import type { RepositoryBundle } from '../server/stores.js';
import { fixturePassword } from './migration-fixture.js';

export const credentialInput = (profession: ProfessionalKind): QualificationInput => ({ profession, status: 'verified', evidenceKind: 'test-fixture',
  evidenceReference: `engineering-fixture-${profession}`, validUntil: new Date(Date.now() + 86400000 * 30).toISOString(), comment: '仅工程模拟核验，无真人资格或专业批准。', verificationConfirmed: true });
export async function addProfessionalFixture(stores: Pick<RepositoryBundle, 'auth' | 'workflow'>, admin: Account) {
  const physician = await stores.auth.createUser('pro-physician', fixturePassword, 'reviewer', 'test-fixture');
  const pharmacist = await stores.auth.createUser('pro-pharmacist', fixturePassword, 'reviewer', 'test-fixture');
  await stores.workflow.saveQualification(physician.id, credentialInput('tcm_physician'), 0, admin);
  await stores.workflow.saveQualification(pharmacist.id, credentialInput('pharmacist'), 0, admin);
  const input = async (profession: ProfessionalKind, decision: ProfessionalDecisionInput['decision'] = 'approve'): Promise<ProfessionalDecisionInput> => {
    const detail = await stores.workflow.professionalDetail('huang-qi'); const person = profession === 'tcm_physician' ? physician : pharmacist;
    const qualification = (await stores.workflow.qualificationHistory(person.id))[0];
    const prior = detail.latestReviews.find((item) => item.profession === profession);
    return { profession, decision, contentRevision: decision === 'revoke' ? prior!.contentRevision : detail.draft!.revision,
      contentDigest: decision === 'revoke' ? prior!.contentDigest : detail.draft!.digest, expectedLockVersion: detail.draft!.lockVersion,
      expectedReviewVersion: detail.reviewVersion, expectedQualificationRevision: decision === 'revoke' ? prior!.qualificationRevision : qualification.revision,
      comment: '仅测试审校意见，不是真人专业签审或发布许可。' };
  };
  return { physician, pharmacist, input };
}

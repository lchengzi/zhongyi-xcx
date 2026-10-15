import { CatalogRepository } from '../server/database.js';
import { AuthRepository } from '../server/auth.js';
import { WorkflowRepository } from '../server/workflow.js';
import { PublicationRepository } from '../server/publication.js';
import { migrationFixture, fixturePassword } from './migration-fixture.js';
import { credentialInput } from './professional-fixture.js';
import { sourceCheckInput } from './source-check-fixture.js';
import type { ProfessionalKind } from '../shared/contracts.js';

// Explicit isolated engineering simulation. "manual" values exercise the real
// gate's positive path; they are NOT actual qualifications, official sources,
// medical approval or working content. No external server is contacted.
export async function publicationFixture(manualSimulation = true) {
  const fixture = await migrationFixture(undefined, false);
  const catalog = new CatalogRepository(fixture.filename, fixture.seed); const auth = new AuthRepository(catalog.db); const workflow = new WorkflowRepository(catalog.db);
  try {
    // Tables come from the real additive migration, not test-only DDL.
    const approver = await auth.createUser('publication-approver', fixturePassword, 'admin', 'engineering-simulation');
    const physician = await auth.createUser('publication-physician', fixturePassword, 'reviewer', 'engineering-simulation');
    const pharmacist = await auth.createUser('publication-pharmacist', fixturePassword, 'reviewer', 'engineering-simulation');
    for (const [person, profession] of [[physician, 'tcm_physician'], [pharmacist, 'pharmacist']] as const) {
      workflow.saveQualification(person.id, { ...credentialInput(profession), evidenceKind: manualSimulation ? 'manual-verification' : 'test-fixture',
        evidenceReference: 'ENGINEERING_SIMULATION_NOT_REAL', comment: '仅隔离工程模拟，未核实任何真人身份或执业资格。' }, 0, fixture.admin);
    }
    async function review(profession: ProfessionalKind, revision = workflow.draft('huang-qi')!.revision, decision: 'approve' | 'revoke' = 'approve') {
      const person = profession === 'tcm_physician' ? physician : pharmacist; const draft = workflow.draft('huang-qi')!; const fixed = workflow.revision('huang-qi', revision)!;
      return workflow.recordProfessionalReview('huang-qi', { profession, decision, contentRevision: revision, contentDigest: fixed.digest,
        expectedLockVersion: draft.lockVersion, expectedReviewVersion: workflow.professionalDetail('huang-qi').reviewVersion, expectedQualificationRevision: 1,
        comment: 'ENGINEERING_SIMULATION_NOT_REAL：不是实际专业签审。' }, person);
    }
    await review('tcm_physician'); await review('pharmacist');
    async function advance(text = 'ENGINEERING_SIMULATION_NOT_REAL：下一份隔离正文。') {
      const old = workflow.draft('huang-qi')!;
      const next = workflow.saveDraft('huang-qi', { ...old.content, educationText: text }, old.lockVersion, fixture.editor);
      const submitted = workflow.submit('huang-qi', next.lockVersion, fixture.editor);
      workflow.decide(submitted.task.id, 'accept', '仅工程模拟编辑审阅。', submitted.draft.lockVersion, fixture.reviewer);
      await review('tcm_physician'); await review('pharmacist');
    }
    const source = workflow.draft('huang-qi')!.sources[0];
    workflow.saveSourceCheck(source.id, { ...sourceCheckInput(source), evidenceKind: manualSimulation ? 'manual-check' : 'test-fixture',
      evidenceReference: 'ENGINEERING_SIMULATION_NOT_REAL', comment: '仅模拟来源核验，不是官方查证。' }, 0, fixture.admin);
    const publication = new PublicationRepository(catalog.db, workflow);
    const resume = () => publication.control({ action: 'resume', expectedVersion: publication.controlHistory()[0]?.version || 0,
      evidenceReference: 'ENGINEERING_SIMULATION_NOT_REAL', comment: '仅隔离测试的恢复核对声明，不代表真实人工查证。', confirmed: true }, fixture.admin);
    const snapshot = () => publication.createSnapshot('huang-qi', { expectedBasisDigest: publication.workspace('huang-qi').basisDigest!, comment: '仅隔离测试固定快照。', confirmed: true }, fixture.editor);
    const approve = (id: string, decision: 'approve' | 'revoke' = 'approve') => {
      const fixed = publication.snapshot('huang-qi', id);
      const prior = publication.workspace('huang-qi').approvals.find((item) => item.snapshotId === id);
      return publication.approve('huang-qi', { snapshotId: id, snapshotDigest: fixed.digest, expectedApprovalVersion: prior?.version || 0,
        expectedControlVersion: publication.controlHistory()[0]?.version || 0, decision, comment: '仅隔离测试发布决定，非真实发布许可。', confirmed: true }, approver);
    };
    const action = (id: string, kind: 'publish' | 'withdraw' | 'rollback' = 'publish', enabled = true) => publication.action('huang-qi', { action: kind, snapshotId: id,
      expectedVersion: publication.workspace('huang-qi').eventVersion, expectedControlVersion: publication.controlHistory()[0]?.version || 0,
      comment: '仅隔离测试发布事件，不对外发布。', confirmed: true }, approver, undefined, enabled);
    return { ...fixture, catalog, auth, workflow, publication, approver, physician, pharmacist, source, resume, snapshot, approve, action, review, advance,
      close: () => { catalog.close(); fixture.dispose(); } };
  } catch (error) { catalog.close(); fixture.dispose(); throw error; }
}

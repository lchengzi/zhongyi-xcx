import { photoBaseline, type PhotoLead, type PhotoResearchBatch } from '../research/photo-leads';

// ENGINEERING FIXTURE ONLY. No website was accessed and no real research, image,
// reviewer, permission or factual assessment is represented by these values.
export function syntheticPhotoResearch(): PhotoResearchBatch {
  function lead(id: string, ingredientId: string, source: string, state: PhotoLead['rights']['state'], revision: string | null): PhotoLead {
    const url = new URL(source);
    return {
      id, ingredientId,
      source: { publisher: 'ENGINEERING_FIXTURE_NOT_REAL_RESEARCH', title: '合成测试资料，不是真实来源核对', url: source,
        revisionUrl: revision === null ? null : `https://commons.wikimedia.org/w/index.php?title=${encodeURIComponent(url.pathname.slice('/wiki/'.length))}&oldid=${revision}`,
        relevantTextRead: true, claim: '仅模拟契约字段，不代表实际网页阅读或食材身份。' },
      media: { links: [state === 'declared_cc_by_sa_4' ? `https://upload.wikimedia.org/engineering-fixture/${id}.jpg` : `${url.origin}/engineering-fixture/${id}.jpg`],
        access: 'not_requested', visualReviewState: 'not_performed', localAsset: null, reportedWidth: 10, reportedHeight: 10,
        declaredAuthor: null, sourceDate: null, containsLocationMetadata: null },
      rights: { state, noticeUrl: source, licenseUrl: state === 'declared_cc_by_sa_4' ? 'https://creativecommons.org/licenses/by-sa/4.0/' : null,
        noticeRead: true, projectReview: 'pending', permissionObtained: false, notes: '模拟声明，仅测试运行时约束；没有许可核对或批准。' },
      intendedUse: '仅本地与CI合成测试，不用于公开资料。', limitations: ['没有实际图片。', '没有访问来源或获得许可。'],
      verificationState: 'pending', publicationEligible: false,
    };
  }
  return {
    schemaVersion: 'private-photo-research.1', checkedAt: '2000-01-01', scope: 'private_research_only', publicationEligible: false,
    runtimePlacements: [], doesNotCloseGaps: true, baselineBindings: photoBaseline.map(binding => ({ ...binding })),
    leads: [lead('fixture-one', 'fixture-yam', 'https://commons.wikimedia.org/wiki/File:Engineering_fixture_one.jpg', 'declared_cc_by_sa_4', '1'),
      lead('fixture-two', 'fixture-yam', 'https://herbaltcm.sn.polyu.edu.hk/engineering-fixture', 'requires_prior_consent', null),
      lead('fixture-three', 'fixture-lily', 'https://commons.wikimedia.org/wiki/File:Engineering_fixture_three.jpg', 'declared_cc_by_sa_4', '2'),
      lead('fixture-four', 'fixture-lily', 'https://www.tsumura.co.jp/engineering-fixture', 'restricted_reuse', null)],
    rightsAddenda: [{ recordPath: photoBaseline[2].path, recordSha256: photoBaseline[2].sha256,
      affectedIngredientIds: ['tian-dong', 'gou-qi-zi', 'di-huang'], noticeUrl: 'https://herbaltcm.sn.polyu.edu.hk/copyright', noticeRead: true,
      previousObservation: 'timeout_not_read', newObservation: 'notice_read_requires_permission', requiredAction: 'obtain_permission_before_reuse',
      permissionObtained: false, note: '仅合成字段，用来验证既定三个ID和摘要的约束，不是新的版权观察。' }],
  };
}

import { EDUCATION_BOUNDARY } from '../src/education.js';

export const educationNow = Date.parse('2026-10-11T06:00:00.000Z');
export const educationBinding = Object.freeze({ ingredientId: 'huang-qi', name: '黄芪', baseReleaseId: 'release-test.1' });
export function educationFixture() {
  return { ...educationBinding, scope: 'ingredient_education', snapshotId: 'snapshot-1', snapshotVersion: 1, contentRevision: 2,
    publishedAt: '2026-10-11T05:00:00.000Z', ediblePart: '工程测试资料，不用于实际食用', latinName: '',
    educationText: '仅隔离契约测试；非真实专业批准。', safetyText: '资料不能代替专业意见。', boundary: EDUCATION_BOUNDARY,
    sources: [{ title: '工程测试来源', publisher: 'Fixture', url: 'https://example.org/source?section=1#part', locator: '测试定位', checkedAt: '2026-10-10T06:00:00.000Z', validUntil: '2026-10-12T06:00:00.000Z' }] };
}

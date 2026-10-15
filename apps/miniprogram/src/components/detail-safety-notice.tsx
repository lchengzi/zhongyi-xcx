import { View } from '@tarojs/components';
import type { SafetyAssessment, SafetyWarningCode } from '@food-education/catalog-core';
import { Notice } from './page';
import { Disclosure } from './disclosure';

// Only administrative review progress is folded. Conflicts, population,
// allergy, medication, preparation warnings and unknown profile stay visible.
const reviewProgress = new Set<SafetyWarningCode>([
  'preparation_data_pending', 'food_use_mapping_pending', 'catalog_refresh_pending', 'professional_review_pending'
]);

export function DetailSafetyNotice({ assessment, riskNotes, onSafety, canInteract }: {
  assessment: SafetyAssessment; riskNotes: readonly string[]; onSafety: () => void; canInteract: () => boolean;
}) {
  const pending: string[] = [], warnings: string[] = [];
  assessment.warnings.forEach((message, index) => {
    const code = assessment.warningCodes[index];
    (code && reviewProgress.has(code) ? pending : warnings).push(message);
  });
  const visible = [...new Set([...assessment.reasons, ...warnings, ...riskNotes])];
  return <Notice title={assessment.blocked ? '请先确认这些安全问题' : '阅读提醒'} action='核对安全问项' onAction={onSafety}>
    <View className='detail-safety-messages'>{visible.map(message => <View key={message}>{message}</View>)}</View>
    {pending.length > 0 && <Disclosure title='资料核对进度' summary={`${pending.length} 项待复核 · 不能作为食用依据`} canInteract={canInteract}>
      {pending.map(message => <View className='reading-copy' key={message}>{message}</View>)}
    </Disclosure>}
  </Notice>;
}

import { Button, Checkbox, CheckboxGroup, Label, Text, Textarea, View } from '@tarojs/components';
import { useDidShow } from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';
import { AGE_OPTIONS, TRI_OPTIONS, RED_FLAG_OPTIONS, SAFETY_CHECKS, normalizeSafetyProfile, missingSafetyDimensions, buildConsultationSummary } from '@food-education/catalog-core';
import type { AgeGroup, TriState, SafetyProfile, SafetySessionSnapshot } from '@food-education/catalog-core';
import { Page, PageHeading, Section, Notice } from '../../components/page';
import { UrgentNotice } from '../../components/safety-notice';
import { StorageNotice } from '../../components/storage-notice';
import { usePageInteraction } from '../../platform/lifecycle';
import { confirmSafetyReset, copyConsultationNote, notify } from '../../platform/feedback';
import { useSafety, safetySession } from '../../features/safety';
import { useSelections } from '../../features/selections';
import { catalogResult } from '../../data/catalog';

interface Draft {
  readonly revision: number;
  readonly clearEpoch: number;
  readonly profile: SafetyProfile;
  readonly allergiesText: string;
  readonly conditionsText: string;
  readonly medicationsText: string;
}
const fromSession = (state: SafetySessionSnapshot): Draft => ({ revision: state.revision, clearEpoch: state.clearEpoch, profile: state.profile, allergiesText: state.profile.allergies.join('、'), conditionsText: state.profile.conditions.join('、'), medicationsText: state.profile.medications.join('、') });
const names = (text: string) => text.split(/[\n、，,;；]+/).map(value => value.trim()).filter(Boolean);
const appliedProfile = (draft: Draft) => normalizeSafetyProfile({ ...draft.profile, allergies: names(draft.allergiesText), conditions: names(draft.conditionsText), medications: names(draft.medicationsText) });

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { readonly value: T; readonly label: string }[]; onChange: (value: T) => void }) {
  return <View className='safety-field'><View className='safety-field__label'>{label}</View><View className='safety-choices'>{options.map(option => <Button key={option.value} ariaLabel={`${label}：${option.label}`} className={`safety-choice ${value === option.value ? 'safety-choice--active' : ''}`} onClick={() => onChange(option.value)}>{option.label}</Button>)}</View></View>;
}

export default function SafetyPage() {
  const canInteract = usePageInteraction();
  const safety = useSafety(canInteract);
  const selections = useSelections(safety.isCurrent);
  const [storedDraft, setDraft] = useState(() => fromSession(safety.state));
  // Never render a hidden tab's old health text for even one frame after a
  // privacy reset. The effect below then discards the obsolete local draft.
  const draft = storedDraft.clearEpoch === safety.state.clearEpoch ? storedDraft : fromSession(safety.state);
  const draftGeneration = useRef(0);
  const generation = draftGeneration.current;
  const resetting = useRef(false);
  const reloadDraft = () => {
    draftGeneration.current++;
    setDraft(fromSession(safetySession.getSnapshot()));
  };
  useDidShow(reloadDraft);
  useEffect(reloadDraft, [safety.state.clearEpoch]);
  const canEdit = () => safety.isCurrent() && draft.clearEpoch === safetySession.getSnapshot().clearEpoch && generation === draftGeneration.current && !resetting.current;
  const profile = appliedProfile(draft);
  const dirty = JSON.stringify(profile) !== JSON.stringify(safety.state.profile);
  const urgent = safety.state.profile.redFlags.length > 0;
  const missing = missingSafetyDimensions(safety.state.profile);
  const ids = selections.compare.status === 'ready' ? selections.compare.ids : null;
  const summary = catalogResult.ok && ids && !urgent && !dirty ? buildConsultationSummary(catalogResult.catalog, ids, safety.state) : null;
  const flagOptions = [...RED_FLAG_OPTIONS, ...draft.profile.redFlags.filter(value => !RED_FLAG_OPTIONS.some(option => option.value === value)).map(value => ({ value, label: '其他已记录的紧急情况' }))];

  function changeTri(key: 'pregnancy' | 'breastfeeding' | 'allergyStatus' | 'conditionStatus' | 'medicationStatus', value: TriState) {
    if (canEdit()) setDraft(before => ({ ...before, profile: { ...before.profile, [key]: value } }));
  }
  function save() {
    if (!canEdit()) return;
    const histories = [names(draft.allergiesText), names(draft.conditionsText), names(draft.medicationsText)];
    if (histories.some(values => values.length > 30 || values.some(value => value.length > 80))) {
      notify('每类最多 30 项，每项最多 80 字，请拆分核对后再应用');
      return;
    }
    const result = safetySession.saveProfile(profile, draft.revision);
    if (!result.ok) { notify('安全信息已变化，请重新打开本页核对'); return; }
    draftGeneration.current++;
    setDraft(fromSession(result.state));
    notify(result.state.profile.redFlags.length ? '已暂停食材选择，请优先就医' : '安全信息已应用于资料筛选');
  }
  async function reset() {
    if (!canEdit()) return;
    resetting.current = true;
    const before = safety.state;
    try {
      if (!(await confirmSafetyReset()) || !canInteract() || generation !== draftGeneration.current) return;
      const result = safetySession.clear(before.revision);
      if (!result.ok) { notify('安全信息已变化，请重新确认清除'); return; }
      reloadDraft();
      notify('本次安全信息与清单已清除');
    } finally { resetting.current = false; }
  }

  return <Page>
    <PageHeading eyebrow='读懂资料之前' title='安全与阅读清单' subtitle='先核对自己的情况，再看清资料尚未回答的问题。' />
    {urgent && <UrgentNotice canInteract={safety.isCurrent} showNavigation={false} />}
    <View className='safety-privacy'>问项只在本次运行中使用，不保存到本机、不上传。退出微信页面不一定结束运行，可随时清除。</View>
    <Section title='先留意紧急情况' caption='出现任一项请优先就医'>
      <CheckboxGroup onChange={event => {
        if (!canEdit()) return;
        const values = event.detail.value;
        const result = safetySession.addRedFlags(values, draft.revision);
        if (!result.ok) { notify('安全信息已变化，请重新核对'); return; }
        setDraft(before => ({ ...before, revision: result.state.revision, profile: { ...before.profile, redFlags: values } }));
      }}>
        {flagOptions.map(option => <Label className='safety-check' key={option.value}><Checkbox value={option.value} checked={draft.profile.redFlags.includes(option.value)} color='#9d4b38' /><Text>{option.label}</Text></Label>)}
      </CheckboxGroup>
      <View className='reading-note'>勾选后立即暂停食材选择。取消勾选后，请核对并点“应用安全信息”确认修改。</View>
    </Section>
    <Section title='本次查阅的个人情况'>
      <Choice<AgeGroup> label='年龄阶段' value={draft.profile.ageGroup} options={AGE_OPTIONS} onChange={value => { if (canEdit()) setDraft(before => ({ ...before, profile: { ...before.profile, ageGroup: value } })); }} />
      <Choice label='是否处于孕期' value={draft.profile.pregnancy} options={TRI_OPTIONS} onChange={value => changeTri('pregnancy', value)} />
      <Choice label='是否处于哺乳期' value={draft.profile.breastfeeding} options={TRI_OPTIONS} onChange={value => changeTri('breastfeeding', value)} />
      <Choice label='是否有过敏史' value={draft.profile.allergyStatus} options={TRI_OPTIONS} onChange={value => changeTri('allergyStatus', value)} />
      <View className='safety-field'><View className='safety-field__label'>已知过敏物</View><Textarea id='safety-allergies' className='safety-input' value={draft.allergiesText} placeholder='填写已知名称，多项用逗号或换行分隔' maxlength={2400} autoHeight onInput={event => { if (canEdit()) setDraft(before => ({ ...before, allergiesText: event.detail.value })); }} ariaLabel='已知过敏物' /></View>
      <Choice label='是否有基础疾病或特殊情况' value={draft.profile.conditionStatus} options={TRI_OPTIONS} onChange={value => changeTri('conditionStatus', value)} />
      <View className='safety-field'><View className='safety-field__label'>需要留意的情况</View><Textarea id='safety-conditions' className='safety-input' value={draft.conditionsText} placeholder='填写已确认的情况，不确定可留空' maxlength={2400} autoHeight onInput={event => { if (canEdit()) setDraft(before => ({ ...before, conditionsText: event.detail.value })); }} ariaLabel='基础疾病或特殊情况' /></View>
      <Choice label='是否正在用药' value={draft.profile.medicationStatus} options={TRI_OPTIONS} onChange={value => changeTri('medicationStatus', value)} />
      <View className='safety-field'><View className='safety-field__label'>药品及其他相关用物</View><Textarea id='safety-medications' className='safety-input' value={draft.medicationsText} placeholder='填写实际名称，供规则匹配；不要自行停药或换药' maxlength={2400} autoHeight onInput={event => { if (canEdit()) setDraft(before => ({ ...before, medicationsText: event.detail.value })); }} ariaLabel='药品与相关用物名称' /></View>
      <View className='reading-note'>填写具体名称后，相应状态按“是”处理。每类最多 30 项、每项 80 字；不确定的信息可以保留为“不确定”。</View>
      <Button id='apply-safety-profile' className='button button--primary button--wide' onClick={save}>应用安全信息</Button>
      {dirty && <View className='reading-note'>还有修改未应用。离开本页后，未应用内容不会用于筛选。</View>}
    </Section>
    {!urgent && !dirty && <>
      {missing.length > 0 && <Notice title='仍有信息未确认'>{missing.join('、')}。可以继续查阅资料，但不能据此判断适合个人食用。</Notice>}
      <Section title='阅读清单' caption={`${safety.state.checks.length}/${SAFETY_CHECKS.length}`}>
        <CheckboxGroup onChange={event => {
          if (!canEdit()) return;
          const result = safetySession.setChecks(event.detail.value, safety.state.revision);
          if (!result.ok) { notify('清单未更新，请重新核对'); return; }
          setDraft(before => ({ ...before, revision: result.state.revision }));
        }}>{SAFETY_CHECKS.map(check => <Label className='safety-check' key={check.id}><Checkbox value={check.id} checked={safety.state.checks.includes(check.id)} color='#31543d' /><Text>{check.label}</Text></Label>)}</CheckboxGroup>
        <View className='reading-note'>勾选只记录阅读进度，不代表完成专业审校或通过食用安全评估。</View>
      </Section>
      {selections.compare.status === 'error' && <StorageNotice onRetry={selections.refresh} />}
      {summary && <Section title='咨询准备摘要'>
        <Text className='consultation-summary' selectable>{summary}</Text>
        <Button id='copy-consultation-summary' className='button button--wide' onClick={() => { if (canEdit() && selections.isCurrent('compare', selections.compare.revision)) void copyConsultationNote(summary); }}>复制摘要</Button>
        <View className='reading-note'>复制会写入系统剪贴板。摘要包含状态与条目名称，不包含具体过敏物、疾病或药品名称；清除本机记录不能撤回已复制内容。</View>
      </Section>}
    </>}
    <Button id='clear-safety-session' className='button button--danger button--wide' onClick={() => { void reset(); }}>清除本次安全信息与清单</Button>
  </Page>;
}

import { normalizeSafetyProfile, assessIngredient, AGE_OPTIONS, EMERGENCY_MESSAGE } from './safety.js';
import type { SafetyProfile } from './safety.js';
import type { CatalogSnapshot } from './catalog.js';

export type SafetyCheckId = 'identity' | 'catalog' | 'allergy' | 'life_stage' | 'conditions' | 'medications' | 'unknowns' | 'no_combination';
export const SAFETY_CHECKS: readonly { readonly id: SafetyCheckId; readonly label: string }[] = Object.freeze(([
  { id: 'identity', label: '核对名称、来源品种、部位与加工形态' },
  { id: 'catalog', label: '阅读目录范围与用途限制' },
  { id: 'allergy', label: '核对已知过敏与交叉过敏疑问' },
  { id: 'life_stage', label: '确认年龄阶段、孕期与哺乳期情况' },
  { id: 'conditions', label: '准备基础疾病与特殊情况信息' },
  { id: 'medications', label: '准备药品、保健品与其他用物清单' },
  { id: 'unknowns', label: '标出资料缺口，向专业人员确认' },
  { id: 'no_combination', label: '不把对比结果当作配伍或食养方案' }
] satisfies { readonly id: SafetyCheckId; readonly label: string }[]).map(check => Object.freeze(check)));

export interface SafetySessionSnapshot {
  readonly revision: number;
  /** Invalidates drafts in mounted but hidden pages after privacy deletion. */
  readonly clearEpoch: number;
  readonly profile: SafetyProfile;
  readonly checks: readonly SafetyCheckId[];
}
export type SafetySessionResult =
  | { readonly ok: true; readonly changed: boolean; readonly state: SafetySessionSnapshot }
  | { readonly ok: false; readonly errorCode: 'stale' | 'invalid_checks' | 'emergency'; readonly state: SafetySessionSnapshot };

/** Deliberately has no storage, network, clipboard or logging dependency. */
export function createSafetySession() {
  let state: SafetySessionSnapshot = Object.freeze({ revision: 0, clearEpoch: 0, profile: normalizeSafetyProfile({}), checks: Object.freeze([]) });
  const listeners = new Set<() => void>();
  const failed = (errorCode: 'stale' | 'invalid_checks' | 'emergency'): SafetySessionResult => ({ ok: false, errorCode, state });
  function commit(profile: SafetyProfile, checks: readonly SafetyCheckId[], clearEpoch = state.clearEpoch): SafetySessionResult {
    state = Object.freeze({ revision: state.revision + 1, clearEpoch, profile, checks });
    const committed = state;
    for (const listener of [...listeners]) {
      // A broken observer must not turn an applied privacy deletion into a
      // reported failure or prevent other pages from receiving invalidation.
      try { listener(); } catch { /* no health data is logged */ }
    }
    return { ok: true, changed: true, state: committed };
  }
  function saveProfile(input: unknown, expectedRevision: number): SafetySessionResult {
    if (expectedRevision !== state.revision) return failed('stale');
    const profile = normalizeSafetyProfile(input);
    if (JSON.stringify(profile) === JSON.stringify(state.profile)) return { ok: true, changed: false, state };
    return commit(profile, Object.freeze([]));
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    isCurrent(revision: number, clearEpoch: number) { return state.revision === revision && state.clearEpoch === clearEpoch; },
    saveProfile,
    /** Checkbox additions stop browsing immediately. Removal requires applying
     * the complete form, so cancelling or leaving it cannot clear an alert. */
    addRedFlags(input: unknown, expectedRevision: number): SafetySessionResult {
      if (expectedRevision !== state.revision) return failed('stale');
      const incoming = normalizeSafetyProfile({ redFlags: input }).redFlags;
      return saveProfile({ ...state.profile, redFlags: [...state.profile.redFlags, ...incoming] }, expectedRevision);
    },
    setChecks(input: unknown, expectedRevision: number): SafetySessionResult {
      if (expectedRevision !== state.revision) return failed('stale');
      if (state.profile.redFlags.length) return failed('emergency');
      if (!Array.isArray(input) || input.length > SAFETY_CHECKS.length) return failed('invalid_checks');
      const checks: SafetyCheckId[] = [];
      for (const id of input) {
        const known = SAFETY_CHECKS.find(check => check.id === id);
        if (!known || checks.includes(known.id)) return failed('invalid_checks');
        checks.push(known.id);
      }
      const ordered = Object.freeze(SAFETY_CHECKS.filter(check => checks.includes(check.id)).map(check => check.id));
      if (ordered.join('|') === state.checks.join('|')) return { ok: true, changed: false, state };
      return commit(state.profile, ordered);
    },
    clear(expectedRevision: number): SafetySessionResult {
      if (expectedRevision !== state.revision) return failed('stale');
      // Even an already-empty session advances the epoch. Old callbacks may
      // still contain unsaved health text, and must never repopulate it.
      return commit(normalizeSafetyProfile({}), Object.freeze([]), state.clearEpoch + 1);
    }
  };
}

/** Export only an explicit, user-requested preparation note, not raw history. */
export function buildConsultationSummary(catalog: CatalogSnapshot, ids: readonly string[], session: SafetySessionSnapshot): string {
  if (session.profile.redFlags.length) return EMERGENCY_MESSAGE;
  const uniqueIds = [...new Set(ids)];
  const selected = uniqueIds.map(id => catalog.ingredients.find(item => item.id === id)).filter(item => item !== undefined);
  const unavailableCount = uniqueIds.length - selected.length;
  const available = selected.filter(item => !assessIngredient(item, session.profile).blocked);
  const excluded = selected.filter(item => assessIngredient(item, session.profile).blocked);
  const status = (value: 'yes' | 'no' | 'unknown') => value === 'yes' ? '是' : value === 'no' ? '否' : '不确定';
  const profile = session.profile;
  return [
    '食材资料咨询准备',
    `资料版本：${catalog.contentVersion}；安全规则：${catalog.rulesVersion}`,
    `待核对条目：${available.map(item => item.name).join('、') || '未选择'}`,
    `已停止选择：${excluded.map(item => item.name).join('、') || '无'}`,
    `当前目录无法读取的记录：${unavailableCount} 项${unavailableCount ? '，请先核对资料版本；未纳入本次摘要判断' : ''}`,
    `年龄阶段：${AGE_OPTIONS.find(option => option.value === profile.ageGroup)?.label ?? '不确定'}`,
    `孕期：${status(profile.pregnancy)}；哺乳期：${status(profile.breastfeeding)}`,
    `有过敏史：${status(profile.allergyStatus)}；有基础疾病或特殊情况：${status(profile.conditionStatus)}；正在用药：${status(profile.medicationStatus)}`,
    `阅读清单：${session.checks.length}/${SAFETY_CHECKS.length} 项`,
    '请另行向医生或药师提供具体过敏物、疾病和用药清单。此摘要不包含这些名称。',
    '资料尚待专业审校；阅读清单和对比不代表适合食用，也不是配伍、剂量或食养方案。'
  ].join('\n');
}

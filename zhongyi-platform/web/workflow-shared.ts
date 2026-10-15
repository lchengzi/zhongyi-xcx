import { useEffect } from 'react';
import type { DraftState } from '../shared/contracts';

export interface Activity { dirty: boolean; busy: boolean }
export type ActivityHandler = (value: Activity) => void;
export function useActivity(dirty: boolean, busy: boolean, changed: ActivityHandler) {
  useEffect(() => { changed({ dirty, busy }); }, [dirty, busy, changed]);
  useEffect(() => () => changed({ dirty: false, busy: false }), [changed]);
}
export const problem = (reason: unknown) => reason instanceof Error ? reason.message : '操作失败，请重试。';
export const stateLabel = (state: DraftState) => ({ draft: '编辑草稿', submitted: '等待编辑审阅', changes_requested: '已退回待修订', editorial_accepted: '编辑审阅通过 · 未发布' })[state];
export const timestamp = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });
export function confirmLeave(activity: Activity) {
  return !activity.busy && (!activity.dirty || window.confirm('当前输入尚未保存，离开会放弃本次修改。继续吗？'));
}

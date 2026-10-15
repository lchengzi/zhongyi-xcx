import { useEffect, useMemo, useRef, useState } from 'react';
import type { IngredientDetail } from '../shared/contracts';
import { parseIngredientDetail, parseReloadedIngredientDetail, parseSavedNote } from '../shared/note-response';
import { requestDecoded, type Credential } from './api';
import { problem } from './workflow-shared';

type CredentialOwner = Exclude<Credential, null>;
interface Owner { token: CredentialOwner; selected: string; attempt: number; controller: AbortController }
interface View { detail: IngredientDetail | null; draft: string; loading: boolean; error: string; feedback: string; busy: boolean; verify: boolean }
const empty = (loading: boolean): View => ({ detail: null, draft: '', loading, error: '', feedback: '', busy: false, verify: false });

export function useEditorialNote(token: CredentialOwner, saved: () => void) {
  const [selected, setSelected] = useState(''), [attempt, setAttempt] = useState(0);
  const owner = useMemo<Owner>(() => ({ token, selected, attempt, controller: new AbortController() }), [token, selected, attempt]);
  const [snapshot, setSnapshot] = useState<{ owner: Owner; value: View } | null>(null);
  const gate = useRef<{ owner: Owner; operation: symbol | null; verify: boolean }>({ owner, operation: null, verify: false });
  if (gate.current.owner !== owner) gate.current = { owner, operation: null, verify: false };
  const view = snapshot?.owner === owner ? snapshot.value : empty(!!selected);
  const current = () => gate.current.owner === owner && !owner.controller.signal.aborted;
  const change = (update: (value: View) => View) => {
    if (current()) setSnapshot(previous => previous?.owner === owner ? { owner, value: update(previous.value) } : previous);
  };
  useEffect(() => {
    // React development StrictMode replays setup/cleanup; every setup owns a
    // fresh controller, and callbacks check that exact controller, not its replacement.
    const controller = new AbortController(); owner.controller = controller;
    if (owner.selected) requestDecoded(`/ingredients/${encodeURIComponent(owner.selected)}`, owner.token,
      value => parseIngredientDetail(value, owner.selected), { signal: controller.signal })
      .then(detail => { if (!controller.signal.aborted) setSnapshot({ owner, value: { ...empty(false), detail, draft: detail.note.text } }); })
      .catch(reason => { if (!controller.signal.aborted) setSnapshot({ owner, value: { ...empty(false), error: problem(reason) } }); });
    return () => controller.abort();
  }, [owner]);

  const busyNow = () => gate.current.operation !== null;
  const dirty = !!view.detail && (view.draft.trim() !== view.detail.note.text || view.verify);
  function choose(id: string): boolean {
    if (id === selected || busyNow()) return false;
    if (dirty && !window.confirm(view.verify ? '当前备注的提交结果尚未核对。切换食材会放弃本页保留的输入，且不能撤销已提交的操作。继续吗？' :
      '当前备注尚未保存，切换食材会放弃这次修改。继续吗？')) return false;
    // End ownership synchronously, before React renders the next selection.
    owner.controller.abort(); setSelected(id); return true;
  }
  async function save(input: string) {
    const detail = view.detail;
    if (!detail || !current() || busyNow() || gate.current.verify || (typeof token !== 'string' && token.user.role === 'reviewer')) return;
    const operation = Symbol('note-save'); gate.current.operation = operation;
    change(value => ({ ...value, busy: true, feedback: '' }));
    try {
      const note = await requestDecoded(`/ingredients/${encodeURIComponent(detail.ingredient.id)}/note`, token,
        value => parseSavedNote(value, detail.note, input), { method: 'PUT', body: JSON.stringify({ text: input, expectedRevision: detail.note.revision }), signal: owner.controller.signal });
      if (!current() || gate.current.operation !== operation) return;
      change(value => ({ ...value, detail: { ...detail, note }, draft: note.text, verify: false,
        feedback: note.text ? '已保存到内容库。' : '备注已清空，修订记录已保留。' }));
      saved();
    } catch (reason) {
      if (current() && gate.current.operation === operation) {
        gate.current.verify = true;
        change(value => ({ ...value, verify: true, feedback: problem(reason) }));
      }
    } finally {
      if (current() && gate.current.operation === operation) { gate.current.operation = null; change(value => ({ ...value, busy: false })); }
    }
  }
  async function reload() {
    const detail = view.detail;
    if (!detail || !current() || busyNow()) return;
    const operation = Symbol('note-reload'); gate.current.operation = operation;
    if (!window.confirm('重新加载会替换当前输入为内容库中的最新备注。继续吗？')) { gate.current.operation = null; return; }
    change(value => ({ ...value, busy: true }));
    try {
      const result = await requestDecoded(`/ingredients/${encodeURIComponent(detail.ingredient.id)}`, token,
        value => parseReloadedIngredientDetail(value, detail), { signal: owner.controller.signal });
      if (!current() || gate.current.operation !== operation) return;
      gate.current.verify = false;
      change(value => ({ ...value, detail: result, draft: result.note.text, verify: false,
        feedback: '已加载最新修订。当前读取不证明先前操作归属；仍需保存时请核对内容后手动提交。' }));
    } catch (reason) {
      if (current() && gate.current.operation === operation) {
        gate.current.verify = true; change(value => ({ ...value, verify: true, feedback: problem(reason) }));
      }
    } finally {
      if (current() && gate.current.operation === operation) { gate.current.operation = null; change(value => ({ ...value, busy: false })); }
    }
  }
  return { ...view, selected, dirty, busyNow, choose, save, reload,
    setDraft: (draft: string) => { if (!busyNow()) change(value => ({ ...value, draft })); },
    retry: () => { if (!busyNow() && !view.detail) { owner.controller.abort(); setAttempt(value => value + 1); } } };
}

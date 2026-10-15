import { COMPARE_LIMIT } from "./compare.js";

export type SelectionKind = "favorites" | "compare";
export const STORE_KEYS: Readonly<Record<SelectionKind, string>> = Object.freeze({
  favorites: "zhongyi_favorites_v1",
  compare: "zhongyi_compare_v1"
});

/** The platform must throw on failure. A missing key may return undefined/null/"". */
export interface StoragePort {
  read(key: string): unknown;
  write(key: string, value: readonly string[]): void;
  remove(key: string): void;
}

export type SelectionReadError = "read_failed" | "invalid_records";
export type SelectionErrorCode = SelectionReadError | "write_failed" | "stale_state" | "invalid_id" | "compare_limit" | "favorites_limit";

export interface ReadySelectionState {
  readonly status: "ready";
  readonly revision: number;
  readonly ids: readonly string[];
}

export type SelectionState = ReadySelectionState | {
  readonly status: "unread";
  readonly revision: number;
  readonly ids: null;
} | {
  readonly status: "error";
  readonly revision: number;
  readonly ids: null;
  readonly previousIds: readonly string[] | null;
  readonly errorCode: SelectionReadError;
};

export type SelectionResult = {
  readonly ok: true;
  readonly changed: boolean;
  readonly state: ReadySelectionState;
} | {
  readonly ok: false;
  readonly changed: false;
  readonly state: SelectionState;
  readonly errorCode: SelectionErrorCode;
};

export interface SelectionStore {
  read(kind: SelectionKind): SelectionState;
  getSnapshot(kind: SelectionKind): SelectionState;
  toggle(kind: SelectionKind, id: string, expectedRevision: number): SelectionResult;
  remove(kind: SelectionKind, id: string, expectedRevision: number): SelectionResult;
  clear(kind: SelectionKind, expectedRevision: number): SelectionResult;
  invalidate(): void;
}

function previousIds(state: SelectionState): readonly string[] | null {
  return state.status === "ready" ? state.ids : state.status === "error" ? state.previousIds : null;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function storedIds(value: unknown, limit: number): readonly string[] | null {
  if (value === "" || value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > limit) return null;
  const ids: string[] = [];
  for (const id of value) {
    if (typeof id !== "string" || !id || id.trim() !== id || id.length > 80) return null;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Synchronous ports avoid overlapping writes; revision tokens reject stale UI events. */
export function createSelectionStore(port: StoragePort, validIds: readonly string[]): SelectionStore {
  const valid = new Set(validIds);
  let revision = 0;
  const states: Record<SelectionKind, SelectionState> = {
    favorites: Object.freeze({ status: "unread", revision: revision++, ids: null }),
    compare: Object.freeze({ status: "unread", revision: revision++, ids: null })
  };

  function failRead(kind: SelectionKind, errorCode: SelectionReadError): SelectionState {
    const state: SelectionState = Object.freeze({
      status: "error", revision: revision++, ids: null, previousIds: previousIds(states[kind]), errorCode
    });
    states[kind] = state;
    return state;
  }

  function read(kind: SelectionKind): SelectionState {
    try {
      const ids = storedIds(port.read(STORE_KEYS[kind]), kind === "compare" ? COMPARE_LIMIT : 500);
      if (ids === null) return failRead(kind, "invalid_records");
      const before = states[kind];
      if (before.status === "ready" && sameIds(before.ids, ids)) return before;
      const state: ReadySelectionState = Object.freeze({ status: "ready", ids: Object.freeze([...ids]), revision: revision++ });
      states[kind] = state;
      return state;
    } catch {
      return failRead(kind, "read_failed");
    }
  }

  function failure(kind: SelectionKind, errorCode: SelectionErrorCode): SelectionResult {
    return { ok: false, changed: false, state: states[kind], errorCode };
  }

  function commit(kind: SelectionKind, next: readonly string[], current: ReadySelectionState, removeKey = false): SelectionResult {
    if (sameIds(next, current.ids) && !removeKey) return { ok: true, changed: false, state: current };
    if (removeKey) {
      // Deletion invalidates events even when the collection was already empty.
      states[kind] = Object.freeze({ status: "ready", ids: current.ids, revision: revision++ });
    }
    try {
      if (removeKey) port.remove(STORE_KEYS[kind]);
      else port.write(STORE_KEYS[kind], [...next]);
    } catch {
      // Some adapters can persist and then throw. Re-read; do not invent rollback success.
      read(kind);
      return failure(kind, "write_failed");
    }
    const actual = read(kind);
    if (actual.status !== "ready") return failure(kind, actual.status === "error" ? actual.errorCode : "read_failed");
    if (!sameIds(actual.ids, next)) return failure(kind, "write_failed");
    return { ok: true, changed: !sameIds(current.ids, next), state: actual };
  }

  function mutate(kind: SelectionKind, id: string | null, expectedRevision: number, action: "toggle" | "remove" | "clear"): SelectionResult {
    const current = read(kind);
    if (current.status !== "ready") return failure(kind, current.status === "error" ? current.errorCode : "read_failed");
    if (current.revision !== expectedRevision) return failure(kind, "stale_state");
    if (action === "clear") return commit(kind, [], current, true);
    if (id === null || !id || id.trim() !== id || id.length > 80) return failure(kind, "invalid_id");
    if (current.ids.includes(id)) return commit(kind, current.ids.filter((item) => item !== id), current);
    if (action === "remove") return { ok: true, changed: false, state: current };
    if (!valid.has(id)) return failure(kind, "invalid_id");
    const limit = kind === "compare" ? COMPARE_LIMIT : 500;
    if (current.ids.length >= limit) return failure(kind, kind === "compare" ? "compare_limit" : "favorites_limit");
    return commit(kind, [...current.ids, id], current);
  }

  return {
    read,
    getSnapshot: (kind) => states[kind],
    toggle: (kind, id, expectedRevision) => mutate(kind, id, expectedRevision, "toggle"),
    remove: (kind, id, expectedRevision) => mutate(kind, id, expectedRevision, "remove"),
    clear: (kind, expectedRevision) => mutate(kind, null, expectedRevision, "clear"),
    invalidate: () => {
      states.favorites = Object.freeze({ status: "unread", revision: revision++, ids: null });
      states.compare = Object.freeze({ status: "unread", revision: revision++, ids: null });
    }
  };
}

export function selectionErrorMessage(code: SelectionErrorCode): string {
  switch (code) {
    case "compare_limit": return "最多对比 4 项资料";
    case "favorites_limit": return "收藏已满，请先整理现有记录";
    case "write_failed": return "保存结果待核对，请查看当前记录";
    case "stale_state": return "记录已更新，请再次操作";
    case "invalid_id": return "条目暂不可用";
    case "invalid_records": return "本机记录格式异常，请重试读取";
    case "read_failed": return "暂时无法读取本机记录，请重试";
  }
}

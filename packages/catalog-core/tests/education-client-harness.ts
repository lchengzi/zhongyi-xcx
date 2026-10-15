import assert from 'node:assert/strict';
import { createEducationClient, type EducationRequest, type EducationScheduler } from '../src/index.js';
import { educationNow, educationBinding } from './education-fixture.js';

export function harness(origin: string | null = 'https://content.example.test') {
  let time = educationNow;
  const timers = new Set<{ at: number; callback: () => void }>();
  const scheduler: EducationScheduler = { after(delay, callback) { const timer = { at: time + delay, callback }; timers.add(timer); return () => { timers.delete(timer); }; } };
  const calls: { input: EducationRequest; aborted: boolean; resolve: (value: { status: number; body: unknown }) => void; reject: () => void }[] = [];
  const client = createEducationClient({ origin, binding: educationBinding, now: () => time, scheduler,
    transport: { request(input) {
      let resolve: (value: { status: number; body: unknown }) => void = () => {};
      let reject = () => {};
      const promise = new Promise<{ status: number; body: unknown }>((done, fail) => { resolve = done; reject = () => fail(new Error('network')); });
      const call = { input, resolve, reject, aborted: false }; calls.push(call);
      return { promise, abort() { call.aborted = true; } };
    } } });
  function tick(milliseconds: number) {
    time += milliseconds;
    for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
      if (timer.at <= time && timers.delete(timer)) timer.callback();
    }
  }
  function call(index = calls.length - 1) { const result = calls[index]; assert.ok(result); return result; }
  return { client, calls, call, tick, setTime: (value: number) => { time = value; }, timerCount: () => timers.size };
}

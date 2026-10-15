import Taro from '@tarojs/taro';
import type { EducationTransport, EducationScheduler } from '@food-education/catalog-core';

/** This adapter deliberately has no body, identity or health-profile input. */
export const publicEducationTransport: EducationTransport = {
  request(input) {
    const task = Taro.request<unknown, never>({ url: input.url, method: 'GET', header: { Accept: input.header.Accept },
      timeout: input.timeoutMs, dataType: 'json', responseType: 'text', enableCache: false, credentials: 'omit' });
    return { promise: task.then(response => ({ status: response.statusCode, body: response.data })), abort: () => task.abort() };
  }
};

export const contentScheduler: EducationScheduler = {
  after(milliseconds, callback) { const timer = setTimeout(callback, milliseconds); return () => clearTimeout(timer); }
};

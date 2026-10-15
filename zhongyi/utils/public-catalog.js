"use strict";

const configuration = require("../config/public-api.js");
const contract = require("./public-catalog-contract");
const { validBaseUrl } = require("./public-api-config");

const REQUEST_PATH = "/api/v1/public/catalog";
const TIMEOUT_MS = 6000;

function initialState(config) {
  return {
    mode: "offline", configured: Boolean(validBaseUrl(config)),
    message: validBaseUrl(config) ? "使用本地历史资料；可按需读取内容服务。" : "未配置内容服务，使用本地历史资料。",
    sourceAsOf: contract.expectedEnvelope().sourceAsOf, loadedAt: ""
  };
}

function platformRequest(options) {
  if (typeof wx === "undefined" || typeof wx.request !== "function") throw new Error("network_api_unavailable");
  return wx.request(options);
}

// Dependency injection is for transport tests, NOT a page-provided URL or profile.
function createClient(config, request) {
  const ownedConfig = { ...config };
  const transport = request || platformRequest;
  let state = initialState(ownedConfig);
  let response = null;
  let pending = null;
  let cancelPending = null;

  function getState() { return { ...state }; }
  function getCatalog() { return response ? contract.forDisplay(response) : null; }
  // Observation only: returning to a page must never initiate another request.
  function getPendingRead() { return pending; }

  function clear() {
    response = null;
    state = initialState(ownedConfig);
    if (cancelPending) cancelPending();
    return getState();
  }

  function load() {
    if (pending) return pending;
    const baseUrl = validBaseUrl(ownedConfig);
    if (!baseUrl) { clear(); return Promise.resolve(getState()); }
    state = { ...initialState(ownedConfig), mode: "loading", message: "正在读取服务目录；本地资料仍可使用。" };
    let resolveResult;
    pending = new Promise((resolve) => { resolveResult = resolve; });
    const result = pending;
    let done = false;
    let task = null;
    let deadline = null;
    function finish(mode, message, payload) {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      response = payload || null;
      state = {
        ...initialState(ownedConfig), mode, message,
        loadedAt: mode === "online" ? new Date().toISOString() : ""
      };
      pending = null;
      cancelPending = null;
      resolveResult(getState());
    }
    function abort() {
      if (task && typeof task.abort === "function") {
        try { task.abort(); } catch (_) { /* Cancellation must still settle. */ }
      }
    }
    cancelPending = () => { finish("offline", initialState(ownedConfig).message); abort(); };
    deadline = setTimeout(() => {
      finish("fallback", "内容服务超时，已回退到本地历史资料。");
      abort();
    }, TIMEOUT_MS + 250);
    try {
      task = transport({
        url: baseUrl + REQUEST_PATH,
        method: "GET",
        header: { Accept: "application/json" },
        timeout: TIMEOUT_MS,
        dataType: "json",
        responseType: "text",
        // No data, query, Authorization, Cookie, account ID or health fields.
        success: (res) => {
          if (done) return;
          if (!res || res.statusCode !== 200) {
            finish("fallback", "内容服务暂不可用，已回退到本地历史资料。"); return;
          }
          try {
            finish("online", "已读取服务目录；安全判断仍由本地规则执行。", contract.validate(res.data));
          } catch (_) {
            finish("fallback", "服务资料与本地版本不兼容，已回退到本地历史资料。");
          }
        },
        fail: () => { finish("fallback", "网络请求失败，已回退到本地历史资料。"); }
      });
    } catch (_) { finish("fallback", "当前无法连接内容服务，已回退到本地历史资料。"); }
    return result;
  }

  return { load, clear, getState, getCatalog, getPendingRead };
}

const client = createClient(configuration);
module.exports = { ...client, createClient, validBaseUrl, REQUEST_PATH, TIMEOUT_MS };

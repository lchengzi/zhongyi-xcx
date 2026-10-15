"use strict";

function validBaseUrl(config) {
  if (!config || Object.keys(config).length !== 1 || typeof config.baseUrl !== "string") return "";
  // Build-owned HTTPS origin only; never credentials, health queries or local shortcuts.
  const match = /^https:\/\/((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})(?::([0-9]{1,5}))?$/.exec(config.baseUrl);
  if (!match || match[1].length > 253 || (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 65535))) return "";
  return config.baseUrl;
}

module.exports = { validBaseUrl };

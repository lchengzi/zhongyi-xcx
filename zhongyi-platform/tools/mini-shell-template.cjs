"use strict";
// Trusted local WXML only. Input/radio representations are deliberately inert:
// this is a browser layout adapter, never a substitute for wx interaction tests.
const assert = require("node:assert/strict");
const { parseTemplate, renderTemplate } = require("./check-mini-card-layout.cjs");

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
}

function prepareShellTemplate(source, cardSource) {
  assert.equal(typeof source, "string");
  let inputs = 0, components = 0;
  const adapted = source.replace(/<input\b(?:[^"'<>]|"[^"]*"|'[^']*')*\/>/g, tag => {
    const a = attributes(tag); inputs++;
    assert(a.value && /^{{[\w.]+}}$/.test(a.value));
    assert(a.class === undefined || /^[\w -]+$/.test(a.class));
    // The placeholder is a source-owned string literal, not executable data.
    const placeholder = JSON.stringify(a.placeholder || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return `<view class="${a.class || ""} probe-input">{{${a.value.slice(2, -2)} || ${placeholder}}}</view>`;
  }).replace(/<ingredient-card\b(?:[^"'<>]|"[^"]*"|'[^']*')*\/>/g, tag => {
    const a = attributes(tag); components++;
    assert.equal(a["wx:for"], "{{rows}}");
    assert.equal(a.item, "{{item}}"); assert.equal(a["wx:key"], "id");
    assert.equal(typeof cardSource, "string");
    return `<block wx:for="{{rows}}" wx:key="id">${cardSource}</block>`;
  }).replace(/(<\/?)(radio-group|radio)(?=[\s/>])/g, (_, opening, name) => opening + (name === "radio" ? "checkbox" : "checkbox-group"));
  return { tree: parseTemplate(adapted, { pageLayout: true }), inputs, components };
}

function renderShell(template, data, { compact = false } = {}) {
  // Defaults match the native component properties; explicit page values win.
  return renderTemplate(template.tree, { favoritesAvailable: true, compareAvailable: true, ...data, compact });
}
module.exports = { prepareShellTemplate, renderShell };

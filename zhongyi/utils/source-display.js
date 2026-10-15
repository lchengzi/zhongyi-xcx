"use strict";

// Project-recorded metadata only; this module neither fetches nor re-verifies a source.
const TYPE_TEXT = Object.freeze({
  official_announcement: "官方公告",
  official_interpretation: "官方解读",
  official_catalog: "官方目录资料",
  official_rule: "官方管理规定",
  official_response: "官方答复",
  official_consumer_information: "官方消费提示"
});

function text(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function recordedDate(value) {
  const date = text(value, "");
  if (!/^\d{4}-\d{2}(?:-\d{2})?$/.test(date)) return "待确认";
  const [year, month, day] = date.split("-").map(Number);
  if (month < 1 || month > 12) return "待确认";
  if (day !== undefined) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (day < 1 || day > days[month - 1]) return "待确认";
  }
  return date.length === 7 ? `${date}（仅记录到月份）` : date;
}

function sourceDisplay(source) {
  const item = source && typeof source === "object" ? source : {};
  return {
    id: text(item.id, ""), title: text(item.title, "来源标题待确认"),
    issuer: text(item.publisher, "发布机构待确认"), url: text(item.url, ""),
    typeText: typeof item.type === "string" && Object.prototype.hasOwnProperty.call(TYPE_TEXT, item.type)
      ? TYPE_TEXT[item.type] : "来源类型待确认",
    publishedAt: recordedDate(item.publishedAt), checkedAt: recordedDate(item.checkedAt),
    scope: text(item.scope, "该来源支持范围待确认")
  };
}

function sourceRecordText(context, source) {
  return [
    `${text(context && context.name, "当前条目")}｜来源记录`,
    `来源：${source.title}`, `发布机构：${source.issuer}`, `记录类型：${source.typeText}`,
    `资料标注发布日期：${source.publishedAt}`, `项目记录的来源复核日期：${source.checkedAt}`,
    `记录的支持范围：${source.scope}`, `来源链接：${source.url || "待补充"}`,
    `内容版本：${text(context && context.contentVersion, "待确认")}`,
    `目录来源核对截至：${recordedDate(context && context.sourceAsOf)}`,
    "以上为项目保存的来源记录，不表示今天已重新核验链接或目录；不构成诊断、处方或个人食用建议。"
  ].join("\n");
}

module.exports = { TYPE_TEXT, recordedDate, sourceDisplay, sourceRecordText };

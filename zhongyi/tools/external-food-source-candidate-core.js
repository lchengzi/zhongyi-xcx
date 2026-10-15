"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { expectedExternalFoodSnapshotDigest } = require("./recipe-digests");

const ROOT = path.resolve(__dirname, "..");
const CATALOG_RELATIVE = "content-private/source-candidates/external-foods/source-catalog.json";
const MANIFEST_RELATIVE = "content-private/source-candidates/external-foods/manifest.json";
const REVIEW_RELATIVE = "content-private/source-candidates/external-foods/review-index.html";
const SCHEMA_VERSION = "1.2.0";
const REVIEW_DOMAINS = Object.freeze(["identity", "regulatory", "food_use", "safety"]);
const SUPPORT_LEVELS = Object.freeze(["bibliographic_only", "partial", "boundary_only"]);
const RESIDUAL_GAP_CODES = Object.freeze([
  "direct_source_missing",
  "mapping_unproven",
  "scope_incomplete",
  "safety_scope_incomplete",
  "professional_review_pending"
]);
const OFFICIAL_HOSTS = Object.freeze(["nhc.gov.cn", "samr.gov.cn", "lswz.gov.cn", "moa.gov.cn", "chinacdc.cn"]);
const VALIDATION_AS_OF = "2026-08-13";

const APPROVED_BINDINGS = Object.freeze({
  "external-source-nhc-meat-gb2707-2016": { targets: ["external-food-whole-hen", "external-food-chicken-meat", "external-food-lean-pork"], url: "https://www.nhc.gov.cn/sps/c100088/201701/56a94850039342f19b5b9c0d28f6900d.shtml", semanticDigest: "sha256:c26dfe1046c3fb8c6097fef6779768835f11965cc005bd13bd2c58d439bbf279" },
  "external-source-nhc-grain-gb2715-2016": { targets: ["external-food-black-bean", "external-food-glutinous-rice-flour", "external-food-japonica-rice-flour", "external-food-japonica-rice"], url: "https://www.nhc.gov.cn/sps/c100088/201701/56a94850039342f19b5b9c0d28f6900d.shtml", semanticDigest: "sha256:f5f518a00c2ba3d75727bcb8c23b1342d3e544726a8f4afb010a760098d9f228" },
  "external-source-nhc-oil-gb2716-2018": { targets: ["external-food-cooking-oil-unspecified", "external-food-sesame-oil"], url: "https://www.nhc.gov.cn/zwgk/jdjd/201806/197265968f414743a0a9db5227f1886c.shtml", semanticDigest: "sha256:e198ab51ff175111e8cc87802ab2b044066ae0aa0bdcd6dd8422ef61fabd8e7e" },
  "external-source-nhc-soy-sauce-gb2717-2018": { targets: ["external-food-soy-sauce"], url: "https://www.nhc.gov.cn/sps/c100088/201806/45f72c52b4a24e23bc89f7767b348854.shtml", semanticDigest: "sha256:69e0d5de06be535c7b5151f96175df65d6e5519a0d5bdbe3fbbdc9051ac7eea9" },
  "external-source-openstd-water-gb5749-2022": { targets: ["external-food-water-unspecified"], url: "https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=99E9C17E3547A3C0CE2FD1FFD9F2F7BE", semanticDigest: "sha256:7239d4ea683ed7c436e8e95134eb5a88eaef8ffafc9d4e846fceb56a69913576" },
  "external-source-nhc-salt-gb2721-2015": { targets: ["external-food-salt"], url: "https://www.nhc.gov.cn/zwgk/tian/201611/a09d4000d6004de09af748665fcc5a85.shtml", semanticDigest: "sha256:d72af6d322627715ae5490459d7a6b0fe10705380a9c6f349020fd4f98652f39" },
  "external-source-samr-production-catalog-2020": { targets: ["external-food-cooking-wine", "external-food-egg-liquid"], url: "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/spscs/art/2023/art_b3565d4b5c374b2f91b6c388e593f8f6.html", semanticDigest: "sha256:245f7f1487cbec518c48173bdd61325d625c24fbe6ebff92309d15ba15e9ecb8" }
});

// The digest binds locator, claims, limitations and the complete source lifecycle.
// It is deliberately independent from the editable catalog.
const APPROVED_EVIDENCE_BINDINGS = Object.freeze({
  "evidence-black-bean-gb1352-2023-identity": { targets: ["external-food-black-bean"], domain: "identity", url: "https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=738C8F5A5E434CF4A0E68BA738366882", semanticDigest: "sha256:68e7567cde28233bef8be0f417920fb66c8229139aae0404dea786e4d50f04f7" },
  "evidence-black-bean-lswz-2024-identity": { targets: ["external-food-black-bean"], domain: "identity", url: "https://www.lswz.gov.cn/html/zcfb/2025-01/02/285904/files/25cbe0c7f20249c795a599184d5a1d46.pdf", semanticDigest: "sha256:c86d925cbbafc15ea4bb4610253ab48bae0a14f452ef9f4b388f93f7fb9d67f6" },
  "evidence-black-bean-nhc-2026-food-use": { targets: ["external-food-black-bean"], domain: "food_use", url: "https://www.nhc.gov.cn/sps/c100087/202604/a69d2fce21e040dc96cbc40b923a06d3/files/%E9%99%84%E4%BB%B65.%E6%88%90%E4%BA%BA%E8%82%8C%E5%B0%91%E7%97%87%E9%A3%9F%E5%85%BB%E6%8C%87%E5%8D%97%EF%BC%882026%E5%B9%B4%E7%89%88%EF%BC%89.pdf", semanticDigest: "sha256:d08610e63d760ec01d01973d1bb04623f37952772da5194b5cef20e997f467ed" },
  "evidence-black-bean-samr-2019-allergen": { targets: ["external-food-black-bean"], domain: "safety", url: "https://www.samr.gov.cn/cms_files/filemanager/1647978232/attach/20233/P020190618522322788915.pdf", semanticDigest: "sha256:f7222d753e1afe7e64a380ba9546d70a1b994f4d5b1944420f09bb4a4125ecb1" },
  "evidence-salt-gb2721-2015-identity": { targets: ["external-food-salt"], domain: "identity", url: "https://www.nhc.gov.cn/zwgk/tian/201611/a09d4000d6004de09af748665fcc5a85.shtml", semanticDigest: "sha256:dab1939aa656d398a800a5a20312a1ffd7d3c9202df34d3c5286e3e31f51d1b5" },
  "evidence-salt-gb2721-2015-regulatory": { targets: ["external-food-salt"], domain: "regulatory", url: "https://www.nhc.gov.cn/zwgk/tian/201611/a09d4000d6004de09af748665fcc5a85.shtml", semanticDigest: "sha256:023f8eec736cded68611fdecd267502d91ffafd489446ffef5c0da0327171519" },
  "evidence-water-gb5749-2022-identity": { targets: ["external-food-water-unspecified"], domain: "identity", url: "https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=99E9C17E3547A3C0CE2FD1FFD9F2F7BE", semanticDigest: "sha256:3a6b03590b3645b2fbd51e8a89002b5f8827a9d9ac74e753fb289c56236110f4" },
  "evidence-water-gb5749-2022-regulatory": { targets: ["external-food-water-unspecified"], domain: "regulatory", url: "https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=99E9C17E3547A3C0CE2FD1FFD9F2F7BE", semanticDigest: "sha256:6446819ba2281333d152e790ba5b068c339513c9324a1176908bfef86ada6d19" },
  "evidence-salt-water-nhc-2026-food-use": { targets: ["external-food-salt", "external-food-water-unspecified"], domain: "food_use", url: "https://www.nhc.gov.cn/sps/c100087/202604/a69d2fce21e040dc96cbc40b923a06d3/files/%E9%99%84%E4%BB%B65.%E6%88%90%E4%BA%BA%E8%82%8C%E5%B0%91%E7%97%87%E9%A3%9F%E5%85%BB%E6%8C%87%E5%8D%97%EF%BC%882026%E5%B9%B4%E7%89%88%EF%BC%89.pdf", semanticDigest: "sha256:d4dd341a6bd9c40d117c0d07183306ae6042361ee9e8f0d6397d90ca30afe424" },
  "evidence-salt-nhc-2019-intake-safety": { targets: ["external-food-salt"], domain: "safety", url: "https://www.nhc.gov.cn/jkj/c100063/201908/956c097c0d1e4e1d8d62238671413c47.shtml", semanticDigest: "sha256:8d6865841faaeccd8285f579886b09e69e4d8f4bd41f62b81bc4631304eda66a" },
  "evidence-water-chinacdc-2025-boiling-safety": { targets: ["external-food-water-unspecified"], domain: "safety", url: "https://www.chinacdc.cn/jkkp/hjjk/szljk/202504/t20250402_305650.html", semanticDigest: "sha256:6bab5c4368678df3348e85756fbe18bc57a47d2f3f3b6f49a127698ca5542ede" },
  "evidence-chicken-gbt19676-2022-identity": { targets: ["external-food-whole-hen", "external-food-chicken-meat"], domain: "identity", url: "https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=07B1E1E84F2C34C9269888CC5F648D70", semanticDigest: "sha256:3ea8f1842a011f9d9fd3fe7dea7e0338de6024e7a56d3cc75a1aad87f8eddbc4" },
  "evidence-lean-pork-gbt9959-2-2008-identity": { targets: ["external-food-lean-pork"], domain: "identity", url: "https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=E116C255D9E4D461D4FBE283347B2942", semanticDigest: "sha256:557eb04cc23e494e14c59d692ca241c41e8861789fb3157d92e2433db76e19c8" },
  "evidence-meat-egg-samr-2021-cooking-safety": { targets: ["external-food-whole-hen", "external-food-chicken-meat", "external-food-lean-pork", "external-food-egg-liquid"], domain: "safety", url: "https://www.samr.gov.cn/zt/ndzt/2021n/splyyxkpzpzbpt/azspplhfcjpljqt/gtsp/art/2023/art_3421c6daf87946e5966e46fcc22595dd.html", semanticDigest: "sha256:8b483cdee02eecf4bf6afebc3552ecac0ed0f80668d675a5f06e245c618e8b4e" },
  "evidence-egg-liquid-samr-2025-industrial-boundary": { targets: ["external-food-egg-liquid"], domain: "identity", url: "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/spscs/art/2025/art_6d0a619af0d54b38bbd50459f2e9c766.html", semanticDigest: "sha256:ab69c0d000f6c7bea7f6a36853c8fe6ead01b39d1515edc5c4327f956bf1c963" },
  "evidence-egg-samr-2025-raw-safety": { targets: ["external-food-egg-liquid"], domain: "safety", url: "https://www.samr.gov.cn/spcjs/yjjl/art/2025/art_526cafde03ce4aa49af67afdc1b59ee8.html", semanticDigest: "sha256:8f68ec3f15b3b7cb283015df1efd07d26965045f0c5b4e8b4fe29d0f97e93349" },
  "evidence-scallion-nyt744-2020-identity": { targets: ["external-food-scallion"], domain: "identity", url: "https://std.samr.gov.cn/hb/search/stdHBDetailed?id=BFEAD835AA8F4233E05397BE0A0AB035", semanticDigest: "sha256:b2318f9c9f0546d90322590c0790498cc4dc115cb7deb40a42bb81e915a31ec7" },
  "evidence-glutinous-rice-flour-lst3240-2012-identity": { targets: ["external-food-glutinous-rice-flour"], domain: "identity", url: "https://www.lswz.gov.cn/html/ywpd/bzzl/2024-01/26/275402/files/f13d0d3cabb24aba8fe61acf4e37ad8f.pdf", semanticDigest: "sha256:0354478305c7ce26fddd940fbb00919f61465b63311e54dd5e962fad10fb9b49" },
  "evidence-glutinous-rice-flour-lswz-2024-title": { targets: ["external-food-glutinous-rice-flour"], domain: "identity", url: "https://www.lswz.gov.cn/html/ywpd/bzzl/2024-01/26/content_275402.shtml", semanticDigest: "sha256:768579fafeda6dea245e22469b2702f0bd96c6fa9593d067d898aca9268d4c13" },
  "evidence-japonica-rice-nyt594-2022-identity": { targets: ["external-food-japonica-rice"], domain: "identity", url: "https://std.samr.gov.cn/hb/search/stdHBDetailed?id=F70290D4DE648350E05397BE0A0A70B2", semanticDigest: "sha256:de985b5ed4d79a62a0184298b4fb1bc64fa57c696592b0fdcbffb02aa0a8f6f2" },
  "evidence-japonica-rice-samr-2023-food-use": { targets: ["external-food-japonica-rice"], domain: "food_use", url: "https://www.samr.gov.cn/spcjs/yjjl/art/2023/art_09bc2dfea6954bd38ee540343d60bf3e.html", semanticDigest: "sha256:6129a0d960cfb3cf602fc9a44a48bf63742313de14d677afb64a12305b9bb557" },
  "evidence-japonica-rice-flour-samr-2020-boundary": { targets: ["external-food-japonica-rice-flour"], domain: "identity", url: "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/spscs/art/2023/art_b3565d4b5c374b2f91b6c388e593f8f6.html", semanticDigest: "sha256:aa099a1dc1b9be92c2a57b716db1c1eb956d2b0020ae157d883818c6821ff3af" },
  "evidence-scallion-chopped-nhc-2026-food-use": { targets: ["external-food-scallion", "external-food-chopped-scallion"], domain: "food_use", url: "https://www.nhc.gov.cn/sps/c100087/202604/a69d2fce21e040dc96cbc40b923a06d3/files/%E9%99%84%E4%BB%B65.%E6%88%90%E4%BA%BA%E8%82%8C%E5%B0%91%E7%97%87%E9%A3%9F%E5%85%BB%E6%8C%87%E5%8D%97%EF%BC%882026%E5%B9%B4%E7%89%88%EF%BC%89.pdf", semanticDigest: "sha256:3bdc188bb9ccf5afdac309e534e845a2d602c6fe229835edf7f2c46f6fd81ec4" },
  "evidence-goji-leaf-nhc-2026-food-use": { targets: ["external-food-goji-leaf"], domain: "food_use", url: "https://www.nhc.gov.cn/sps/c100087/202604/a69d2fce21e040dc96cbc40b923a06d3/files/%E9%99%84%E4%BB%B63.%E6%88%90%E4%BA%BA%E9%AA%A8%E8%B4%A8%E7%96%8F%E6%9D%BE%E7%97%87%E9%A3%9F%E5%85%BB%E6%8C%87%E5%8D%97%EF%BC%882026%E5%B9%B4%E7%89%88%EF%BC%89.pdf", semanticDigest: "sha256:b58074a3b7e55ca24751ea78de744e12be365eef3b2957d6584af579baa24143" },
  "evidence-celery-nyt743-2020-title": { targets: ["external-food-celery"], domain: "identity", url: "https://std.samr.gov.cn/hb/search/stdHBDetailed?id=BFEAD835AA8E4233E05397BE0A0AB035", semanticDigest: "sha256:15bf81bc4a82a085eab30bd15a022d7f73f9bb7b833a0d9e6aa1367885b01978" },
  "evidence-celery-nhc-2026-food-use": { targets: ["external-food-celery"], domain: "food_use", url: "https://www.nhc.gov.cn/sps/c100087/202604/a69d2fce21e040dc96cbc40b923a06d3/files/%E9%99%84%E4%BB%B63.%E6%88%90%E4%BA%BA%E9%AA%A8%E8%B4%A8%E7%96%8F%E6%9D%BE%E7%97%87%E9%A3%9F%E5%85%BB%E6%8C%87%E5%8D%97%EF%BC%882026%E5%B9%B4%E7%89%88%EF%BC%89.pdf", semanticDigest: "sha256:cda0dc13355da8857a29add4563f70dd79e0b71fa6c7fb29894f627e0c901723" },
  "evidence-cooking-wine-samr-2024-identity": { targets: ["external-food-cooking-wine"], domain: "identity", url: "https://www.samr.gov.cn/spcjs/yjjl/art/2024/art_793417ecff0242c18b9f3119da51d1df.html", semanticDigest: "sha256:a9ee75224fd4cbcc475505aecd09ef8e13c081c8db027537423be1973a653a4c" },
  "evidence-soy-sauce-samr-2021-identity": { targets: ["external-food-soy-sauce"], domain: "identity", url: "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/spscs/art/2023/art_a080738bd2dd457aa30d4a4fbdf53a98.html", semanticDigest: "sha256:da5e8977495e89e72044138612bff7c872aef9cb7bc8270f2f688399d582209a" },
  "evidence-sesame-oil-samr-2021-identity": { targets: ["external-food-sesame-oil"], domain: "identity", url: "https://www.samr.gov.cn/xw/sj/art/2023/art_db02e405f5c74d1ab7106521d97afb67.html", semanticDigest: "sha256:e4e84353ef11bacec9fe1fa6bcdb4ff2e7d5fa0b6ea98c2e39563f4761013653" },
  "evidence-unspecified-oil-samr-2021-boundary": { targets: ["external-food-cooking-oil-unspecified"], domain: "identity", url: "https://www.samr.gov.cn/zt/ndzt/2021n/splyyxkpzpzbpt/azspplhfcjpljqt/syy/art/2023/art_58f2676b2a704a7385d4b557f67d0048.html", semanticDigest: "sha256:8ea4d489ef7061c05ce853f96bf058513e18823c1e87ef72ccb13bbbe9f1d467" }
});

const APPROVED_GAP_BINDINGS = Object.freeze({
  "external-food-scallion": { semanticDigest: "sha256:92a1ef297c2d01505903f663e2c4adf7c45ccc7e57e038cd369cbc3bce5df05a" },
  "external-food-chopped-scallion": { semanticDigest: "sha256:4bad2d994c6a482c68daf133a00ca83d6490a0f1400b0f738427d1cbfe1d5249" },
  "external-food-goji-leaf": { semanticDigest: "sha256:e75937a9c47cb4be27828899820c2a8fd87c89d04f6ee9a30cf711130222977c" },
  "external-food-celery": { semanticDigest: "sha256:d350cdf68e5efc80c2da57e5d04ed7390004f7a855e834a9f8034de2770d2989" }
});

class SourceCandidateError extends Error {
  constructor(code, message) { super(message); this.name = "SourceCandidateError"; this.code = code; }
}
function fail(code, message) { throw new SourceCandidateError(code, message); }
function ensure(condition, code, message) { if (!condition) fail(code, message); }
function isObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function nonEmpty(value) { return typeof value === "string" && value.trim().length > 0; }
function exactKeys(value, keys, label) {
  ensure(isObject(value), "shape", `${label} must be an object`);
  ensure(JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys.slice().sort()), "shape", `${label} fields drifted`);
}
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.keys(value).sort().reduce((out, key) => { out[key] = canonicalize(value[key]); return out; }, {});
}
function canonicalJson(value) { return JSON.stringify(canonicalize(value)); }
function sha256Buffer(value) { return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`; }
function sha256Value(value) { return sha256Buffer(Buffer.from(canonicalJson(value), "utf8")); }
function readJson(relative, label) {
  const file = path.resolve(ROOT, ...relative.split("/"));
  ensure(file.startsWith(`${ROOT}${path.sep}`), "path", `${label} escapes the workspace`);
  ensure(fs.existsSync(file), "missing", `${label} is missing`);
  const stat = fs.lstatSync(file);
  ensure(stat.isFile() && !stat.isSymbolicLink(), "path", `${label} must be a regular file`);
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
  catch (error) { fail("json", `${label} is invalid JSON: ${error.message}`); }
}
function checkDate(value, label, nullable = false) {
  if (nullable && value === null) return;
  ensure(/^\d{4}-\d{2}-\d{2}$/.test(value || ""), "date", `${label} is invalid`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  ensure(!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value, "date", `${label} is invalid`);
}
function isOfficialHost(hostname) { return OFFICIAL_HOSTS.some((base) => hostname === base || hostname.endsWith(`.${base}`)); }
function checkUrl(url, label) {
  let parsed;
  try { parsed = new URL(url); } catch (_) { fail("source", `${label} is invalid`); }
  ensure(parsed.protocol === "https:" && isOfficialHost(parsed.hostname), "source", `${label} is not an approved official host`);
}
function checkLegacySource(source, label, reviewAsOf) {
  exactKeys(source, ["publisher", "title", "standardIds", "url", "status", "checkedAt"], label);
  ensure(nonEmpty(source.publisher) && nonEmpty(source.title), "source", `${label} title/publisher is required`);
  ensure(Array.isArray(source.standardIds) && source.standardIds.length && source.standardIds.every(nonEmpty), "source", `${label}.standardIds is invalid`);
  ensure(new Set(source.standardIds).size === source.standardIds.length, "source", `${label}.standardIds contains duplicates`);
  checkUrl(source.url, `${label}.url`);
  ensure(source.status === "published", "source", `${label}.status must remain published`);
  checkDate(source.checkedAt, `${label}.checkedAt`);
  ensure(source.checkedAt <= reviewAsOf, "date", `${label}.checkedAt exceeds reviewAsOf`);
}
function checkEvidenceSource(source, label, reviewAsOf) {
  exactKeys(source, ["publisher", "title", "documentIds", "url", "status", "effectiveState", "publishedAt", "effectiveAt", "checkedAt"], label);
  ensure(nonEmpty(source.publisher) && nonEmpty(source.title), "source", `${label} title/publisher is required`);
  ensure(Array.isArray(source.documentIds) && source.documentIds.length && source.documentIds.every(nonEmpty), "source", `${label}.documentIds is invalid`);
  ensure(new Set(source.documentIds).size === source.documentIds.length, "source", `${label}.documentIds contains duplicates`);
  checkUrl(source.url, `${label}.url`);
  ensure(source.status === "published", "source", `${label}.status must remain published`);
  ensure(["effective", "published_non_normative"].includes(source.effectiveState), "source", `${label}.effectiveState is invalid`);
  checkDate(source.publishedAt, `${label}.publishedAt`);
  checkDate(source.effectiveAt, `${label}.effectiveAt`, true);
  checkDate(source.checkedAt, `${label}.checkedAt`);
  ensure(source.publishedAt <= source.checkedAt && source.checkedAt <= reviewAsOf, "date", `${label} lifecycle exceeds reviewAsOf`);
  if (source.effectiveState === "effective") {
    ensure(source.effectiveAt !== null && source.publishedAt <= source.effectiveAt && source.effectiveAt <= source.checkedAt, "date", `${label} effective lifecycle is invalid`);
  } else ensure(source.effectiveAt === null, "date", `${label} non-normative source cannot claim an effectiveAt date`);
}
function evidenceSemantic(evidence) {
  return {
    id: evidence.id, targetFoodIds: evidence.targetFoodIds, domain: evidence.domain,
    evidenceType: evidence.evidenceType, supportLevel: evidence.supportLevel, claimLocator: evidence.claimLocator,
    preciseClaims: evidence.preciseClaims, limitations: evidence.limitations, source: evidence.source
  };
}
function candidateSemantic(candidate) {
  return {
    id: candidate.id,
    targetFoodIds: candidate.targetFoodIds,
    evidenceType: candidate.evidenceType,
    candidateDomains: candidate.candidateDomains,
    source: candidate.source,
    notes: candidate.notes
  };
}
function gapSemantic(gap) {
  return {
    foodId: gap.foodId,
    gapCode: gap.gapCode,
    reason: gap.reason,
    nextSearch: gap.nextSearch,
    professionalReviewState: gap.professionalReviewState
  };
}

function validateSupportMatrix(evidence, label) {
  const standardTitle = evidence.evidenceType === "official_standard_title_candidate";
  if (standardTitle) ensure(evidence.supportLevel === "bibliographic_only", "scope", `${label} standard-title evidence must remain bibliographic only`);
  if (evidence.domain === "safety") ensure(evidence.supportLevel === "partial", "scope", `${label} safety evidence must remain partial`);
  if (evidence.supportLevel === "boundary_only") ensure(evidence.domain === "identity", "scope", `${label} boundary-only evidence can only annotate identity ambiguity`);
}

function validateCatalog(catalog, recipeData, ruleSet) {
  exactKeys(catalog, ["schemaVersion", "contentVersion", "reviewAsOf", "scope", "publicationEligible", "candidates", "evidenceItems", "targetCoverage", "gaps"], "source catalog");
  ensure(catalog.schemaVersion === SCHEMA_VERSION && nonEmpty(catalog.contentVersion), "version", "source catalog version is unsupported");
  checkDate(catalog.reviewAsOf, "source catalog reviewAsOf");
  ensure(catalog.reviewAsOf <= VALIDATION_AS_OF, "date", "source catalog reviewAsOf exceeds the checked validation date");
  ensure(catalog.scope === "private_research_only" && catalog.publicationEligible === false, "scope", "source catalog must remain private and ineligible");
  ensure(recipeData && recipeData.externalFoods && Array.isArray(recipeData.externalFoods.items), "registry", "externalFoods registry is unavailable");
  ensure(ruleSet && nonEmpty(ruleSet.contentVersion), "registry", "rule set is unavailable");
  const foodById = new Map(recipeData.externalFoods.items.map((food) => [food.id, food]));
  ensure(foodById.size === recipeData.externalFoods.items.length, "registry", "externalFoods registry contains duplicate IDs");
  ensure(Array.isArray(catalog.candidates) && catalog.candidates.length === Object.keys(APPROVED_BINDINGS).length, "coverage", "candidate count drifted");
  ensure(Array.isArray(catalog.evidenceItems) && catalog.evidenceItems.length === Object.keys(APPROVED_EVIDENCE_BINDINGS).length, "coverage", "evidence count drifted");
  ensure(Array.isArray(catalog.targetCoverage) && catalog.targetCoverage.length === foodById.size, "coverage", "target coverage count drifted");
  ensure(Array.isArray(catalog.gaps), "coverage", "gaps must be an array");

  const candidateIds = [], coveredFoodIds = [];
  catalog.candidates.forEach((candidate, index) => {
    const label = `candidates[${index}]`;
    exactKeys(candidate, ["id", "targetFoodIds", "evidenceType", "candidateDomains", "source", "mappingState", "professionalReviewState", "publicationEligible", "runtimePlacements", "directClaimUse", "notes"], label);
    const approved = APPROVED_BINDINGS[candidate.id];
    ensure(approved, "binding", `${label}.id is not approved`);
    ensure(JSON.stringify(candidate.targetFoodIds) === JSON.stringify(approved.targets), "binding", `${label}.targetFoodIds drifted`);
    ensure(candidate.source && candidate.source.url === approved.url, "binding", `${label}.source URL drifted`);
    ensure(["official_standard_category_candidate", "official_standard_candidate", "official_production_license_category_candidate"].includes(candidate.evidenceType), "shape", `${label}.evidenceType is invalid`);
    ensure(Array.isArray(candidate.candidateDomains) && candidate.candidateDomains.length && candidate.candidateDomains.every((value) => ["regulatory_category", "product_scope"].includes(value)), "shape", `${label}.candidateDomains is invalid`);
    ensure(candidate.mappingState === "pending" && candidate.professionalReviewState === "pending", "review", `${label} cannot bypass review`);
    ensure(candidate.publicationEligible === false && candidate.directClaimUse === "prohibited" && Array.isArray(candidate.runtimePlacements) && candidate.runtimePlacements.length === 0, "scope", `${label} is not private-only`);
    ensure(Array.isArray(candidate.notes) && candidate.notes.length && candidate.notes.every(nonEmpty), "shape", `${label}.notes is invalid`);
    checkLegacySource(candidate.source, `${label}.source`, catalog.reviewAsOf);
    ensure(sha256Value(candidateSemantic(candidate)) === approved.semanticDigest, "binding", `${label} semantic summary drifted`);
    candidate.targetFoodIds.forEach((foodId) => { ensure(foodById.has(foodId), "coverage", `${label} targets unknown food`); coveredFoodIds.push(foodId); });
    candidateIds.push(candidate.id);
  });
  ensure(new Set(candidateIds).size === candidateIds.length, "binding", "candidate IDs are duplicated");

  const evidenceIds = [], evidenceClaims = new Set();
  catalog.evidenceItems.forEach((evidence, index) => {
    const label = `evidenceItems[${index}]`;
    exactKeys(evidence, ["id", "targetFoodIds", "domain", "evidenceType", "supportLevel", "claimLocator", "preciseClaims", "limitations", "source", "mappingState", "professionalReviewState", "publicationEligible", "runtimePlacements", "directClaimUse"], label);
    const approved = APPROVED_EVIDENCE_BINDINGS[evidence.id];
    ensure(approved, "binding", `${label}.id is not approved`);
    ensure(JSON.stringify(evidence.targetFoodIds) === JSON.stringify(approved.targets) && evidence.domain === approved.domain && evidence.source && evidence.source.url === approved.url, "binding", `${label} approved target/domain/source drifted`);
    ensure(Array.isArray(evidence.targetFoodIds) && evidence.targetFoodIds.length && new Set(evidence.targetFoodIds).size === evidence.targetFoodIds.length, "coverage", `${label}.targetFoodIds is invalid`);
    ensure(evidence.targetFoodIds.every((id) => foodById.has(id)) && REVIEW_DOMAINS.includes(evidence.domain), "coverage", `${label} target/domain is invalid`);
    ensure(["official_standard_title_candidate", "official_definition_mapping_candidate", "official_food_use_candidate", "official_safety_allergen_candidate", "official_safety_preparation_candidate", "official_identity_definition_candidate", "official_identity_boundary_candidate"].includes(evidence.evidenceType), "shape", `${label}.evidenceType is invalid`);
    ensure(SUPPORT_LEVELS.includes(evidence.supportLevel), "shape", `${label}.supportLevel is invalid`);
    validateSupportMatrix(evidence, label);
    ensure(Array.isArray(evidence.claimLocator) && evidence.claimLocator.length && evidence.claimLocator.every(nonEmpty), "shape", `${label}.claimLocator is invalid`);
    ensure(Array.isArray(evidence.preciseClaims) && evidence.preciseClaims.length && evidence.preciseClaims.every(nonEmpty), "shape", `${label}.preciseClaims is invalid`);
    ensure(Array.isArray(evidence.limitations) && evidence.limitations.length && evidence.limitations.every(nonEmpty), "shape", `${label}.limitations is invalid`);
    ensure(evidence.mappingState === "pending" && evidence.professionalReviewState === "pending", "review", `${label} cannot bypass review`);
    ensure(evidence.publicationEligible === false && evidence.directClaimUse === "prohibited" && Array.isArray(evidence.runtimePlacements) && evidence.runtimePlacements.length === 0, "scope", `${label} is not private-only`);
    checkEvidenceSource(evidence.source, `${label}.source`, catalog.reviewAsOf);
    ensure(sha256Value(evidenceSemantic(evidence)) === approved.semanticDigest, "binding", `${label} semantic summary drifted`);
    const claimKey = canonicalJson({ targetFoodIds: evidence.targetFoodIds, domain: evidence.domain, url: evidence.source.url, claimLocator: evidence.claimLocator, preciseClaims: evidence.preciseClaims });
    ensure(!evidenceClaims.has(claimKey), "binding", `${label} duplicates a target/domain/source claim`);
    evidenceClaims.add(claimKey); evidenceIds.push(evidence.id);
  });
  ensure(new Set(evidenceIds).size === evidenceIds.length, "binding", "evidence IDs are duplicated");

  const gapFoodIds = [];
  catalog.gaps.forEach((gap, index) => {
    const label = `gaps[${index}]`;
    exactKeys(gap, ["foodId", "gapCode", "reason", "nextSearch", "professionalReviewState"], label);
    ensure(foodById.has(gap.foodId), "coverage", `${label} targets unknown external food`);
    ensure(nonEmpty(gap.gapCode) && nonEmpty(gap.reason) && nonEmpty(gap.nextSearch), "shape", `${label} is incomplete`);
    ensure(gap.professionalReviewState === "pending", "review", `${label} cannot bypass review`);
    const approved = APPROVED_GAP_BINDINGS[gap.foodId];
    ensure(approved && sha256Value(gapSemantic(gap)) === approved.semanticDigest, "binding", `${label} semantic summary drifted`);
    gapFoodIds.push(gap.foodId);
  });
  ensure(gapFoodIds.length === Object.keys(APPROVED_GAP_BINDINGS).length && new Set(gapFoodIds).size === gapFoodIds.length, "coverage", "gap food IDs are duplicated or missing");
  const legacyTargets = new Set(coveredFoodIds);
  ensure(legacyTargets.size + gapFoodIds.length === foodById.size && gapFoodIds.every((id) => !legacyTargets.has(id)), "coverage", "legacy candidate/gap coverage must exactly equal externalFoods");

  const coverageFoodIds = [], referencedEvidence = new Map(evidenceIds.map((id) => [id, 0])), referencedCandidates = new Map(candidateIds.map((id) => [id, 0]));
  catalog.targetCoverage.forEach((coverage, index) => {
    const label = `targetCoverage[${index}]`;
    exactKeys(coverage, ["foodId", "domains"], label);
    ensure(foodById.has(coverage.foodId), "coverage", `${label} targets unknown food`);
    exactKeys(coverage.domains, REVIEW_DOMAINS, `${label}.domains`);
    REVIEW_DOMAINS.forEach((domain) => {
      const slot = coverage.domains[domain];
      exactKeys(slot, ["candidateIds", "residualGapCodes", "ready"], `${label}.domains.${domain}`);
      ensure(Array.isArray(slot.candidateIds) && new Set(slot.candidateIds).size === slot.candidateIds.length, "coverage", `${label}.${domain} candidate IDs are invalid`);
      ensure(Array.isArray(slot.residualGapCodes) && slot.residualGapCodes.length && new Set(slot.residualGapCodes).size === slot.residualGapCodes.length && slot.residualGapCodes.every((code) => RESIDUAL_GAP_CODES.includes(code)), "review", `${label}.${domain} residual gap codes are invalid`);
      ensure(slot.ready === false, "review", `${label}.${domain} must remain not ready`);
      if (!slot.candidateIds.length) ensure(slot.residualGapCodes.includes("direct_source_missing"), "review", `${label}.${domain} without candidates must retain direct_source_missing`);
      slot.candidateIds.forEach((id) => {
        if (APPROVED_EVIDENCE_BINDINGS[id]) {
          const evidence = APPROVED_EVIDENCE_BINDINGS[id];
          ensure(evidence.targets.includes(coverage.foodId) && evidence.domain === domain, "binding", `${label}.${domain} cross-target/domain evidence binding`);
          referencedEvidence.set(id, referencedEvidence.get(id) + 1);
          const actual = catalog.evidenceItems.find((item) => item.id === id);
          if (actual.supportLevel === "bibliographic_only") ensure(slot.residualGapCodes.includes("mapping_unproven") && slot.residualGapCodes.includes("professional_review_pending"), "review", `${label}.${domain} bibliographic evidence lost mapping/review gaps`);
          if (actual.supportLevel === "partial") ensure(slot.residualGapCodes.includes("scope_incomplete") && slot.residualGapCodes.includes("professional_review_pending"), "review", `${label}.${domain} partial evidence lost scope/review gaps`);
          if (actual.supportLevel === "boundary_only") {
            const required = ["direct_source_missing", "mapping_unproven", "scope_incomplete", "professional_review_pending"];
            ensure(required.every((code) => slot.residualGapCodes.includes(code)), "review", `${label}.${domain} boundary evidence lost required residual gaps`);
          }
          if (domain === "safety") ensure(slot.residualGapCodes.includes("safety_scope_incomplete"), "review", `${label}.${domain} partial safety evidence lost safety scope gap`);
        } else {
          const approved = APPROVED_BINDINGS[id];
          ensure(domain === "regulatory" && approved && approved.targets.includes(coverage.foodId), "binding", `${label}.${domain} cross-target legacy binding`);
          ensure(["mapping_unproven", "scope_incomplete", "professional_review_pending"].every((code) => slot.residualGapCodes.includes(code)), "review", `${label}.${domain} legacy category lead lost required residual gaps`);
          referencedCandidates.set(id, referencedCandidates.get(id) + 1);
        }
      });
    });
    coverageFoodIds.push(coverage.foodId);
  });
  ensure(new Set(coverageFoodIds).size === foodById.size, "coverage", "targetCoverage food IDs are duplicated or missing");
  evidenceIds.forEach((id) => ensure(referencedEvidence.get(id) === APPROVED_EVIDENCE_BINDINGS[id].targets.length, "coverage", `${id} target coverage references drifted`));
  candidateIds.forEach((id) => ensure(referencedCandidates.get(id) === APPROVED_BINDINGS[id].targets.length, "coverage", `${id} coverage references drifted`));
  return { foodById, candidateTargetIds: [...legacyTargets], gapFoodIds };
}

function buildManifest(catalogInput, recipeInput, ruleInput) {
  const catalog = catalogInput || readJson(CATALOG_RELATIVE, "source catalog");
  const recipeData = recipeInput || require("../data/recipes");
  const ruleSet = ruleInput || require("../data/rule-set");
  const checked = validateCatalog(catalog, recipeData, ruleSet);
  const binding = (foodId) => ({ foodId, externalFoodContentVersion: recipeData.externalFoods.contentVersion, ingredientDigest: expectedExternalFoodSnapshotDigest(checked.foodById.get(foodId)) });
  const candidates = catalog.candidates.map((candidate) => ({ ...JSON.parse(JSON.stringify(candidate)), sourceMetadataDigest: sha256Value(candidate.source), candidateSemanticDigest: sha256Value(candidateSemantic(candidate)), targetBindings: candidate.targetFoodIds.map(binding) }));
  const evidenceItems = catalog.evidenceItems.map((evidence) => ({ ...JSON.parse(JSON.stringify(evidence)), sourceMetadataDigest: sha256Value(evidence.source), evidenceSemanticDigest: sha256Value(evidenceSemantic(evidence)), targetBindings: evidence.targetFoodIds.map(binding) }));
  const targetCoverage = catalog.targetCoverage.map((coverage) => ({ ...JSON.parse(JSON.stringify(coverage)), targetBinding: binding(coverage.foodId) }));
  const gaps = catalog.gaps.map((gap) => ({ ...JSON.parse(JSON.stringify(gap)), gapSemanticDigest: sha256Value(gapSemantic(gap)), targetBinding: binding(gap.foodId) }));
  const candidateDomainSlotCount = targetCoverage.reduce((sum, coverage) => sum + REVIEW_DOMAINS.filter((domain) => coverage.domains[domain].candidateIds.length).length, 0);
  return {
    schemaVersion: SCHEMA_VERSION, contentVersion: catalog.contentVersion, reviewAsOf: catalog.reviewAsOf, scope: catalog.scope,
    sourceCatalogDigest: sha256Value(catalog), externalFoodContentVersion: recipeData.externalFoods.contentVersion, rulesVersion: ruleSet.contentVersion,
    candidateCount: candidates.length, candidateTargetCount: checked.candidateTargetIds.length, gapCount: gaps.length,
    evidenceCount: evidenceItems.length, evidenceTargetCount: new Set(evidenceItems.flatMap((item) => item.targetFoodIds)).size,
    targetCount: targetCoverage.length, domainSlotCount: targetCoverage.length * REVIEW_DOMAINS.length, candidateDomainSlotCount,
    readyDomainSlotCount: 0, publicationEligibleCount: 0, runtimePlacementCount: 0,
    candidates, evidenceItems, targetCoverage, gaps
  };
}
function loadManifest() { return readJson(MANIFEST_RELATIVE, "source candidate manifest"); }

module.exports = { APPROVED_BINDINGS, APPROVED_EVIDENCE_BINDINGS, APPROVED_GAP_BINDINGS, CATALOG_RELATIVE, MANIFEST_RELATIVE, REVIEW_RELATIVE, REVIEW_DOMAINS, RESIDUAL_GAP_CODES, ROOT, SCHEMA_VERSION, SourceCandidateError, buildManifest, candidateSemantic, canonicalJson, evidenceSemantic, gapSemantic, loadManifest, readJson, sha256Value, validateCatalog };

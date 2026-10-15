import { readFileSync } from "node:fs";
import { parseCatalog } from "../src/index.js";

const snapshotPath = process.argv[2];
if (!snapshotPath) throw new Error("Supply the public catalog JSON path");
const input: unknown = JSON.parse(readFileSync(snapshotPath, "utf8"));
const result = parseCatalog(input);
if (!result.ok) {
  console.error(JSON.stringify(result));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    count: result.catalog.ingredients.length,
    catalogAsOf: result.catalog.catalogAsOf,
    contentVersion: result.catalog.contentVersion,
    professionalPending: result.catalog.ingredients.filter((item) => item.professionalReview === "pending").length,
    imageCount: result.catalog.ingredients.filter((item) => item.image !== null).length
  }));
}

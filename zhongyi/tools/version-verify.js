"use strict";

const path = require("path");
const { verifyWorkspace } = require("./version-core");

function parseRoot(argv) {
  const index = argv.indexOf("--root");
  if (index === -1) return path.resolve(__dirname, "..");
  if (!argv[index + 1] || argv.length !== 2) throw new Error("Usage: version-verify.js [--root PATH]");
  return path.resolve(argv[index + 1]);
}

function main(argv) {
  const result = verifyWorkspace(parseRoot(argv));
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`[version-verify] ${error.code || "error"}: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main, parseRoot };

"use strict";

const {
  ROOT, loadPacket, loadResults, loadReviewerRegistry, packetBuildOptionsFromVerification, packetPaths, profileFromCli,
  validatePacket, validateResultsEnvelope
} = require("./professional-review-core");
const { verifyWorkspace } = require("./version-core");

function main(options, profileKey) {
  const paths = packetPaths(profileKey);
  const verified = verifyWorkspace(ROOT);
  const packetBuildOptions = { ...packetBuildOptionsFromVerification(verified), profileKey: paths.profileKey };
  const packet = validatePacket(loadPacket(paths.profileKey), packetBuildOptions);
  const result = validateResultsEnvelope(loadResults(paths.profileKey), packet, loadReviewerRegistry(paths.profileKey), options);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  try { main(undefined, profileFromCli(process.argv.slice(2))); } catch (error) { console.error(`[validate-professional-review] ${error.code || "error"}: ${error.message}`); process.exitCode = 1; }
}
module.exports = { main };

import { preparePrivatePhotoLibrary, readPreparationArgs } from './prepare.js';

async function main() {
  const options = readPreparationArgs(process.argv.slice(2));
  console.log(JSON.stringify(await preparePrivatePhotoLibrary(options), null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Private photo preparation failed'); process.exitCode = 1; });

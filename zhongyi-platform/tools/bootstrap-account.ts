import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openConfiguredStore } from '../server/store-config.js';

const username = process.argv[2];
if (!username) throw new Error('Usage: npm run account:bootstrap -- your-admin-name');
const stores = await openConfiguredStore(JSON.parse(readFileSync(resolve('data/catalog.seed.json'), 'utf8')));
try {
  // Bootstrap only an empty user store; never reset/replace an existing administrator.
  if ((await stores.auth.users()).length) throw new Error('Already initialized. Ask an existing administrator to create accounts.');
  const password = process.env.BOOTSTRAP_PASSWORD || randomBytes(24).toString('base64url');
  const user = await stores.auth.createUser(username, password, 'admin', 'bootstrap-cli', true);
  console.log(`Administrator created: ${user.username}`);
  if (!process.env.BOOTSTRAP_PASSWORD) console.log(`Generated password (save securely; shown once): ${password}`);
  console.log('Password is stored only as a salted scrypt hash. Keep generated credentials out of screenshots and source control.');
} finally { await stores.close(); }

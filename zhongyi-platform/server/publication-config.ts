export function publicationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.EDUCATION_PUBLICATION_ENABLED;
  if (value === undefined || value === '' || value === 'false') return false;
  if (value !== 'true') throw new Error('EDUCATION_PUBLICATION_ENABLED must explicitly be true or false');
  return true;
}

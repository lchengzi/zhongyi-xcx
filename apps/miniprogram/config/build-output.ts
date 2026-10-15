/** A staging build can only target a new UUID directory inside this app. */
export function readBuildOutput(env: Readonly<Record<string, string | undefined>>): string {
  const id = env.FOOD_EDUCATION_VERIFICATION_ID;
  if (id === undefined) return 'dist';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    throw new Error('FOOD_EDUCATION_VERIFICATION_ID: expected a fresh verification UUID');
  }
  return `.verification-builds/${id}`;
}

// Config belongs to the CommonJS Taro app; root Node tests are ESM.
export default { readBuildOutput };

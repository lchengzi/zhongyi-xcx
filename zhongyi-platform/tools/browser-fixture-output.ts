// Test-controller output only. No database, credentials or production settings.
export function browserFixtureOutput(port: number, enabled: string | undefined): { name: string; stdout: 'pipe' | 'ignore' } {
  if (![4311, 4312, 4313, 4314, 4315].includes(port)) throw new Error('Unknown owned browser service');
  return { name: `fixture-${port}`, stdout: enabled === 'true' ? 'pipe' : 'ignore' };
}

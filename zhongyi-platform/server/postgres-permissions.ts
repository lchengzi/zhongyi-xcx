import type { Pool, PoolClient } from 'pg';
import { identifier, MigrationError, TABLE_NAMES, SEQUENCE_TABLES } from './migration-snapshot.js';
import { validatePostgresHistory } from './postgres-upgrades.js';

// Explicit inventory: a future migration must review this policy, not inherit ALL.
export const POSTGRES_RUNTIME_POLICY = {
  migrations: ['SELECT'], ingredients: ['SELECT'], metadata: ['SELECT'],
  postgres_migrations: ['SELECT'], migration_runs: ['SELECT'],
  editorial_notes: ['SELECT', 'INSERT', 'UPDATE'],
  users: ['SELECT', 'INSERT', 'UPDATE'],
  sessions: ['SELECT', 'INSERT', 'DELETE'],
  login_attempts: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  source_records: ['SELECT', 'INSERT', 'UPDATE'],
  content_drafts: ['SELECT', 'INSERT', 'UPDATE'],
  review_tasks: ['SELECT', 'INSERT', 'UPDATE'],
  audit_events: ['SELECT', 'INSERT'], security_events: ['SELECT', 'INSERT'],
  workflow_events: ['SELECT', 'INSERT'], source_versions: ['SELECT', 'INSERT'],
  content_revisions: ['SELECT', 'INSERT'], revision_sources: ['SELECT', 'INSERT'],
  editorial_excerpts: ['SELECT', 'INSERT'], assistant_events: ['SELECT', 'INSERT'],
  excerpt_permissions: ['SELECT', 'INSERT'], assistant_quota_days: ['SELECT', 'INSERT'],
  assistant_reservations: ['SELECT', 'INSERT'], professional_qualifications: ['SELECT', 'INSERT'],
  professional_reviews: ['SELECT', 'INSERT'], source_checks: ['SELECT', 'INSERT'],
  publication_snapshots: ['SELECT', 'INSERT'], publication_approvals: ['SELECT', 'INSERT'],
  publication_events: ['SELECT', 'INSERT'], publication_controls: ['SELECT', 'INSERT'], photo_notes: ['SELECT', 'INSERT'], photo_submissions: ['SELECT', 'INSERT'], photo_rights_reviews: ['SELECT', 'INSERT'], photo_professional_reviews: ['SELECT', 'INSERT']
} as const;
const privileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] as const;
function refused(): never { throw new MigrationError('unsafe_database_permissions',
  '数据库角色、所有权或有效权限不符合运行账号策略；不自动撤权、不修改共享默认权限，也不输出连接或原始数据库错误。'); }

export function runtimePermissionStatements(schema: string, role: string): string[] {
  const target = identifier(schema); const user = identifier(role);
  return [`GRANT USAGE ON SCHEMA ${target} TO ${user}`,
    ...Object.entries(POSTGRES_RUNTIME_POLICY).map(([table, allowed]) =>
      `GRANT ${allowed.join(', ')} ON TABLE ${target}.${identifier(table)} TO ${user}`),
    ...SEQUENCE_TABLES.map((table) => `GRANT USAGE ON SEQUENCE ${target}.${identifier(`${table}_id_seq`)} TO ${user}`)];
}

interface Role { oid: number; rolname: string; rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean;
  rolreplication: boolean; rolbypassrls: boolean; rolcanlogin: boolean; rolinherit: boolean }
const powerful = (role: Role) => role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolreplication || role.rolbypassrls;
const userNamespace = "n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'";

async function inspect(client: PoolClient, schema: string, role: string, requireComplete: boolean, ownerRequired = true) {
  const namespace = (await client.query<{ oid: number; nspowner: number; usage: boolean; grantable: boolean }>(`
    SELECT oid, nspowner, has_schema_privilege($2, oid, 'USAGE') AS usage,
      has_schema_privilege($2, oid, 'USAGE WITH GRANT OPTION') AS grantable
    FROM pg_catalog.pg_namespace WHERE nspname = $1`, [schema, role])).rows[0];
  if (!namespace) refused();
  const roles = (await client.query<Role>('SELECT oid, rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolcanlogin, rolinherit FROM pg_catalog.pg_roles WHERE rolname = $1 OR oid = $2 OR rolname = current_user', [role, namespace.nspowner])).rows;
  const runtime = roles.find((item) => item.rolname === role);
  const actorName = (await client.query<{ actor: string }>('SELECT current_user AS actor')).rows[0].actor;
  const owner = roles.find((item) => item.oid === namespace.nspowner);
  if (!runtime || !owner || runtime.oid === owner.oid || powerful(runtime) || powerful(owner) || !runtime.rolcanlogin || runtime.rolinherit ||
    (ownerRequired ? actorName !== owner.rolname : actorName !== role)) refused();
  // NOINHERIT alone is insufficient: membership can still allow SET ROLE.
  if ((await client.query('SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = $1 OR roleid = $1 LIMIT 1', [runtime.oid])).rowCount) refused();
  const database = (await client.query<{ owner: number; create: boolean; temporary: boolean; connect: boolean }>(`
    SELECT datdba AS owner, has_database_privilege($1, oid, 'CREATE') AS create,
      has_database_privilege($1, oid, 'TEMPORARY') AS temporary, has_database_privilege($1, oid, 'CONNECT') AS connect
    FROM pg_catalog.pg_database WHERE datname = current_database()`, [role])).rows[0];
  if (!database || database.owner === runtime.oid || database.create || database.temporary || !database.connect) refused();
  if ((await client.query(`SELECT 1 FROM pg_catalog.pg_namespace n
    WHERE ${userNamespace} AND (n.nspowner = $1 OR has_schema_privilege($1, n.oid, 'CREATE')) LIMIT 1`, [runtime.oid])).rowCount) refused();
  if (namespace.grantable || (requireComplete && !namespace.usage)) refused();
  const objects = (await client.query<{ oid: number; relname: string; relkind: string; relowner: number }>(`
    SELECT oid, relname, relkind, relowner FROM pg_catalog.pg_class
    WHERE relnamespace = $1 AND relkind NOT IN ('i', 't') ORDER BY relname`, [namespace.oid])).rows;
  const expected = [...Object.keys(POSTGRES_RUNTIME_POLICY), ...SEQUENCE_TABLES.map((name) => `${name}_id_seq`)].sort();
  if (JSON.stringify(objects.map((item) => item.relname)) !== JSON.stringify(expected) ||
      objects.some((item) => item.relowner !== owner.oid || !['r', 'S'].includes(item.relkind))) refused();
  if (JSON.stringify([...TABLE_NAMES, 'postgres_migrations', 'migration_runs'].sort()) !==
      JSON.stringify(Object.keys(POSTGRES_RUNTIME_POLICY).sort())) refused();
  const functions = (await client.query<{ proname: string; proowner: number; prosecdef: boolean; args: number }>(`
    SELECT proname, proowner, prosecdef, pronargs AS args FROM pg_catalog.pg_proc WHERE pronamespace = $1`, [namespace.oid])).rows;
  if (functions.length !== 1 || functions[0].proname !== 'deny_history_change' ||
      functions[0].proowner !== owner.oid || functions[0].prosecdef || functions[0].args !== 0) refused();
  validatePostgresHistory((await client.query(`SELECT version, checksum FROM ${identifier(schema)}.postgres_migrations ORDER BY version`)).rows, true);
  // Effective checks include PUBLIC and column-only privileges, not just ACL text.
  const tableRows = (await client.query<{ relname: string; privilege: string; allowed: boolean; column_allowed: boolean; grantable: boolean; column_grantable: boolean }>(`
    SELECT c.relname, p.privilege, has_table_privilege($1, c.oid, p.privilege) AS allowed,
      CASE WHEN p.privilege IN ('SELECT','INSERT','UPDATE','REFERENCES') THEN has_any_column_privilege($1, c.oid, p.privilege) ELSE false END AS column_allowed,
      has_table_privilege($1, c.oid, p.privilege || ' WITH GRANT OPTION') AS grantable,
      CASE WHEN p.privilege IN ('SELECT','INSERT','UPDATE','REFERENCES') THEN has_any_column_privilege($1, c.oid, p.privilege || ' WITH GRANT OPTION') ELSE false END AS column_grantable
    FROM pg_catalog.pg_class c CROSS JOIN unnest($3::text[]) AS p(privilege)
    WHERE c.relnamespace = $2 AND c.relkind = 'r'`, [role, namespace.oid, privileges])).rows;
  for (const row of tableRows) {
    const wanted = (POSTGRES_RUNTIME_POLICY[row.relname as keyof typeof POSTGRES_RUNTIME_POLICY] as readonly string[]).includes(row.privilege);
    if (row.grantable || row.column_grantable || (!wanted && (row.allowed || row.column_allowed)) || (requireComplete && wanted && !row.allowed)) refused();
  }
  const sequences = (await client.query<{ privilege: string; allowed: boolean; grantable: boolean }>(`
    SELECT p.privilege, has_sequence_privilege($1, c.oid, p.privilege) AS allowed,
      has_sequence_privilege($1, c.oid, p.privilege || ' WITH GRANT OPTION') AS grantable
    FROM pg_catalog.pg_class c CROSS JOIN unnest(ARRAY['USAGE','SELECT','UPDATE']) AS p(privilege)
    WHERE c.relnamespace = $2 AND c.relkind = 'S'`, [role, namespace.oid])).rows;
  for (const row of sequences) if (row.grantable || (row.privilege !== 'USAGE' && row.allowed) || (requireComplete && row.privilege === 'USAGE' && !row.allowed)) refused();
  if ((await client.query(`SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE ${userNamespace} AND n.oid <> $2 AND c.relkind IN ('r','v','m','f','p','S') AND
    (c.relowner = $1 OR CASE WHEN c.relkind = 'S' THEN has_sequence_privilege($1, c.oid, 'USAGE,SELECT,UPDATE')
      ELSE has_table_privilege($1, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
        OR has_any_column_privilege($1, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES') END) LIMIT 1`, [runtime.oid, namespace.oid])).rowCount) refused();
  if ((await client.query(`SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE ${userNamespace} AND (p.proowner = $1 OR (n.oid <> $2 AND has_function_privilege($1, p.oid, 'EXECUTE'))) LIMIT 1`, [runtime.oid, namespace.oid])).rowCount) refused();
}

// Production startup uses its OWN connection and a read-only snapshot. No owner
// password, GRANT, REVOKE, role switch or mutation/repair is involved.
export async function verifyCurrentPostgresRuntimePermissions(pool: Pool, schema: string): Promise<void> {
  identifier(schema);
  const client = await pool.connect(); let broken = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '15s'");
    await client.query('SET LOCAL search_path TO pg_catalog');
    const identity = (await client.query<{ name: string; sessionName: string }>('SELECT current_user AS name, session_user AS "sessionName"')).rows[0];
    if (identity.name !== identity.sessionName) refused();
    const role = identity.name;
    await inspect(client, schema, role, true, false);
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { broken = true; }
    if (error instanceof MigrationError) throw error;
    refused();
  } finally { client.release(broken); }
}

// Operator-only: never called by startup to silently grant or repair permissions.
export async function configurePostgresRuntimePermissions(pool: Pool, schema: string, role: string, apply = false) {
  const statements = runtimePermissionStatements(schema, role);
  const client = await pool.connect(); let broken = false;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '15s'");
    await client.query('SET LOCAL search_path TO pg_catalog');
    // Same migration/write locks; changes outside these application tools need operator coordination.
    await client.query('SELECT pg_catalog.pg_advisory_xact_lock(61037, pg_catalog.hashtext($1))', [schema]);
    await client.query('SELECT pg_catalog.pg_advisory_xact_lock(61038, pg_catalog.hashtext($1))', [schema]);
    await inspect(client, schema, role, !apply);
    if (apply) {
      for (const statement of statements) await client.query(statement);
      await inspect(client, schema, role, true);
    }
    await client.query('COMMIT');
    return { schema, role, action: apply ? 'granted' : 'verified', tables: Object.keys(POSTGRES_RUNTIME_POLICY).length, sequences: SEQUENCE_TABLES.length,
      roleMemberships: 0, grantOptions: false, schemaOwnership: false, deploymentVerified: false } as const;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { broken = true; }
    if (error instanceof MigrationError) throw error;
    refused();
  } finally { client.release(broken); }
}

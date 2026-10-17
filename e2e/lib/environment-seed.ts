import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { ApiClient } from './api-client';
import { resolveBackendContainer } from './backend-container';
import { containerEnvironment, validateMockEnvironment, type Container } from './managed-mock';

/**
 * Seeds versioned harness environments for the simulate flows by running
 * `seeds/environment_versions.py` inside the backend container (the image
 * ships without tests, so the script is self-contained). Every row belongs to
 * the caller's organization and workspace.
 *
 * The credential value never reaches docker's argv: it is handed to docker as
 * a bare `-e SEED_SECRET_VALUE` and inherited from this process's environment.
 */
// TODO: SIM-E2E-005…011 are reserved for the compare, creation, agent-change, nudge,
// draft and rebuild flows; steps 12 and 14 add their seedNudge / feedNudgeTurn here.
const SCRIPT = fileURLToPath(new URL('./seeds/environment_versions.py', import.meta.url));

export interface SeededEnvironment {
  environmentId: string;
  runTestId: string;
  agentDefinitionId: string;
  agentVersionId: string;
  environmentVersionIds: string[];
  suiteVersionIds: string[];
  scenarioKeys: string[];
  variableName: string;
}

interface Scope { organizationId: string; workspaceId: string }

const SANDBOX_PROVIDER = /^(ALK_)?(DAYTONA|E2B)_/;
const PROJECT_LABEL = 'com.docker.compose.project';
const RUNNER_QUEUE = 'simulation_runner';
let providerChecked = false;

/** The backend's compose project; throws, naming only the container, when it has none. */
export function composeProject(name: string, backend: Container): string {
  const project = backend.Config.Labels?.[PROJECT_LABEL];
  if (!project) throw new Error(`STOP: ${name} has no ${PROJECT_LABEL} label, so its workers cannot be found`);
  return project;
}

/** The backend plus every container of its project that polls simulation_runner. */
export function sandboxContainers(backend: Container, listed: Container[]): Container[] {
  const pollers = listed.filter((container) => {
    const env = containerEnvironment(container);
    const excluded = env.TEMPORAL_EXCLUDED_QUEUES?.split(',').map((queue) => queue.trim());
    // Parsed as start_temporal_worker parses it.
    const allQueues = ['true', '1', 'yes'].includes((env.TEMPORAL_ALL_QUEUES ?? '').toLowerCase());
    return env.TEMPORAL_TASK_QUEUE === RUNNER_QUEUE
      || ((allQueues || excluded !== undefined) && !excluded?.includes(RUNNER_QUEUE));
  });
  return [backend, ...pollers.filter((container) => container.Id !== backend.Id)];
}

const inspect = (names: string[]): Container[] =>
  JSON.parse(execFileSync('docker', ['inspect', ...names], { encoding: 'utf-8', stdio: 'pipe' }));

/** Refuses a stack whose backend or simulation_runner worker carries a sandbox-provider key:
 * the flows submit runs, and that worker launches them. Never prints the inspected environment. */
function refuseSandboxProvider(backendName: string): void {
  if (providerChecked) return;
  let backend: Container;
  try {
    [backend] = inspect([backendName]);
  } catch {
    throw new Error(`STOP: ${backendName} could not be inspected`);
  }
  const project = composeProject(backendName, backend);
  let listed: Container[];
  try {
    const ids = execFileSync('docker', ['ps', '-q', '--filter', `label=${PROJECT_LABEL}=${project}`],
      { encoding: 'utf-8', stdio: 'pipe' }).trim().split('\n').filter(Boolean);
    listed = inspect(ids);
  } catch {
    throw new Error(`STOP: the containers of ${backendName}'s compose project could not be listed`);
  }
  for (const container of sandboxContainers(backend, listed)) {
    const env = Object.fromEntries(Object.entries(containerEnvironment(container))
      .filter(([key]) => SANDBOX_PROVIDER.test(key)));
    validateMockEnvironment(container.Config.Labels['com.docker.compose.service'] ?? 'backend', env);
  }
  providerChecked = true;
}

function runSeed<T>(subcommand: string, scope: Scope, vars: Record<string, string>, secret?: string): T {
  const container = resolveBackendContainer();
  refuseSandboxProvider(container);
  const remote = `/tmp/e2e-environment-versions-${randomBytes(4).toString('hex')}.py`;
  const env = { SEED_ORG_ID: scope.organizationId, SEED_WORKSPACE_ID: scope.workspaceId, ...vars };
  const args = ['exec', ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`])];
  if (secret !== undefined) args.push('-e', 'SEED_SECRET_VALUE');
  args.push(container, 'sh', '-c', `cd /app/backend && PYTHONPATH=/app/backend python ${remote} ${subcommand}`);
  try {
    execFileSync('docker', ['cp', SCRIPT, `${container}:${remote}`], { stdio: 'pipe' });
    const stdout = execFileSync('docker', args, {
      encoding: 'utf-8',
      stdio: 'pipe',
      env: secret === undefined ? process.env : { ...process.env, SEED_SECRET_VALUE: secret },
    });
    return JSON.parse(stdout.trim().split('\n').pop() ?? '') as T;
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? '').trim();
    // Never the error's own message: it repeats docker's argv.
    const tail = stderr.split('\n').slice(-3).join(' | ') || `exit ${(error as { status?: number }).status ?? '?'}`;
    throw new Error(`seed ${subcommand} failed: ${tail}`);
  } finally {
    try {
      execFileSync('docker', ['exec', container, 'rm', '-f', remote], { stdio: 'pipe' });
    } catch { /* the container may be gone */ }
  }
}

const suffix = () => `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;

/** A pre-versioning environment run through the real backfill: A1, E1 and S1 as the
 * defaults, the credential on A1's legacy side row, and a ready cached bundle. */
export function seedEnvironment(o: Scope & {
  shape: 'legacy-backfilled';
  scenarios?: number;
  secretValue: string;
  /** Reuse a definition, so a second environment shares the first one's agent. */
  agentDefinitionId?: string;
}): SeededEnvironment {
  return runSeed<SeededEnvironment>('environment', o, {
    // The whole seed runs with versioning off, as production did before the backfill.
    HARNESS_VERSIONING_ENABLED: 'false',
    SEED_SUFFIX: suffix(),
    SEED_SCENARIOS: String(o.scenarios ?? 3),
    ...(o.agentDefinitionId ? { SEED_AGENT_DEFINITION_ID: o.agentDefinitionId } : {}),
  }, o.secretValue);
}

/** One manual edit of the default pair: a new environment or scenario version. */
export function seedEnvironmentEdit(o: Scope & {
  environmentId: string;
  piece: 'environment' | 'suite';
  change: 'add-tool' | 'drop-scenario' | 'add-scenario';
}): { versionId: string } {
  return runSeed('edit', o, { SEED_ENVIRONMENT_ID: o.environmentId, SEED_PIECE: o.piece, SEED_CHANGE: o.change });
}

/** A completed run of these picks with each scenario's trials planted as held, failed or undecided. */
export function seedFinishedRun(o: Scope & {
  environmentId: string;
  picks?: { agent?: string; environment?: string; suite?: string };
  results: Array<{ scenarioKey: string; held: boolean | null }>;
  trials: number;
}): { runJobId: string; executionId: string } {
  return runSeed('finished-run', o, {
    SEED_ENVIRONMENT_ID: o.environmentId,
    SEED_RESULTS: JSON.stringify(o.results),
    SEED_TRIALS: String(o.trials),
    SEED_PICKS: JSON.stringify(o.picks ?? {}),
    SEED_SUFFIX: suffix(),
  });
}

/** The versioning switches the backend serves with an environment (`serialize_job`). */
export async function versioningFlags(api: ApiClient, environmentId: string) {
  const job = await api.get<{ versioning: { enabled: boolean; nudges_enabled: boolean } }>(
    `/simulate/api/harness-jobs/${environmentId}/`);
  return job.versioning;
}

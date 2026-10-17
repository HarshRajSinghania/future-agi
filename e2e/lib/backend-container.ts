import { execFileSync } from 'node:child_process';
import { E2E } from './env';

type DockerRow = [name: string, ports: string];

/**
 * Names the backend container to seed through.
 *
 * The suite runs either against the managed stack (compose project
 * `futureagi-e2e`, what CI and `bin/e2e up` boot) or, in attach mode, against
 * the dev stack (`futureagi`) — and both can be up at once on a developer
 * machine, so a hardcoded name silently seeds the wrong database or, in CI,
 * finds no container at all. A backend container shares its compose project
 * with the Postgres it reads, so the stack the suite is pointed at is the one
 * whose Postgres publishes `E2E_PG_URL`'s port: the same setting every other
 * storage-lane assertion is steered by.
 */
export function resolveBackendContainer(): string {
  const override = process.env.SIMULATE_SEED_CONTAINER;
  if (override) return override;

  const pgPort = new URL(E2E.pgUrl).port || '5432';
  const rows = execFileSync('docker', ['ps', '--format', '{{.Names}}\t{{.Ports}}'], { encoding: 'utf-8' })
    .trim().split('\n').filter(Boolean)
    .map((line) => line.split('\t') as DockerRow);

  const postgres = rows.find(([name, ports]) => /-postgres-\d+$/.test(name) && (ports ?? '').includes(`:${pgPort}->`));
  if (!postgres) {
    throw new Error(
      `simulate seed: no running Postgres container publishes port ${pgPort} (from E2E_PG_URL), `
      + 'so the stack to seed cannot be identified. Bring the stack up, or set '
      + 'SIMULATE_SEED_CONTAINER to the backend container to seed through.',
    );
  }

  const project = postgres[0].replace(/-postgres-\d+$/, '');
  const backend = `${project}-backend-1`;
  if (!rows.some(([name]) => name === backend)) {
    throw new Error(
      `simulate seed: Postgres on port ${pgPort} belongs to compose project "${project}", but `
      + `${backend} is not running. Set SIMULATE_SEED_CONTAINER to override.`,
    );
  }
  return backend;
}

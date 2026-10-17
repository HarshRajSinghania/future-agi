import { test, expect } from '@playwright/test';
import { composeProject, sandboxContainers } from '../lib/environment-seed';
import type { Container } from '../lib/managed-mock';

// Shaped like `docker inspect` output, trimmed to the fields the selection reads.
function inspected(id: string, labels: Record<string, string>, env: string[]): Container {
  return { Id: id, Config: { Labels: labels, Env: env } } as unknown as Container;
}
const service = (project: string, name: string, env: string[]) =>
  inspected(`${project}-${name}`, { 'com.docker.compose.project': project, 'com.docker.compose.service': name }, env);
const ids = (containers: Container[]) => containers.map((container) => container.Id);

test('managed stack: the backend and the worker the overlay sets polling simulation_runner', () => {
  const backend = service('futureagi-e2e', 'backend', ['SERVICE_TYPE=backend']);
  const listed = [
    backend,
    service('futureagi-e2e', 'worker', ['TEMPORAL_ALL_QUEUES=true', 'TEMPORAL_EXCLUDED_QUEUES=']),
    service('futureagi-e2e', 'postgres', ['POSTGRES_DB=tfc']),
    service('futureagi-e2e', 'worker-exact-aggregation', ['TEMPORAL_TASK_QUEUE=exact_aggregation']),
  ];
  expect(composeProject('futureagi-e2e-backend-1', backend)).toBe('futureagi-e2e');
  expect(ids(sandboxContainers(backend, listed))).toEqual(['futureagi-e2e-backend', 'futureagi-e2e-worker']);
});

test('distributed stack: the dedicated simulation_runner worker, not the general one that excludes it', () => {
  const backend = service('futureagi', 'backend', []);
  const listed = [
    backend,
    service('futureagi', 'worker', ['TEMPORAL_ALL_QUEUES=true', 'TEMPORAL_EXCLUDED_QUEUES=agent_compass, simulation_runner']),
    service('futureagi', 'worker-simulation-runner', ['TEMPORAL_TASK_QUEUE=simulation_runner', 'TEMPORAL_ALL_QUEUES=false']),
    service('futureagi', 'worker-default', ['TEMPORAL_TASK_QUEUE=default']),
  ];
  expect(ids(sandboxContainers(backend, listed))).toEqual(['futureagi-backend', 'futureagi-worker-simulation-runner']);
});

test('an all-queues worker without an exclusion list is checked, one that excludes the queue is not', () => {
  const backend = service('futureagi', 'backend', []);
  const listed = [
    backend,
    service('futureagi', 'worker', ['TEMPORAL_ALL_QUEUES=true']),
    service('futureagi', 'worker-all-but-runner', ['TEMPORAL_ALL_QUEUES=true', 'TEMPORAL_EXCLUDED_QUEUES=simulation_runner']),
    service('futureagi', 'worker-off', ['TEMPORAL_ALL_QUEUES=false']),
  ];
  expect(ids(sandboxContainers(backend, listed))).toEqual(['futureagi-backend', 'futureagi-worker']);
});

test('a backend that runs the worker itself is checked once', () => {
  const app = service('futureagi', 'app', ['TEMPORAL_EXCLUDED_QUEUES=']);
  expect(ids(sandboxContainers(app, [app, service('futureagi', 'postgres', [])]))).toEqual(['futureagi-app']);
});

test('a backend without a compose project label fails closed, naming only the container', () => {
  const backend = inspected('backend', {}, ['DAYTONA_API_KEY=real-sandbox-key']);
  expect(() => composeProject('backend', backend))
    .toThrow('STOP: backend has no com.docker.compose.project label, so its workers cannot be found');
  try { composeProject('backend', backend); } catch (error) {
    expect(String(error)).not.toContain('real-sandbox-key');
  }
});

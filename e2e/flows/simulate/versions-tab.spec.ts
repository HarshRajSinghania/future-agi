import { test, expect } from '../../lib/fixtures';
import { seedEnvironment, seedEnvironmentEdit, versioningFlags } from '../../lib/environment-seed';
import { flowAnnotation } from '../../lib/flow-meta';

// Attach prerequisites for every simulate flow: HARNESS_VERSIONING_ENABLED,
// HARNESS_VERSIONING_NUDGES_ENABLED and HARNESS_BUNDLE_CERTIFY_ENABLED on in the
// attached stack's .env, and a worker that polls simulation_runner.
const UI_READY = 60_000;

// HarnessVersionSerializer (futureagi/simulate/serializers/harness_environment.py).
interface Version { id: string; label: string | null; is_default: boolean }
interface Versions { agent: Version[]; environment: Version[]; suite: Version[] }

// The seed's archive holds refund_order, cancel_order and track_order; the
// drop-scenario edit removes the last one (e2e/lib/seeds/environment_versions.py).
const DROPPED_KEY = 'track-order';

test.skip(process.env.E2E_STACK === 'standalone', 'harness seeding targets the Distributed backend container');

// One version row reads its label, then "default" on the default one
// (versions/VersionHeader.jsx).
const row = (v: Version) => new RegExp(`^${v.label}${v.is_default ? 'default' : '(?!default)'}`);

test('SIM-E2E-001: the versions tab lists every version and what changed in one', {
  tag: ['@flow'],
  annotation: flowAnnotation({
    id: 'SIM-E2E-001',
    area: 'simulate',
    userGoal: 'A user sees the agent, environment and scenario versions and what changed in one',
    steps: [
      'seed a backfilled environment with 3 scenarios, then drop one scenario as a manual edit',
      'open the environment on the Versions tab',
      'read the agent, environment and scenario version lists',
      'pick scenario version v2 and read what changed in it',
    ],
    backendChecks: [
      'GET harness-environments/{id}/versions/ returns exactly S2 (default), S1; E1 (default); A1 (default)',
      'PG simulate_hosted_harness_job.suite_version_id is S2',
      'the diff of S2 lists exactly the dropped scenario key under "Scenarios removed"',
    ],
  }),
}, async ({ page, actor, probe }, testInfo) => {
  test.setTimeout(4 * UI_READY);
  const scope = { organizationId: actor.organizationId, workspaceId: actor.workspaceId };
  const seeded = seedEnvironment({ ...scope, shape: 'legacy-backfilled', scenarios: 3,
    secretValue: `e2e-secret-sim1-${testInfo.workerIndex}-${Date.now().toString(36)}` });
  const s2 = seedEnvironmentEdit({ ...scope, environmentId: seeded.environmentId, piece: 'suite',
    change: 'drop-scenario' }).versionId;
  await testInfo.attach('seeded', { contentType: 'application/json',
    body: JSON.stringify({ ...seeded, s2 }, null, 2) });
  const envId = seeded.environmentId;
  const [s1] = seeded.suiteVersionIds;
  const [e1] = seeded.environmentVersionIds;

  test.skip(!(await versioningFlags(actor.api, envId)).enabled, 'HARNESS_VERSIONING_ENABLED is off on this stack');

  await test.step('storage: the environment pins S2', async () => {
    const rows = await probe.pg<{ suite_version_id: string }>(
      'SELECT suite_version_id FROM simulate_hosted_harness_job WHERE id = $1', [envId]);
    expect(rows.map((one) => one.suite_version_id)).toEqual([s2]);
  });

  const versions = await actor.api.get<Versions>(`/simulate/api/harness-environments/${envId}/versions/`);
  await test.step('API: the three lists and their defaults', async () => {
    const pick = (list: Version[]) => list.map(({ id, is_default }) => ({ id, is_default }));
    expect(pick(versions.suite)).toEqual([{ id: s2, is_default: true }, { id: s1, is_default: false }]);
    expect(pick(versions.environment)).toEqual([{ id: e1, is_default: true }]);
    expect(pick(versions.agent)).toEqual([{ id: seeded.agentVersionId, is_default: true }]);
    expect(versions.suite.map((one) => one.label)).toEqual(['v2', 'v1']);
  });

  await test.step('UI: the versions tab shows the same lists', async () => {
    await page.goto(`/dashboard/simulate/environments/${envId}?tab=versions`);
    for (const piece of ['agent', 'environment', 'suite'] as const) {
      await expect(page.getByTestId(`versions-${piece}`).getByRole('listitem'))
        .toHaveText(versions[piece].map(row), { timeout: UI_READY });
    }
  });

  await test.step('UI: what changed in v2 names the dropped scenario', async () => {
    await page.getByTestId('versions-suite').getByRole('button').filter({ hasText: /^v2/ }).click();
    const detail = page.getByTestId('version-detail');
    await expect(detail.getByText('What changed in Scenarios v2')).toBeVisible({ timeout: UI_READY });
    await expect(detail.getByTestId('diff-group-Scenarios removed').locator('p span'))
      .toHaveText([DROPPED_KEY], { timeout: UI_READY });
    await expect(detail.getByTestId('diff-group-Scenarios removed').locator('p')).toHaveCount(2);
  });
});

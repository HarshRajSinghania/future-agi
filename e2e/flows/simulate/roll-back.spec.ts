import { test, expect } from '../../lib/fixtures';
import { seedEnvironment, seedEnvironmentEdit, versioningFlags } from '../../lib/environment-seed';
import { flowAnnotation } from '../../lib/flow-meta';

// Attach prerequisites: see versions-tab.spec.ts.
const UI_READY = 60_000;

// HarnessVersionSerializer / HarnessRunPlanSerializer
// (futureagi/simulate/serializers/harness_environment.py).
interface Version { id: string; is_default: boolean }
interface RunPlan { versions: { environment: { id: string } | null } }

test.skip(process.env.E2E_STACK === 'standalone', 'harness seeding targets the Distributed backend container');

test('SIM-E2E-003: rolling the environment back makes new runs use the older version', {
  tag: ['@flow'],
  annotation: flowAnnotation({
    id: 'SIM-E2E-003',
    area: 'simulate',
    userGoal: 'A user rolls the environment back and new runs use it',
    steps: [
      'seed a backfilled environment, then add a tool as a manual edit so environment v2 is the default',
      'open the environment and its environment-version pin',
      'choose "Roll back to v1" and confirm',
    ],
    backendChecks: [
      'POST versions/environment/{E1}/default/ sends expected_default_id = E2 and returns E1 as the default',
      'PG: the environment pins E1 and E2 stays active',
      'GET run-plan/ resolves the environment version to E1',
    ],
  }),
}, async ({ page, actor, probe }, testInfo) => {
  test.setTimeout(4 * UI_READY);
  const scope = { organizationId: actor.organizationId, workspaceId: actor.workspaceId };
  const seeded = seedEnvironment({ ...scope, shape: 'legacy-backfilled',
    secretValue: `e2e-secret-sim3-${testInfo.workerIndex}-${Date.now().toString(36)}` });
  const e2 = seedEnvironmentEdit({ ...scope, environmentId: seeded.environmentId, piece: 'environment',
    change: 'add-tool' }).versionId;
  await testInfo.attach('seeded', { contentType: 'application/json',
    body: JSON.stringify({ ...seeded, e2 }, null, 2) });
  const envId = seeded.environmentId;
  const [e1] = seeded.environmentVersionIds;

  test.skip(!(await versioningFlags(actor.api, envId)).enabled, 'HARNESS_VERSIONING_ENABLED is off on this stack');

  const moved = await test.step('UI: roll back from the pin', async () => {
    await page.goto(`/dashboard/simulate/environments/${envId}`);
    await page.getByRole('button', { name: 'env v2' }).click({ timeout: UI_READY });
    await page.getByTestId('env-version-item').filter({ hasText: /^v1/ })
      .getByRole('button', { name: 'Roll back to v1' }).click({ timeout: UI_READY });
    const response = page.waitForResponse((res) =>
      res.url().includes(`/versions/environment/${e1}/default/`) && res.request().method() === 'POST',
    { timeout: UI_READY });
    const confirm = page.getByRole('dialog', { name: 'Make v1 the default environment?' });
    await confirm.getByRole('button', { name: 'Make default' }).click();
    const done = await response;
    expect(done.status()).toBe(200);
    // The confirm dialog returns focus to a button the move removed, so send Escape
    // to the list itself.
    await expect(confirm).toBeHidden({ timeout: UI_READY });
    await page.getByRole('dialog', { name: 'Environment versions' }).press('Escape');
    await expect(page.getByRole('button', { name: 'env v1' })).toBeVisible({ timeout: UI_READY });
    return done;
  });

  await test.step('API: the move names E2 as the default it replaces and lands E1', async () => {
    expect(moved.request().postDataJSON()).toEqual({ expected_default_id: e2 });
    const body = (await moved.json()) as { environment: Version[] };
    expect(body.environment.filter((one) => one.is_default).map((one) => one.id)).toEqual([e1]);
  });

  await test.step('storage: E1 is pinned and E2 is kept', async () => {
    const env = await probe.pg<{ environment_version_id: string }>(
      'SELECT environment_version_id FROM simulate_hosted_harness_job WHERE id = $1', [envId]);
    expect(env.map((one) => one.environment_version_id)).toEqual([e1]);
    const kept = await probe.pg<{ status: string }>(
      'SELECT status FROM simulate_harness_environment_version WHERE id = $1', [e2]);
    expect(kept.map((one) => one.status)).toEqual(['active']);
  });

  await test.step('API: a new run would use E1', async () => {
    const plan = await actor.api.get<RunPlan>(`/simulate/api/harness-environments/${envId}/run-plan/`);
    expect(plan.versions.environment?.id).toBe(e1);
  });
});

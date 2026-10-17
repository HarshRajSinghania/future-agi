import type { Page } from '@playwright/test';
import { test, expect } from '../../lib/fixtures';
import { seedEnvironment, versioningFlags } from '../../lib/environment-seed';
import { POLL } from '../../lib/state-probe';
import { flowAnnotation } from '../../lib/flow-meta';

// Attach prerequisites: see versions-tab.spec.ts. Preflight runs on the
// simulation_runner queue, which the E2E overlay makes the worker poll.
const UI_READY = 60_000;

// HarnessVersionSerializer / HarnessRunPlanSerializer
// (futureagi/simulate/serializers/harness_environment.py).
interface Version { id: string; is_default: boolean; preflight_status: string | null }
interface RunPlan { versions: { agent: { id: string } | null } }

test.skip(process.env.E2E_STACK === 'standalone', 'harness seeding targets the Distributed backend container');

/** Opens the agent versions drawer from the Overview tab. */
async function openAgentDrawer(page: Page, envId: string) {
  await page.goto(`/dashboard/simulate/environments/${envId}`);
  await page.getByRole('button', { name: 'Manage versions' }).click({ timeout: UI_READY });
  const credentials = page.getByTestId('agent-credentials');
  await expect(credentials).toBeVisible({ timeout: UI_READY });
  return credentials;
}

test('SIM-E2E-004: a changed credential becomes a checked agent version for this environment only', {
  tag: ['@flow'],
  annotation: flowAnnotation({
    id: 'SIM-E2E-004',
    area: 'simulate',
    userGoal: "A user changes a credential value; it becomes a checked agent version and this environment's default only; the value is never shown",
    steps: [
      'seed two backfilled environments that share one agent version A1, each with its own E2E_GREETING value',
      "open the first environment's Overview and Manage versions",
      'read the stored credential names, choose Change values and enter a new value',
      'save the values and wait for the new version to pass its check',
    ],
    backendChecks: [
      'the secret-values/ request names the environment and its 202 holds none of the three values',
      'GET versions/ shows A2 passed its check and is the default',
      'PG: A2 side row has preflight_status passed, trigger credentials and an encrypted value; the environment pins A2',
      'the second environment still pins A1 in PG, versions/ and run-plan/, and no response of it holds the new value',
      'the page never shows any of the three values after Save',
    ],
  }),
}, async ({ page, actor, probe }, testInfo) => {
  test.setTimeout(4 * UI_READY + POLL.ASYNC_JOB.timeout);
  const suffix = `${testInfo.workerIndex}-${Date.now().toString(36)}`;
  const [s1, s2, s3] = ['a', 'b', 'c'].map((one) => `e2e-secret-sim4${one}-${suffix}`);
  const scope = { organizationId: actor.organizationId, workspaceId: actor.workspaceId };
  const env1 = seedEnvironment({ ...scope, shape: 'legacy-backfilled', secretValue: s1 });
  const env2 = seedEnvironment({ ...scope, shape: 'legacy-backfilled', secretValue: s3,
    agentDefinitionId: env1.agentDefinitionId });
  await testInfo.attach('seeded', { contentType: 'application/json',
    body: JSON.stringify({ env1, env2 }, null, 2) });
  const a1 = env1.agentVersionId;
  expect(env2.agentVersionId).toBe(a1);
  const versionsPath = (id: string) => `/simulate/api/harness-environments/${id}/versions/`;
  const noValue = (text: string) => {
    for (const value of [s1, s2, s3]) expect(text).not.toContain(value);
  };

  test.skip(!(await versioningFlags(actor.api, env1.environmentId)).enabled,
    'HARNESS_VERSIONING_ENABLED is off on this stack');

  const credentials = await openAgentDrawer(page, env1.environmentId);
  await test.step('UI: the stored names are listed, never their values', async () => {
    await expect(credentials.getByTestId('credential-name')).toHaveText([env1.variableName], { timeout: UI_READY });
  });

  const a2 = await test.step('UI: change the value and save it', async () => {
    await credentials.getByRole('button', { name: 'Change values' }).click();
    await expect(credentials.getByLabel('Name 1')).toHaveValue(env1.variableName);
    await credentials.getByLabel('Value 1').fill(s2);
    const saved = page.waitForResponse((res) =>
      res.url().includes('/simulate/api/harness-jobs/secret-values/') && res.request().method() === 'POST',
    { timeout: UI_READY });
    await credentials.getByRole('button', { name: 'Save values' }).click();
    const response = await saved;
    expect(response.status()).toBe(202);
    expect((response.request().postDataJSON() as { environment_id?: string }).environment_id)
      .toBe(env1.environmentId);
    noValue(await response.text());
    return ((await response.json()) as { agent_version: { id: string } }).agent_version.id;
  });
  await testInfo.attach('a2', { contentType: 'text/plain', body: a2 });

  await test.step('API: A2 passes its check and becomes the default', async () => {
    const state = async () => {
      const versions = await actor.api.get<{ agent: Version[] }>(versionsPath(env1.environmentId));
      const found = versions.agent.find((one) => one.id === a2);
      return { preflight: found?.preflight_status ?? null, isDefault: found?.is_default ?? false };
    };
    try {
      await expect.poll(state, POLL.ASYNC_JOB).toEqual({ preflight: 'passed', isDefault: true });
    } catch (error) {
      const now = await state();
      test.skip(now.preflight === 'pending' && Boolean(process.env.E2E_APP_URL),
        'no simulation_runner poller on the attached stack');
      throw error;
    }
  });

  await test.step('UI: the new version shows its check passed', async () => {
    await expect(page.getByTestId(`agent-version-${a2}`).getByText('Check passed'))
      .toBeVisible({ timeout: UI_READY });
  });

  await test.step('storage: A2 is checked, encrypted and pinned by the first environment only', async () => {
    const runtime = await probe.pg<{ preflight_status: string; trigger: string; at: number; encrypted: boolean }>(
      `SELECT preflight_status, trigger, position($1 in coalesce(credential_blob, '')) AS at,
              coalesce(credential_blob LIKE 'enc::%', false) AS encrypted
       FROM simulate_harness_agent_version_runtime WHERE agent_version_id = $2`, [s2, a2]);
    expect(runtime).toEqual([{ preflight_status: 'passed', trigger: 'credentials', at: 0, encrypted: true }]);
    const pins = await probe.pg<{ id: string; agent_version_id: string }>(
      'SELECT id, agent_version_id FROM simulate_hosted_harness_job WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[env1.environmentId, env2.environmentId]]);
    expect(Object.fromEntries(pins.map((one) => [one.id, one.agent_version_id])))
      .toEqual({ [env1.environmentId]: a2, [env2.environmentId]: a1 });
  });

  await test.step('API: the second environment still runs A1 and sees no new value', async () => {
    const versions = await actor.api.get<{ agent: Version[] }>(versionsPath(env2.environmentId));
    expect(versions.agent.filter((one) => one.is_default).map((one) => one.id)).toEqual([a1]);
    const plan = await actor.api.get<RunPlan>(`/simulate/api/harness-environments/${env2.environmentId}/run-plan/`);
    expect(plan.versions.agent?.id).toBe(a1);
    noValue(JSON.stringify(versions) + JSON.stringify(plan));
  });

  await test.step('UI: no value is shown after Save, here or after reopening', async () => {
    await expect(credentials.getByRole('button', { name: 'Save values' })).toHaveCount(0);
    noValue(await page.content());
    await openAgentDrawer(page, env1.environmentId);
    await expect(page.getByTestId(`agent-version-${a2}`)).toBeVisible({ timeout: UI_READY });
    noValue(await page.content());
  });
});

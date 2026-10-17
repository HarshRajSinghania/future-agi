import type { Page, Request, Response } from '@playwright/test';
import { test, expect } from '../../lib/fixtures';
import { seedEnvironment, seedEnvironmentEdit, versioningFlags } from '../../lib/environment-seed';
import { flowAnnotation } from '../../lib/flow-meta';

// Attach prerequisites: see versions-tab.spec.ts.
const UI_READY = 60_000;

// HarnessRunCreateResponseSerializer (futureagi/simulate/serializers/harness_job.py).
interface RunCreated {
  versions: Record<'agent' | 'environment' | 'suite', { id: string } | null>;
  warnings: { code: string }[];
}

test.skip(process.env.E2E_STACK === 'standalone', 'harness seeding targets the Distributed backend container');

/** Opens the run dialog from the workspace header and returns it. */
async function openRunDialog(page: Page, envId: string) {
  await page.goto(`/dashboard/simulate/environments/${envId}`);
  await page.getByRole('button', { name: 'Run simulation', exact: true }).first().click({ timeout: UI_READY });
  const dialog = page.getByRole('dialog', { name: 'Run simulation' });
  await expect(dialog).toBeVisible({ timeout: UI_READY });
  return dialog;
}

/** Submits the dialog and returns the run request and its response. */
async function submitRun(page: Page, envId: string, button: string): Promise<[Request, Response]> {
  const isRun = (url: string) => url.includes(`/simulate/api/harness-environments/${envId}/run/`);
  const responded = page.waitForResponse((res) => isRun(res.url()) && res.request().method() === 'POST',
    { timeout: UI_READY });
  await page.getByRole('dialog', { name: 'Run simulation' }).getByRole('button', { name: button, exact: true }).click();
  const response = await responded;
  if (response.status() !== 202) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`run returned ${response.status()} (${(body as { error?: string }).error ?? 'no error code'})`);
  }
  return [response.request(), response];
}

test('SIM-E2E-002: a run uses the default or an older scenario version and warns before it starts', {
  tag: ['@flow'],
  annotation: flowAnnotation({
    id: 'SIM-E2E-002',
    area: 'simulate',
    userGoal: 'A user runs on the defaults or an older scenario version, sees why a combination is risky, and runs anyway',
    steps: [
      'seed a backfilled environment with 3 scenarios, then drop one scenario so v2 is the default',
      'open Run simulation: the dialog pre-selects the default agent, environment and scenario versions',
      'read the unproved-scenarios warning and choose Run anyway',
      'open Run simulation again, pick scenario version v1 and choose Run anyway',
    ],
    backendChecks: [
      'the first run request names no version and its 202 pins the defaults with a suite_unproved warning',
      'the second run request names only suite_version_id = S1 and its 202 pins S1',
      'PG: the two newest run jobs pin S2 then S1, each with A1 and E1',
      'PG: no job payload of the environment holds the credential value',
    ],
  }),
}, async ({ page, actor, probe }, testInfo) => {
  test.setTimeout(6 * UI_READY);
  const secret = `e2e-secret-sim2-${testInfo.workerIndex}-${Date.now().toString(36)}`;
  const scope = { organizationId: actor.organizationId, workspaceId: actor.workspaceId };
  const seeded = seedEnvironment({ ...scope, shape: 'legacy-backfilled', scenarios: 3, secretValue: secret });
  const s2 = seedEnvironmentEdit({ ...scope, environmentId: seeded.environmentId, piece: 'suite',
    change: 'drop-scenario' }).versionId;
  await testInfo.attach('seeded', { contentType: 'application/json',
    body: JSON.stringify({ ...seeded, s2 }, null, 2) });
  const envId = seeded.environmentId;
  const a1 = seeded.agentVersionId;
  const [e1] = seeded.environmentVersionIds;
  const [s1] = seeded.suiteVersionIds;

  test.skip(!(await versioningFlags(actor.api, envId)).enabled, 'HARNESS_VERSIONING_ENABLED is off on this stack');

  await test.step('UI: the defaults are pre-selected and the warning shows', async () => {
    const dialog = await openRunDialog(page, envId);
    await expect(dialog.getByRole('combobox', { name: 'Agent version' })).toHaveText('v1 (default)', { timeout: UI_READY });
    await expect(dialog.getByRole('combobox', { name: 'Environment version' })).toHaveText('v1 (default)');
    await expect(dialog.getByRole('combobox', { name: 'Scenario version' })).toHaveText('v2 (default)');
    await expect(dialog.getByTestId('run-warning').first()).toBeVisible({ timeout: UI_READY });
  });

  const [firstRequest, firstResponse] = await submitRun(page, envId, 'Run anyway');
  await test.step('API: the first run asks for no version and pins the defaults', async () => {
    const body = firstRequest.postDataJSON() as Record<string, unknown>;
    expect(Object.keys(body).filter((key) => key.endsWith('_version_id'))).toEqual([]);
    const created = (await firstResponse.json()) as RunCreated;
    expect([created.versions.agent?.id, created.versions.environment?.id, created.versions.suite?.id])
      .toEqual([a1, e1, s2]);
    expect(created.warnings.map((one) => one.code)).toContain('suite_unproved');
  });

  await test.step('UI: picking scenario version v1 reloads its members and plan', async () => {
    const dialog = await openRunDialog(page, envId);
    const members = page.waitForResponse((res) =>
      res.url().includes(`/versions/suite/${s1}/members/`), { timeout: UI_READY });
    const plan = page.waitForResponse((res) =>
      res.url().includes('/run-plan/') && res.url().includes(`suite_version_id=${s1}`), { timeout: UI_READY });
    await dialog.getByRole('combobox', { name: 'Scenario version' }).click({ timeout: UI_READY });
    await page.getByRole('option', { name: 'v1', exact: true }).click();
    await Promise.all([members, plan]);
    await expect(dialog.getByRole('combobox', { name: 'Scenario version' })).toHaveText('v1');
  });

  const [secondRequest, secondResponse] = await submitRun(page, envId, 'Run anyway');
  await test.step('API: the second run asks for S1 only and pins it', async () => {
    const body = secondRequest.postDataJSON() as Record<string, unknown>;
    expect(Object.fromEntries(Object.entries(body).filter(([key]) => key.endsWith('_version_id'))))
      .toEqual({ suite_version_id: s1 });
    const created = (await secondResponse.json()) as RunCreated;
    expect(created.versions.suite?.id).toBe(s1);
  });

  await test.step('storage: the run jobs pin what was asked for, and hold no value', async () => {
    const runs = await probe.pg<{ agent_version_id: string; environment_version_id: string; suite_version_id: string }>(
      `SELECT agent_version_id, environment_version_id, suite_version_id FROM simulate_hosted_harness_job
       WHERE environment_id = $1 AND deleted = false ORDER BY created_at DESC`, [envId]);
    expect(runs).toEqual([
      { agent_version_id: a1, environment_version_id: e1, suite_version_id: s1 },
      { agent_version_id: a1, environment_version_id: e1, suite_version_id: s2 },
    ]);
    const leaked = await probe.pg<{ n: string }>(
      `SELECT count(*) AS n FROM simulate_hosted_harness_job
       WHERE (id = $1 OR environment_id = $1) AND payload::text LIKE '%' || $2 || '%'`, [envId, secret]);
    expect(Number(leaked[0].n)).toBe(0);
  });
});

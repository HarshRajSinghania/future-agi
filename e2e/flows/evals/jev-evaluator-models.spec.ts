import type { APIResponse, Locator, Page, Route } from '@playwright/test';
import { test, expect } from '../../lib/fixtures';
import type { StateProbe } from '../../lib/state-probe';
import { E2E } from '../../lib/env';
import { flowAnnotation } from '../../lib/flow-meta';

// The isolated E2E stack runs the OSS image with no Enterprise licence. Jev is
// oss_locked (futureagi/tfc/capabilities/registry.py FEATURE_JEV_MODELS), so the
// capability is denied (LICENSE_MISSING) and any template save that sets a jev-*
// model answers 402 ENTITLEMENT_DENIED (tfc/ee_gates.py jev_gate_for_template).
//
// EVAL-E2E-006 is the real thing: nothing is stubbed, and it asserts the locked
// picker, the 402 and the unchanged Postgres row.
//
// EVAL-E2E-007..010 are NOT real Jev saves. They use fakes, each in one helper:
//   FAKE 1 stubJevEntitlement    the browser's /api/capabilities/ read says jev_models
//                                is allowed (007..010), as FEED-E2E-001 stubs error_feed.
//   FAKE 2 stubTypesafeKeyOnFile the browser's provider-status read says a TypeSafe key
//                                is on file, so the picker selects Jev (008..010). No key
//                                is stored and nothing calls TypeSafe.
//   FAKE 3 swapJevModelIdPastLicenceGate  this template's API calls send gpt-4o where the
//                                page sent jev-latest and read jev-latest back where the
//                                server stored gpt-4o (008..010). Everything else is the
//                                real backend: Jev mapping validation, jsonb storage,
//                                the V1 snapshot and the reload.

// frontend/src/sections/evals/components/ModelSelector.jsx JEV_MODELS and row copy.
const JEV_LABELS = ['Jev 1.13 (pinned)', 'Jev latest'];
const JEV_MODEL = 'jev-latest';
const NO_KEY = 'Add your TypeSafe API key';
const LOCKED = 'Not included in your plan';
// src/hooks/useCapabilities.js; src/api/model/api-keys.js reads the raw rows of
// model_hub GetProviderStatusView; KeyCard posts new keys to API_KEYS.
const CAPABILITIES = '/api/capabilities/';
const PROVIDER_STATUS = '/model-hub/develops/provider-status/';
const API_KEYS = '/model-hub/api-keys/';
// EvalCreatePage: draft POST create-v2 on load, publish PUT <id>/update/;
// EvalDetailPage reads <id>/detail/ and <id>/versions/.
const TEMPLATES = '/model-hub/eval-templates/';
const TEMPLATE_CALL = /^\/model-hub\/eval-templates\/[0-9a-f-]{36}\//;
// FAKE 3's stand-in for jev-latest. The update view stores model and config.model
// verbatim and validates a supplied jev_mapping whatever the model
// (model_hub/utils/jev_templates.py validate_jev_template_save; ee/jev/mapping.py
// never infers compatibility from the model).
const STAND_IN = 'gpt-4o';
// A model the stack saves without a licence check at create (ALERT-E2E-002 uses it).
const SAVEABLE_MODEL = 'turing_large';
const PROMPT = 'Judge whether {{output}} answers the request.';
// README's browser first-paint ceiling, not the default 10-second expect budget.
const UI_READY = 60_000;
const ui = expect.configure({ timeout: UI_READY });

interface Created { result: { id: string } }
interface Capabilities { features: Record<string, { allowed: boolean; reason_code: string | null }> }
interface ProviderRow { provider: string; display_name: string; has_key: boolean; masked_key: string | null }
interface ProviderStatus { result: { providers: ProviderRow[] } }
type JevMapping = {
  question_type: string;
  pass: { criteria_true: string; criteria_false: string } | null;
  choice: { labels: string[]; descriptions: Record<string, string> } | null;
  score: { levels: string[] } | null;
};
type Published = { model: string; output_type: string; jev_mapping: JevMapping;
  choice_scores: Record<string, number> | null };
type TemplateRow = {
  model: string | null; output_type_normalized: string | null; visible_ui: boolean;
  organization_id: string; workspace_id: string | null;
  choices: string[] | null; choice_scores: Record<string, number> | null;
  config: { model?: string; output?: string; jev_mapping?: JevMapping };
};
type VersionRow = { model: string | null; config_snapshot: { model?: string; jev_mapping?: JevMapping } };
type GateRow = { model: string | null; config: Record<string, unknown>; choice_scores: unknown;
  output_type_normalized: string | null; updated_at: Date };
type Exchange = { method: string; path: string; sentModel: unknown; status: number };

const typesafe = (status: ProviderStatus) => {
  const rows = status.result.providers.filter(row => row.provider === 'typesafe');
  expect(rows).toHaveLength(1);
  return rows[0];
};

/** Serves an edited JSON body with the real status and headers, minus the ones
 * that described the original bytes. */
async function fulfillEdited(route: Route, response: APIResponse, json: unknown): Promise<void> {
  const headers = { ...response.headers() };
  for (const name of ['content-length', 'content-encoding', 'transfer-encoding']) delete headers[name];
  await route.fulfill({ status: response.status(), headers, json });
}

/** FAKE 1: jev_models allowed in the browser's capability read; every other
 * feature as the stack reports it. The backend still denies Jev. */
async function stubJevEntitlement(page: Page): Promise<void> {
  await page.route(url => url.pathname === CAPABILITIES, async route => {
    const response = await route.fetch();
    const body = await response.json() as Capabilities;
    body.features.jev_models = { ...body.features.jev_models, allowed: true, reason_code: null };
    await fulfillEdited(route, response, body);
  });
}

function renameModel(value: unknown, from: string, to: string): unknown {
  if (Array.isArray(value)) return value.map(item => renameModel(item, from, to));
  if (value === null || typeof value !== 'object') return value;
  // Object.entries keeps key order, so jsonb's stored key order reaches the page as served.
  return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, key === 'model' && item === from ? to : renameModel(item, from, to)]));
}

/** FAKE 2: the browser's provider-status read shows a TypeSafe key on file,
 * because the picker selects Jev only then. No key is stored and nothing in
 * these flows calls TypeSafe. */
async function stubTypesafeKeyOnFile(page: Page): Promise<void> {
  await page.route(url => url.pathname === PROVIDER_STATUS, async route => {
    const response = await route.fetch();
    const body = await response.json() as ProviderStatus;
    Object.assign(typesafe(body), { has_key: true, masked_key: 'e2e-****' });
    await fulfillEdited(route, response, body);
  });
}

/** FAKE 3. Why it exists: the E2E stack is the OSS image with no licence, so
 * jev_models is locked and the backend answers 402 to any save that sets a jev-*
 * model (EVAL-E2E-006 asserts exactly that, unstubbed). To let the round-trip
 * flows save at all, every call on an eval template sends STAND_IN where the page
 * sent jev-latest, and reads jev-latest back where the server stored STAND_IN.
 * Nothing else is altered: the Jev mapping is validated and stored, jsonb orders
 * the choice scores and the V1 snapshot is written by the real backend. A flow
 * using this helper does not prove a Jev model id can be saved. */
async function swapJevModelIdPastLicenceGate(page: Page, exchanges: Exchange[]): Promise<void> {
  await page.route(url => TEMPLATE_CALL.test(url.pathname), async route => {
    const request = route.request();
    const sent = request.postData() ? request.postDataJSON() as Record<string, unknown> : undefined;
    const headers = { ...request.headers() };
    delete headers['content-length'];
    const response = await route.fetch(sent === undefined ? undefined
      : { headers, postData: JSON.stringify(renameModel(sent, JEV_MODEL, STAND_IN)) });
    exchanges.push({ method: request.method(), path: new URL(request.url()).pathname,
      sentModel: sent?.model, status: response.status() });
    if (!(response.headers()['content-type'] ?? '').includes('json')) return route.fulfill({ response });
    await fulfillEdited(route, response, renameModel(await response.json(), STAND_IN, JEV_MODEL));
  });
}

/** Opens the create page (which drafts a template) on the LLM-As-A-Judge tab. */
async function openJudgeEditor(page: Page): Promise<string> {
  const draft = page.waitForResponse(r => new URL(r.url()).pathname === `${TEMPLATES}create-v2/` &&
    r.request().method() === 'POST');
  await page.goto('/dashboard/evaluations/create', { waitUntil: 'domcontentloaded' });
  const response = await draft;
  expect(response.status()).toBe(200);
  const id = ((await response.json()) as Created).result.id;
  await ui(page).toHaveURL(new RegExp(`/dashboard/evaluations/create/${id}$`));
  await page.getByRole('tab', { name: 'LLM-As-A-Judge', exact: true }).click();
  return id;
}

async function openModelPicker(page: Page): Promise<Locator> {
  // Turing is denied on this stack too, so the create page clears its seeded
  // turing_large and the pill starts empty (EvalCreatePage fagiModelsDenied).
  await page.getByText('Select model', { exact: true }).first().click();
  const search = page.getByPlaceholder('Search models...');
  await ui(search).toBeVisible();
  return page.locator('.MuiPopover-paper').filter({ has: search });
}

const jevRows = (picker: Locator) => picker.getByRole('menuitem').filter({ hasText: /^Jev / });

/** All three fakes, for the round-trip flows 008..010. */
async function fakeJevSaveOnUnlicensedStack(page: Page, exchanges: Exchange[]): Promise<void> {
  await stubJevEntitlement(page);
  await stubTypesafeKeyOnFile(page);
  await swapJevModelIdPastLicenceGate(page, exchanges);
}

/** Drafts, names and prompts an LLM judge, chooses Jev latest, applies the
 * output configuration and publishes. Returns the template id and the body the
 * browser sent (before FAKE 3's swap). */
async function authorJevEvaluator(page: Page, name: string,
  configure: () => Promise<void>): Promise<{ id: string; sent: Published }> {
  const id = await openJudgeEditor(page);
  await page.getByPlaceholder('Eg: Hallucination detector').fill(name);
  // MessageEditorBlock's PromptEditor uses a Quill contenteditable, not textarea.
  await page.locator('.ql-editor[contenteditable="true"]').first().fill(PROMPT);
  const picker = await openModelPicker(page);
  const latest = jevRows(picker).filter({ hasText: /^Jev latest/ });
  // With a key on file the row shows its model id instead of the key prompt.
  await ui(latest.getByText(JEV_MODEL, { exact: true })).toBeVisible();
  await latest.click();
  await ui(page.getByPlaceholder('Search models...')).toBeHidden();
  await ui(page.getByText('Jev latest', { exact: true })).toBeVisible();
  await configure();
  const published = page.waitForResponse(r => new URL(r.url()).pathname === `${TEMPLATES}${id}/update/` &&
    r.request().method() === 'PUT' && r.request().postDataJSON()?.publish === true);
  await page.getByRole('button', { name: 'Save Evaluation', exact: true }).click();
  const response = await published;
  expect(response.status()).toBe(200);
  await ui(page).toHaveURL(new RegExp(`/dashboard/evaluations/${id}(\\?.*)?$`));
  return { id, sent: response.request().postDataJSON() as Published };
}

/** The template row and its versions, after the publish response has returned. */
async function stored(probe: StateProbe, id: string): Promise<{ row: TemplateRow; versions: VersionRow[] }> {
  const rows = await probe.pg<TemplateRow>(
    `SELECT model, output_type_normalized, visible_ui, organization_id, workspace_id,
            choices, choice_scores, config
       FROM model_hub_evaltemplate WHERE id = $1`, [id]);
  expect(rows).toHaveLength(1);
  const versions = await probe.pg<VersionRow>(
    `SELECT model, config_snapshot FROM model_hub_eval_template_version
      WHERE eval_template_id = $1 ORDER BY version_number`, [id]);
  return { row: rows[0], versions };
}

/** What every published Jev template shares: scope, FAKE 3's stand-in id, and a
 * V1 snapshot holding the same validated mapping. */
function expectPublishedJev(row: TemplateRow, versions: VersionRow[],
  actor: { organizationId: string; workspaceId: string }): void {
  expect(row).toMatchObject({ visible_ui: true, organization_id: actor.organizationId,
    workspace_id: actor.workspaceId, model: STAND_IN });
  expect(row.config.model).toBe(STAND_IN);
  expect(row.config.jev_mapping).toMatchObject({ revision: 'jev-map-v1' });
  expect(versions).toHaveLength(1);
  expect(versions[0].model).toBe(STAND_IN);
  expect(versions[0].config_snapshot.jev_mapping).toEqual(row.config.jev_mapping);
}

const choiceRow = (name: Locator) => name.locator('xpath=ancestor::div[.//*[@role="combobox"]][1]');

test('EVAL-E2E-006: Jev models are listed but locked on a self-hosted stack without a licence', {
  tag: ['@flow'],
  annotation: flowAnnotation({
    id: 'EVAL-E2E-006', area: 'evals',
    userGoal: 'See, with nothing stubbed, that Jev evaluator models exist but cannot be chosen or saved on an unlicensed self-hosted install',
    steps: ['open the evaluator create page on the LLM-As-A-Judge tab',
      'open the model picker and read the Jev group', 'hover a locked Jev row',
      'save a Turing-model evaluator through the create API, then try to switch it to jev-latest through the update API',
      'try to create a Jev evaluator through the create API'],
    backendChecks: [
      'the capabilities API denies jev_models, as it does turing_models, for the actor org',
      'the provider-status API lists TypeSafe with no key',
      'the update to jev-latest is refused 402 ENTITLEMENT_DENIED for feature jev and the PG template row (model, config, scores, output type, updated_at) is unchanged',
      'create-v2 with jev-latest is refused the same way and no template row with that name exists',
    ],
    browserChecks: [
      'the picker lists exactly Jev 1.13 (pinned) then Jev latest, below FutureAGI Models',
      'both Jev rows are disabled, prompt for a TypeSafe API key and explain "Not included in your plan"',
    ],
  }),
}, async ({ page, actor, probe, request }, testInfo) => {
  test.setTimeout(240_000); // Three UI_READY browser stages (draft, picker, tooltip) 180 + API/PG reads and headroom 60.
  page.setDefaultTimeout(UI_READY);
  const suffix = `${testInfo.workerIndex}-${Date.now().toString(36)}`;

  await test.step('backend check 1: the stack denies Jev to this org', async () => {
    const caps = await actor.api.get<Capabilities>(CAPABILITIES);
    await testInfo.attach('capabilities', { contentType: 'application/json', body: JSON.stringify({
      jev_models: caps.features.jev_models, turing_models: caps.features.turing_models }) });
    expect(caps.features.jev_models.allowed).toBe(false);
    expect(caps.features.turing_models.allowed).toBe(false);
  });
  await test.step('backend check 2: no TypeSafe key on file', async () => {
    const row = typesafe(await actor.api.get<ProviderStatus>(PROVIDER_STATUS));
    expect(row).toMatchObject({ display_name: 'TypeSafe', has_key: false, masked_key: null });
  });

  await test.step('UI: the picker lists both Jev models, locked, under FutureAGI Models', async () => {
    const draftId = await openJudgeEditor(page);
    await testInfo.attach('draft-template', { contentType: 'application/json',
      body: JSON.stringify({ draftId, organizationId: actor.organizationId }) });
    const picker = await openModelPicker(page);
    const rows = jevRows(picker);
    await ui(rows).toHaveCount(JEV_LABELS.length);
    for (const [index, label] of JEV_LABELS.entries()) {
      const row = rows.nth(index);
      await ui(row.getByText(label, { exact: true })).toBeVisible();
      await ui(row.getByText(NO_KEY, { exact: true })).toBeVisible();
      await ui(row).toBeDisabled();
    }
    const turingTop = (await picker.getByText('FutureAGI Models', { exact: true }).boundingBox())!.y;
    const jevTop = (await picker.getByText('Jev models', { exact: true }).boundingBox())!.y;
    expect(jevTop).toBeGreaterThan(turingTop);
    await testInfo.attach('locked-picker', { body: await page.screenshot(), contentType: 'image/png' });
    // EvaluatorModelRow wraps the disabled MenuItem in a span so its tooltip still
    // opens. A Turing row's tooltip can still be open from the pointer's path, so
    // name the one this row opens; an unlocked row has an empty title and none.
    await rows.nth(1).locator('xpath=..').hover();
    await ui(page.getByRole('tooltip', { name: LOCKED, exact: true })).toBeVisible();
  });

  const denied = { code: 'ENTITLEMENT_DENIED', feature: 'jev', upgrade_required: true };
  await test.step('backend check 3: switching a saved evaluator to Jev is refused and its row is unchanged', async () => {
    // Wire body per the harness cheatsheet's create-v2 shape.
    const saved = await actor.api.post<Created>(`${TEMPLATES}create-v2/`, {
      name: `e2e-jev-saved-${suffix}`, eval_type: 'llm', instructions: PROMPT, model: SAVEABLE_MODEL,
      output_type: 'pass_fail', pass_threshold: 0.5,
    });
    const id = saved.result.id;
    const read = () => probe.pg<GateRow>(
      `SELECT model, config, choice_scores, output_type_normalized, updated_at
         FROM model_hub_evaltemplate WHERE id = $1`, [id]);
    const before = await read();
    expect(before).toHaveLength(1);
    expect(before[0].model).toBe(SAVEABLE_MODEL);
    // ApiClient has no PUT, so send the bearer and scope headers it would send.
    // The body is what EvalCreatePage publishes for a Jev pass/fail evaluator.
    const response = await request.put(`${E2E.apiUrl}${TEMPLATES}${id}/update/`, {
      headers: { Authorization: `Bearer ${actor.tokens.access}`,
        'X-Organization-Id': actor.organizationId, 'X-Workspace-Id': actor.workspaceId },
      data: { model: JEV_MODEL, output_type: 'pass_fail', jev_mapping: { revision: 'jev-map-v1',
        question_type: 'noul', pass: { criteria_true: '', criteria_false: '' }, choice: null, score: null,
        include_messages: false } },
    });
    const body = await response.json() as Record<string, unknown>;
    await testInfo.attach('refused-update', { contentType: 'application/json',
      body: JSON.stringify({ id, status: response.status(), body }) });
    expect(response.status()).toBe(402);
    expect(body).toMatchObject(denied);
    expect(await read()).toEqual(before);
  });
  await test.step('backend check 4: creating a Jev evaluator is refused and stores nothing', async () => {
    const name = `e2e-jev-refused-${suffix}`;
    await expect(actor.api.post(`${TEMPLATES}create-v2/`, {
      name, eval_type: 'llm', instructions: PROMPT, model: JEV_MODEL,
      output_type: 'pass_fail', pass_threshold: 0.5,
    })).rejects.toMatchObject({ status: 402, body: denied });
    const rows = await probe.pg<{ id: string }>(
      'SELECT id FROM model_hub_evaltemplate WHERE name = $1 AND organization_id = $2',
      [name, actor.organizationId]);
    expect(rows).toEqual([]);
  });
});

test('EVAL-E2E-007: choosing a Jev model without a TypeSafe key opens the keys drawer on TypeSafe', {
  tag: ['@flow'],
  annotation: flowAnnotation({
    id: 'EVAL-E2E-007', area: 'evals',
    userGoal: 'Choose a Jev evaluator model before saving a TypeSafe key and land in the keys drawer on TypeSafe (Jev entitlement faked in the browser)',
    steps: ['FAKE: stub the browser /api/capabilities/ read so jev_models is allowed; the stack itself denies it (EVAL-E2E-006)',
      'open the evaluator create page on the LLM-As-A-Judge tab and open the model picker',
      'choose Jev latest', 'type into the TypeSafe API key field without adding it'],
    backendChecks: [
      'the provider-status API reports no TypeSafe key before and after, and the drawer sent no API-key write',
    ],
    browserChecks: [
      'both Jev rows are enabled and prompt for a TypeSafe API key',
      'choosing Jev latest closes the picker and opens the keys drawer with TypeSafe as its first provider',
      'the drawer takes input (Add enables) and the evaluator model stays unselected',
    ],
  }),
}, async ({ page, actor }, testInfo) => {
  test.setTimeout(300_000); // Four UI_READY browser stages (draft, picker, drawer, typing) 240 + API reads and headroom 60.
  page.setDefaultTimeout(UI_READY);
  const keyWrites: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith(API_KEYS) && request.method() !== 'GET') {
      keyWrites.push(`${request.method()} ${request.url()}`);
    }
  });
  await stubJevEntitlement(page);
  expect(typesafe(await actor.api.get<ProviderStatus>(PROVIDER_STATUS)).has_key).toBe(false);

  let picker: Locator | undefined;
  await test.step('UI: both Jev rows are selectable and ask for a TypeSafe key', async () => {
    const draftId = await openJudgeEditor(page);
    await testInfo.attach('draft-template', { contentType: 'application/json',
      body: JSON.stringify({ draftId, organizationId: actor.organizationId }) });
    picker = await openModelPicker(page);
    const rows = jevRows(picker);
    await ui(rows).toHaveCount(JEV_LABELS.length);
    for (const [index, label] of JEV_LABELS.entries()) {
      const row = rows.nth(index);
      await ui(row.getByText(label, { exact: true })).toBeVisible();
      await ui(row.getByText(NO_KEY, { exact: true })).toBeVisible();
      await ui(row).toBeEnabled();
    }
  });

  const drawer = page.locator('.MuiDrawer-paper').filter({ has: page.getByPlaceholder('Search API provider') });
  await test.step('UI: choosing Jev latest closes the picker and opens the drawer on TypeSafe', async () => {
    await jevRows(picker!).filter({ hasText: /^Jev latest/ }).click();
    await ui(page.getByPlaceholder('Search models...')).toBeHidden();
    await ui(drawer).toBeVisible();
    // KeysDrawer sorts the chosen provider first (KeysHelper createSortBySelectedProvider).
    await ui(drawer.locator('form').first().getByText('TypeSafe', { exact: true })).toBeVisible();
    await testInfo.attach('keys-drawer', { body: await page.screenshot(), contentType: 'image/png' });
  });

  await test.step('UI: the drawer takes input and nothing was selected', async () => {
    const card = drawer.locator('form').filter({ has: page.getByText('TypeSafe', { exact: true }) });
    const add = card.getByRole('button', { name: 'save' });
    await ui(add).toBeDisabled();
    const key = card.getByLabel('API Key');
    await key.fill('e2e-not-a-typesafe-key');
    await ui(key).toHaveValue('e2e-not-a-typesafe-key');
    await ui(add).toBeEnabled();
    // The pill would read "Jev latest" had the row selected the model.
    await ui(page.getByText('Jev latest', { exact: true })).toHaveCount(0);
  });

  await test.step('backend check 1: still no TypeSafe key, and no key write', async () => {
    expect(typesafe(await actor.api.get<ProviderStatus>(PROVIDER_STATUS)).has_key).toBe(false);
    expect(keyWrites).toEqual([]);
  });
});

test('EVAL-E2E-008: a Jev pass/fail evaluator keeps its model, output type and criteria after reload', {
  tag: ['@flow'],
  annotation: flowAnnotation({
    id: 'EVAL-E2E-008', area: 'evals',
    userGoal: 'Author a Jev pass/fail evaluator in the UI and find its model, output type and criteria intact after reload (Jev entitlement and model id faked)',
    steps: ['FAKES, not a real Jev save: in the browser, stub jev_models allowed and a TypeSafe key on file, and swap jev-latest for gpt-4o on this template\'s API calls; a real Jev save answers 402 here (EVAL-E2E-006)',
      'author an LLM-As-A-Judge evaluator and choose Jev latest', 'keep Pass/fail and describe a pass and a fail',
      'save the evaluation', 'reload its detail page'],
    backendChecks: [
      'PG keeps the validated noul mapping with both criteria, Pass/Fail output, org/workspace scope and an identical V1 snapshot; model holds the faked stand-in gpt-4o',
    ],
    browserChecks: [
      'the publish request carries jev-latest, pass_fail and both criteria',
      'after reload the pill reads Jev latest, Pass/fail is selected and both criteria are filled',
    ],
  }),
}, async ({ page, actor, probe }, testInfo) => {
  test.setTimeout(420_000); // Six UI_READY browser stages (draft, picker, configure, publish, reload, reread) 360 + PG and headroom 60.
  page.setDefaultTimeout(UI_READY);
  const suffix = `${testInfo.workerIndex}-${Date.now().toString(36)}`;
  const name = `e2e-jev-pass-${suffix}`;
  const criteria = { criteria_true: `Answers the request ${suffix}`, criteria_false: `Misses the request ${suffix}` };
  const exchanges: Exchange[] = [];
  await fakeJevSaveOnUnlicensedStack(page, exchanges);

  let authored: { id: string; sent: Published } | undefined;
  await test.step('UI: author and publish the pass/fail evaluator', async () => {
    authored = await authorJevEvaluator(page, name, async () => {
      await ui(page.getByRole('radio', { name: 'Pass/fail', exact: true })).toBeChecked();
      await page.getByLabel('Describe a pass (true)').fill(criteria.criteria_true);
      await page.getByLabel('Describe a fail (false)').fill(criteria.criteria_false);
    });
  });
  const { id, sent } = authored!;
  await testInfo.attach('template', { contentType: 'application/json', body: JSON.stringify({ id, name, sent }) });
  expect(sent).toMatchObject({ model: JEV_MODEL, output_type: 'pass_fail',
    jev_mapping: { question_type: 'noul', pass: criteria, choice: null, score: null } });

  await test.step('backend check 1: the validated mapping and its V1 snapshot', async () => {
    const { row, versions } = await stored(probe, id);
    await testInfo.attach('stored', { contentType: 'application/json', body: JSON.stringify({ row, versions }) });
    expectPublishedJev(row, versions, actor);
    expect(row.output_type_normalized).toBe('pass_fail');
    expect(row.config.output).toBe('Pass/Fail');
    expect(row.config.jev_mapping).toMatchObject({ question_type: 'noul', pass: criteria, choice: null, score: null });
  });

  await test.step('UI: reload shows Jev latest, Pass/fail and both criteria', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ui(page.getByText('Jev latest', { exact: true })).toBeVisible();
    await ui(page.getByRole('radio', { name: 'Pass/fail', exact: true })).toBeChecked();
    await ui(page.getByLabel('Describe a pass (true)')).toHaveValue(criteria.criteria_true);
    await ui(page.getByLabel('Describe a fail (false)')).toHaveValue(criteria.criteria_false);
  });
  await testInfo.attach('exchanges', { contentType: 'application/json', body: JSON.stringify(exchanges) });
});

test('EVAL-E2E-009: a Jev choices evaluator keeps its authored label order and scores after reload', {
  tag: ['@flow'],
  annotation: flowAnnotation({
    id: 'EVAL-E2E-009', area: 'evals',
    userGoal: 'Author a Jev choices evaluator whose labels are not shortest-first and find their order and scores intact after reload (Jev entitlement and model id faked)',
    steps: ['FAKES, not a real Jev save: in the browser, stub jev_models allowed and a TypeSafe key on file, and swap jev-latest for gpt-4o on this template\'s API calls; a real Jev save answers 402 here (EVAL-E2E-006)',
      'author an LLM-As-A-Judge evaluator and choose Jev latest',
      'choose Choices and enter Resolved (Pass), Escalated (Neutral), No (Fail), describing Escalated',
      'save the evaluation', 'reload its detail page'],
    backendChecks: [
      'PG choice_scores holds the three scores with jsonb keys shortest-first, while choices and the validated mapping keep Resolved, Escalated, No with the Escalated description; V1 snapshot identical',
    ],
    browserChecks: [
      'the publish request carries jev-latest, deterministic and the labels in authored order',
      'after reload the rows read Resolved, Escalated, No as Pass, Neutral, Fail and the description is kept',
    ],
  }),
}, async ({ page, actor, probe }, testInfo) => {
  test.setTimeout(420_000); // Six UI_READY browser stages (draft, picker, configure, publish, reload, reread) 360 + PG and headroom 60.
  page.setDefaultTimeout(UI_READY);
  const suffix = `${testInfo.workerIndex}-${Date.now().toString(36)}`;
  const name = `e2e-jev-choice-${suffix}`;
  // Authored order is not jsonb's shortest-first key order ("No" < "Resolved" < "Escalated").
  const labels = ['Resolved', 'Escalated', 'No'];
  const shown = ['Pass', 'Neutral', 'Fail']; // OutputTypeConfig maps them to 1, 0.5, 0.
  const scores = { Resolved: 1, Escalated: 0.5, No: 0 };
  const note = `Handed to a person ${suffix}`;
  const exchanges: Exchange[] = [];
  await fakeJevSaveOnUnlicensedStack(page, exchanges);
  const names = page.getByPlaceholder('Choice name', { exact: true });

  let authored: { id: string; sent: Published } | undefined;
  await test.step('UI: author and publish the choices evaluator', async () => {
    authored = await authorJevEvaluator(page, name, async () => {
      await page.getByRole('radio', { name: 'Choices', exact: true }).check();
      for (const [index, label] of labels.entries()) {
        if (index > 0) await page.getByRole('button', { name: 'Add Choice', exact: true }).click();
        await ui(names).toHaveCount(index + 1);
        await names.nth(index).fill(label);
        await names.nth(index).press('Tab'); // OutputTypeConfig commits a rename on blur.
        await choiceRow(names.nth(index)).getByRole('combobox').click();
        await page.getByRole('option', { name: shown[index], exact: true }).click();
      }
      await page.getByLabel(`Description for ${labels[1]}`, { exact: true }).fill(note);
    });
  });
  const { id, sent } = authored!;
  await testInfo.attach('template', { contentType: 'application/json', body: JSON.stringify({ id, name, sent }) });
  const descriptions = { Resolved: '', Escalated: note, No: '' };
  expect(sent).toMatchObject({ model: JEV_MODEL, output_type: 'deterministic', choice_scores: scores });
  expect(Object.keys(sent.choice_scores!)).toEqual(labels);
  expect(sent.jev_mapping).toMatchObject({ question_type: 'choice', choice: { labels, descriptions } });

  await test.step('backend check 1: jsonb reorders the scores; the mapping keeps the authored order', async () => {
    const { row, versions } = await stored(probe, id);
    await testInfo.attach('stored', { contentType: 'application/json', body: JSON.stringify({ row, versions }) });
    expectPublishedJev(row, versions, actor);
    expect(row.output_type_normalized).toBe('deterministic');
    expect(row.choice_scores).toEqual(scores);
    expect(Object.keys(row.choice_scores!)).toEqual(['No', 'Resolved', 'Escalated']);
    expect(row.choices).toEqual(labels);
    expect(row.config.jev_mapping).toMatchObject({ question_type: 'choice', pass: null, score: null });
    expect(row.config.jev_mapping!.choice).toEqual({ labels, descriptions });
  });

  await test.step('UI: reload shows the labels in authored order with their scores', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ui(page.getByText('Jev latest', { exact: true })).toBeVisible();
    await ui(page.getByRole('radio', { name: 'Choices', exact: true })).toBeChecked();
    await ui(names).toHaveCount(labels.length);
    await expect.poll(() => names.evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value)),
      { timeout: UI_READY }).toEqual(labels);
    for (const [index, value] of shown.entries()) {
      await ui(choiceRow(names.nth(index)).getByRole('combobox')).toHaveText(value);
    }
    await ui(page.getByLabel(`Description for ${labels[1]}`, { exact: true })).toHaveValue(note);
    await testInfo.attach('reloaded-choices', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });
  await testInfo.attach('exchanges', { contentType: 'application/json', body: JSON.stringify(exchanges) });
});

test('EVAL-E2E-010: a Jev scoring evaluator keeps its four ordered levels after reload', {
  tag: ['@flow'],
  annotation: flowAnnotation({
    id: 'EVAL-E2E-010', area: 'evals',
    userGoal: 'Author a Jev scoring evaluator with four ordered rubric levels and find them intact after reload (Jev entitlement and model id faked)',
    steps: ['FAKES, not a real Jev save: in the browser, stub jev_models allowed and a TypeSafe key on file, and swap jev-latest for gpt-4o on this template\'s API calls; a real Jev save answers 402 here (EVAL-E2E-006)',
      'author an LLM-As-A-Judge evaluator and choose Jev latest', 'choose Scoring and add four ordered levels',
      'save the evaluation', 'reload its detail page'],
    backendChecks: [
      'PG keeps the validated score mapping with the four levels in order, no choice scores and an identical V1 snapshot',
    ],
    browserChecks: [
      'the publish request carries jev-latest, percentage and the four levels',
      'after reload Scoring is selected and the four levels read back in order',
    ],
  }),
}, async ({ page, actor, probe }, testInfo) => {
  test.setTimeout(420_000); // Six UI_READY browser stages (draft, picker, configure, publish, reload, reread) 360 + PG and headroom 60.
  page.setDefaultTimeout(UI_READY);
  const suffix = `${testInfo.workerIndex}-${Date.now().toString(36)}`;
  const name = `e2e-jev-score-${suffix}`;
  const levels = ['Off topic', 'Partly answered', 'Answered', 'Answered with sources'].map(l => `${l} ${suffix}`);
  const exchanges: Exchange[] = [];
  await fakeJevSaveOnUnlicensedStack(page, exchanges);
  // JevOutputConfig labels each level "Level <n>"; its move buttons say "Move level <n> ...".
  const levelInputs = page.getByLabel(/^Level \d+$/);

  let authored: { id: string; sent: Published } | undefined;
  await test.step('UI: author and publish the scoring evaluator', async () => {
    authored = await authorJevEvaluator(page, name, async () => {
      await page.getByRole('radio', { name: 'Scoring', exact: true }).check();
      for (const [index, level] of levels.entries()) {
        await page.getByRole('button', { name: 'Add level', exact: true }).click();
        await ui(levelInputs).toHaveCount(index + 1);
        await page.getByLabel(`Level ${index}`, { exact: true }).fill(level);
      }
    });
  });
  const { id, sent } = authored!;
  await testInfo.attach('template', { contentType: 'application/json', body: JSON.stringify({ id, name, sent }) });
  expect(sent).toMatchObject({ model: JEV_MODEL, output_type: 'percentage',
    jev_mapping: { question_type: 'score', score: { levels }, pass: null, choice: null } });

  await test.step('backend check 1: the four levels in order and no choice scores', async () => {
    const { row, versions } = await stored(probe, id);
    await testInfo.attach('stored', { contentType: 'application/json', body: JSON.stringify({ row, versions }) });
    expectPublishedJev(row, versions, actor);
    expect(row.output_type_normalized).toBe('percentage');
    expect(row.choice_scores ?? {}).toEqual({});
    expect(row.config.jev_mapping).toMatchObject({ question_type: 'score', score: { levels }, pass: null, choice: null });
  });

  await test.step('UI: reload shows Scoring and the four levels in order', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ui(page.getByText('Jev latest', { exact: true })).toBeVisible();
    await ui(page.getByRole('radio', { name: 'Scoring', exact: true })).toBeChecked();
    await ui(levelInputs).toHaveCount(levels.length);
    await expect.poll(() => levelInputs.evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value)),
      { timeout: UI_READY }).toEqual(levels);
  });
  await testInfo.attach('exchanges', { contentType: 'application/json', body: JSON.stringify(exchanges) });
});

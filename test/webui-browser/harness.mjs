// Shared page helpers for the WebUI built-client browser suite.
//
// The fixtures are deterministic and in-page: every WebUI wire envelope the
// client sends lands on `window.__fixture` instead of a real server, so these
// helpers only ever talk to that fixture. Keeping them in one module means a
// new spec gets the same session-switch and harness assertions without
// restating them.

import { expect, test } from "@playwright/test";

export async function configureFixture(page, setup) {
  await page.addInitScript({ content: `window.__WEBUI_FIXTURE_SETUP__ ??= []; window.__WEBUI_FIXTURE_SETUP__.push((${setup.toString()}));` });
}

/** The harness server and the page must both report this run's server id. */
export async function assertHarnessServer(page) {
  const expectedServerId = test.info().config.metadata.webuiBrowserServerId;
  const health = await page.request.get("http://127.0.0.1:4179/health");
  expect(await health.json()).toEqual({ status: "ok", serverId: expectedServerId });
  await expect.poll(() => page.evaluate(() => window.__WEBUI_TEST_SERVER_ID__)).toBe(expectedServerId);
}

export async function openApp(page, hash = "#session=A") {
  await page.goto(`/${hash}`);
  await expect(page.locator("#webui-root")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__fixture.requests.some((request) => request.operation === "listSessions"))).toBe(true);
}

export async function switchSession(page, sessionId) {
  await page.evaluate((id) => { window.location.hash = `session=${id}`; }, sessionId);
}

export async function startTurn(page, sessionId, text) {
  const composer = page.getByPlaceholder("输入消息…（输入 / 唤起命令）");
  await composer.fill(text);
  await page.getByRole("button", { name: "发送" }).click();
  await expect.poll(() => page.evaluate((id) => window.__fixture.requests.some((request) => request.operation === "sendMessage" && request.body.id === id), sessionId)).toBe(true);
}

/** Deliver one `WebuiStreamFrame` (cursor + dataJson) to a session's stream. */
export async function emitStream(page, sessionId, streamFrame) {
  await page.evaluate(
    ([id, frame]) => window.__fixture.emitStream(id, frame),
    [sessionId, streamFrame],
  );
}

/** Deliver one `agent_message` frame for a session's stream. */
export async function emitAgentMessage(page, sessionId, agentMessage, cursor) {
  await emitStream(page, sessionId, {
    ...(cursor === undefined ? {} : { cursor }),
    dataJson: JSON.stringify({ type: "agent_message", agent_message: agentMessage }),
  });
}

export async function dropStream(page, sessionId) {
  await page.evaluate((id) => window.__fixture.dropStream(id), sessionId);
}

export function livePulse(page) {
  return page.locator('[data-webui-thinking-live-status="true"]');
}

export function liveIndicator(page) {
  return page.getByText("思考中…");
}

export function assistantBody(page, messageId) {
  return page.locator(`[data-webui-assistant-body="${messageId}"]`);
}

/** Count of `operation` requests the fixture has recorded, optionally filtered. */
export function requestCount(page, operation) {
  return page.evaluate(
    (op) => window.__fixture.requests.filter((request) => request.operation === op).length,
    operation,
  );
}

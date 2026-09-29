// Agent turn lifecycle, page reload, session switching, and streaming resume.
//
// The existing transcript spec covers message paging and live-view ownership.
// This file covers the *transport* half of a turn: what the client does from
// `sendMessage` through the first frames, through a mid-turn socket drop or a
// `resume_overflow`, to `[DONE]` — and what survives a reload or a session
// round trip in between. Every assertion runs against the built client driven
// by the in-page fixture, so the wire shapes here are the real ones.

import { expect, test } from "@playwright/test";

import {
  assistantBody,
  assertHarnessServer,
  configureFixture,
  dropStream,
  emitAgentMessage,
  emitStream,
  liveIndicator,
  livePulse,
  openApp,
  requestCount,
  startTurn,
  switchSession,
} from "./harness.mjs";

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.error("BROWSER_PAGE_ERROR", error.stack ?? error.message));
  page.on("console", (message) => { if (message.type() === "error") console.error("BROWSER_CONSOLE_ERROR", message.text()); });
});

test("an agent turn streams thinking and answer, then settles on DONE", async ({ page }) => {
  await openApp(page, "#session=A");
  await assertHarnessServer(page);
  await startTurn(page, "A", "Run the synthetic turn");
  await expect(liveIndicator(page)).toBeVisible();

  await emitAgentMessage(page, "A", {
    msg_id: "a-turn-1",
    thinking_content: "Synthetic reasoning",
    msg_content: "Synthetic answer one",
  });
  const body = assistantBody(page, "a-turn-1");
  await expect(body).toBeVisible();
  await expect(body.getByText("Synthetic answer one")).toBeVisible();

  // A tool call landing on the same message must not displace the answer.
  await emitAgentMessage(page, "A", {
    msg_id: "a-turn-1",
    tool_calls: [{ id: "call-1", function: { name: "bash", arguments: JSON.stringify({ command: "ls -la" }) } }],
  });
  await expect(body.getByText("Synthetic answer one")).toBeVisible();

  // The per-turn pulse is the element the stranded-animation bug lived on:
  // while the turn streams it is present exactly once, and `[DONE]` must
  // clear it.
  await expect(livePulse(page)).toHaveCount(1);
  await emitStream(page, "A", { dataJson: "[DONE]" });
  await expect(liveIndicator(page)).toHaveCount(0);
  await expect(livePulse(page)).toHaveCount(0);
  await expect(body.getByText("Synthetic answer one")).toHaveCount(1);
  // The answer landed once, not once per frame the turn delivered.
  await expect(page.locator('[data-webui-transcript="A"]')).toBeVisible();
  await expect(page.locator('[data-webui-message-kind="assistant"]')).toHaveCount(1);
});

test("a mid-turn socket drop resumes from the last cursor and keeps the turn", async ({ page }) => {
  await openApp(page, "#session=A");
  await startTurn(page, "A", "Synthetic resume turn");
  await emitAgentMessage(page, "A", { msg_id: "a-turn-1", msg_content: "Before the drop" }, "cursor-1");
  await expect(page.getByText("Before the drop")).toBeVisible();

  await dropStream(page, "A");
  await expect.poll(() => page.evaluate(() => window.__fixture.requests.some(
    (request) => request.operation === "resumeSession" && request.body.afterCursor === "cursor-1",
  ))).toBe(true);

  // The replacement subscription keeps delivering into the same turn.
  await emitAgentMessage(page, "A", { msg_id: "a-turn-2", msg_content: "After the drop" }, "cursor-2");
  await expect(page.getByText("After the drop")).toBeVisible();
  await emitStream(page, "A", { dataJson: "[DONE]" });
  await expect(liveIndicator(page)).toHaveCount(0);
  await expect(page.getByText("Before the drop")).toBeVisible();
  await expect(page.getByText("After the drop")).toBeVisible();
});

test("resume_overflow reloads authoritative history and resubscribes without a cursor", async ({ page }) => {
  await configureFixture(page, () => {
    window.__fixture.setPage("A", {
      messages: [{ msgId: "history-a-authoritative", role: "user", msgContent: "Authoritative history A", timestamp: 1_700_000_000_050 }],
      hasMore: false,
    });
  });
  await openApp(page, "#session=A");
  const beforeOverflow = await requestCount(page, "getMessages");
  await startTurn(page, "A", "Synthetic overflow turn");
  await emitAgentMessage(page, "A", { msg_id: "a-turn-1", msg_content: "Live only message" }, "cursor-1");
  await expect(page.getByText("Live only message")).toBeVisible();

  await emitStream(page, "A", { dataJson: JSON.stringify({ type: "resume_overflow" }) });
  // The loop only inspects `nextAction` once the current subscription
  // settles, so the server ending the stream is what hands control to the
  // resync branch. Without this `[DONE]` the test would pass vacuously.
  await emitStream(page, "A", { dataJson: "[DONE]" });

  // The resync path reloads history, so the live-only message is replaced by
  // the server's authoritative view rather than kept alongside it.
  await expect.poll(() => requestCount(page, "getMessages")).toBeGreaterThan(beforeOverflow);
  await expect(page.getByText("Authoritative history A")).toBeVisible();
  await expect(page.getByText("Live only message")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__fixture.requests.some(
    (request) => request.operation === "resumeSession" && request.body.afterCursor === undefined,
  ))).toBe(true);

  await emitStream(page, "A", { dataJson: "[DONE]" });
  await expect(liveIndicator(page)).toHaveCount(0);
});

test("a page reload restores history and never revives a finished turn", async ({ page }) => {
  await configureFixture(page, () => {
    window.__fixture.setPage("A", {
      messages: [
        { msgId: "history-user", role: "user", msgContent: "Persisted question", timestamp: 1_700_000_000_060 },
        { msgId: "history-assistant", role: "assistant", msgContent: "Persisted answer", timestamp: 1_700_000_000_061 },
      ],
      hasMore: false,
    });
  });
  await openApp(page, "#session=A");
  await expect(page.getByText("Persisted answer")).toBeVisible();
  await expect(liveIndicator(page)).toHaveCount(0);

  await page.reload();
  await assertHarnessServer(page);
  await expect(page.locator("#webui-root")).toBeVisible();
  await expect(page.getByText("Persisted question")).toHaveCount(1);
  await expect(page.getByText("Persisted answer")).toHaveCount(1);
  // A reloaded client has no live turn: neither the bottom indicator nor the
  // per-turn pulse may reappear from reloaded history alone.
  await expect(liveIndicator(page)).toHaveCount(0);
  await expect(livePulse(page)).toHaveCount(0);
});

test("switching away and back keeps a live turn attached to its own session", async ({ page }) => {
  await openApp(page, "#session=A");
  await startTurn(page, "A", "Synthetic switch turn");
  await emitAgentMessage(page, "A", { msg_id: "a-turn-1", msg_content: "A first message" });
  await expect(page.getByText("A first message")).toBeVisible();

  await switchSession(page, "B");
  await expect(page.getByText("History B synthetic")).toBeVisible();
  await emitAgentMessage(page, "A", { msg_id: "a-turn-2", msg_content: "A late message" });
  await expect(page.getByText("A late message")).toHaveCount(0);

  await switchSession(page, "A");
  await expect(page.getByText("A first message")).toBeVisible();
  await expect(page.getByText("A late message")).toBeVisible();
  await expect(page.getByText("History B synthetic")).toHaveCount(0);
  // The turn is still running, so coming back must restore the live state.
  await expect(liveIndicator(page)).toBeVisible();

  await emitStream(page, "A", { dataJson: "[DONE]" });
  await expect(liveIndicator(page)).toHaveCount(0);
  await expect(page.getByText("A late message")).toBeVisible();
});

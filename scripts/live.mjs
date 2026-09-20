import { chromium, expect } from "@playwright/test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const profile = await mkdtemp(path.join(tmpdir(), "quiet-youtube-live-"));
const extensionPath = path.resolve("dist/extension");
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
  viewport: { width: 1440, height: 1000 },
});
const report = { at: new Date().toISOString(), checks: [] };
try {
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/index.html`);
  const rpc = (type, payload = {}) =>
    page.evaluate(
      async ({ type, payload }) => {
        const result = await chrome.runtime.sendMessage({ type, ...payload });
        if (!result.ok) throw new Error(result.error);
        return result.data;
      },
      { type, payload },
    );
  const result = await rpc("addChannel", { input: "@jawed" });
  report.checks.push({ name: "Resolve live channel", channel: result.channel });
  const check = await rpc("checkVideo", { videoId: "jNQXAC9IVRw" });
  if (!check.allowed) throw new Error("Live approved channel check failed.");
  report.checks.push({ name: "Verify live video", ...check });
  await mkdir("qa", { recursive: true });
  const channelPage = await context.newPage();
  await channelPage.goto(
    `https://www.youtube.com/channel/${result.channel.id}/videos?ucbcb=1`,
    { waitUntil: "domcontentloaded", timeout: 45000 },
  );
  await expect(channelPage.locator("html")).toHaveAttribute(
    "data-qy-state",
    "allowed",
    { timeout: 20000 },
  );
  await expect(
    channelPage.locator('[data-qy-card="allowed"]').first(),
  ).toBeVisible({ timeout: 30000 });
  report.checks.push({
    name: "Native YouTube channel videos filtered",
    visibleCards: await channelPage.locator('[data-qy-card="allowed"]').count(),
  });
  await channelPage.screenshot({
    path: "qa/live-native-channel.png",
    fullPage: true,
  });
  const video = await context.newPage();
  await video.goto("https://www.youtube.com/watch?v=jNQXAC9IVRw", {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  if (new URL(video.url()).hostname === "consent.youtube.com") {
    await video.getByText("Reject all", { exact: true }).click();
    report.checks.push({
      name: "YouTube consent in temporary test profile",
      choice: "Reject all",
    });
  }
  await expect(video.locator("html")).toHaveAttribute(
    "data-qy-state",
    "allowed",
    { timeout: 20000 },
  );
  const reject = video.getByText("Reject all", { exact: true });
  try {
    await reject.waitFor({ state: "visible", timeout: 5000 });
    await reject.click();
    report.checks.push({
      name: "YouTube consent dialog in temporary test profile",
      choice: "Reject all",
    });
  } catch (error) {
    if (error.name !== "TimeoutError") throw error;
  }
  await expect(video.locator("html")).toHaveAttribute(
    "data-qy-state",
    "allowed",
    { timeout: 20000 },
  );
  // Use YouTube's own control so its internal player state follows the action.
  // Consent dismissal can trigger one more navigation/player initialization.
  await video.waitForTimeout(1200);
  if (
    await video
      .locator("video")
      .first()
      .evaluate((media) => media.paused)
  ) {
    await video.locator(".ytp-play-button").click();
  }
  await expect
    .poll(
      () =>
        video
          .locator("video")
          .first()
          .evaluate((media) => media.currentTime),
      { timeout: 20000 },
    )
    .toBeGreaterThan(0.25);
  report.checks.push({
    name: "Live media plays after approval",
    currentTime: await video
      .locator("video")
      .first()
      .evaluate((media) => media.currentTime),
  });
  report.checks.push({
    name: "Live YouTube content script",
    state: await video.locator("html").getAttribute("data-qy-state"),
    videos: await video.locator("video").count(),
  });
  await video.screenshot({ path: "qa/live-approved.png" });
  await rpc("removeChannel", { id: result.channel.id });
  await expect(video.locator("html")).toHaveAttribute(
    "data-qy-state",
    "blocked",
  );
  await expect
    .poll(() =>
      video
        .locator("video")
        .first()
        .evaluate((media) => media.paused),
    )
    .toBe(true);
  report.checks.push({
    name: "Live channel removal blocks open video",
    state: "blocked",
  });
  await video.screenshot({ path: "qa/live-blocked.png" });
} catch (error) {
  report.error = error.message;
  const failedPage = context
    .pages()
    .find((page) => page.url().includes("youtube.com/watch"));
  if (failedPage) {
    await mkdir("qa", { recursive: true });
    await failedPage.screenshot({ path: "qa/live-failure.png" });
    report.player = await failedPage.evaluate(() => ({
      state: document.documentElement.getAttribute("data-qy-state"),
      error: document.querySelector(".ytp-error-content-wrap")?.textContent,
      media: [...document.querySelectorAll("video")].map((media) => ({
        paused: media.paused,
        time: media.currentTime,
        ready: media.readyState,
        error: media.error?.message,
      })),
    }));
  }
  process.exitCode = 1;
} finally {
  await mkdir("qa", { recursive: true });
  await writeFile("qa/live-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await context.close();
  await rm(profile, { recursive: true, force: true });
}

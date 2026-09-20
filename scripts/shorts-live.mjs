import { chromium, expect } from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const profile = await mkdtemp(path.join(tmpdir(), "quiet-shorts-live-"));
const extensionPath = path.resolve("dist/extension");
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});
const report = { at: new Date().toISOString() };
try {
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${id}/index.html`);
  const rpc = (type, payload = {}) =>
    settings.evaluate(
      async ({ type, payload }) => {
        const response = await chrome.runtime.sendMessage({ type, ...payload });
        if (!response.ok) throw new Error(response.error);
        return response.data;
      },
      { type, payload },
    );
  await rpc("addChannel", { input: "@kurzgesagt" });
  await rpc("addChannel", { input: "@jawed" });
  // Known public Short used only as test data. The test fails if YouTube changes
  // or removes its metadata, rather than guessing based on duration.
  const sample = await rpc("checkVideo", { videoId: "NIifnIP_NnQ" });
  if (!sample.isShort || sample.allowed || sample.blockedReason !== "shorts")
    throw new Error("Short watch link was allowed.");
  const normal = await rpc("checkVideo", { videoId: "jNQXAC9IVRw" });
  if (!normal.allowed || normal.isShort !== false)
    throw new Error("A short-duration regular video was incorrectly blocked.");
  const watch = await context.newPage();
  await watch.goto(`https://www.youtube.com/watch?v=${sample.id}&ucbcb=1`, {
    waitUntil: "domcontentloaded",
  });
  await expect(watch.locator("html")).toHaveAttribute(
    "data-qy-state",
    "blocked",
    { timeout: 20000 },
  );
  await mkdir("qa", { recursive: true });
  await watch.screenshot({ path: "qa/shorts-blocked.png" });
  Object.assign(report, {
    excludedShort: sample.id,
    directShortBlocked: true,
    shortDurationRegularVideoAllowed: true,
  });
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await mkdir("qa", { recursive: true });
  await writeFile("qa/shorts-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await context.close();
  await rm(profile, { recursive: true, force: true });
}

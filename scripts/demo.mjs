import { chromium } from "@playwright/test";
import path from "node:path";
const extensionPath = path.resolve("dist/extension");
const context = await chromium.launchPersistentContext(
  path.resolve(".demo-profile"),
  {
    channel: "chromium",
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-default-browser-check",
      "--ozone-platform=wayland",
    ],
    viewport: null,
  },
);
const worker =
  context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
const id = new URL(worker.url()).host;
const page = context.pages()[0] || (await context.newPage());
await page.goto(`chrome-extension://${id}/index.html#settings`);
console.log(
  "Quiet YouTube is open in a separate Chromium profile. Your regular browser is unchanged. Close the demo browser when finished.",
);
await new Promise((resolve) => context.on("close", resolve));

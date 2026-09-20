import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const extensionPath = path.resolve("dist/extension");
const approved = "UC4QobU6STFB0P71PMvOGN5A";
const other = "UCsXVk37bltHxD1rDPwtNM8Q";
const good = "jNQXAC9IVRw",
  bad = "aaaaaaaaaaa",
  unknown = "bbbbbbbbbbb",
  slow = "ccccccccccc",
  short = "sssssssssss",
  unclassified = "uuuuuuuuuuu";
let context, profile, extensionId, settingsPage;
// Four seconds of silent PCM lets us verify real media state without external
// assets or sound. Browser autoplay is explicitly enabled for this stress test.
const wav = Buffer.alloc(44 + 64000);
wav.write("RIFF");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24);
wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(64000, 40);
const mediaUrl = `data:audio/wav;base64,${wav.toString("base64")}`;
function html(video = good, channel = approved) {
  const player =
    video === unknown
      ? ""
      : `var ytInitialPlayerResponse = ${JSON.stringify({ videoDetails: { videoId: video, channelId: channel, author: channel === approved ? "Jawed" : "Another channel", title: "Fixture video" }, microformat: { playerMicroformatRenderer: video === unclassified ? {} : { externalVideoId: video, isShortsEligible: video === short } } })};`;
  return `<!doctype html><html><head><title>YouTube fixture</title></head><body><script>${player}var ytInitialData = ${JSON.stringify({ metadata: { channelMetadataRenderer: { externalId: approved, title: "Jawed", vanityChannelUrl: "https://www.youtube.com/@jawed" } } })};</script><ytd-app><h1>Fixture video</h1><video controls autoplay></video><div id="comments">Comments fixture</div><div id="related">Suggested videos</div><ytd-searchbox>Search fixture</ytd-searchbox><ytd-reel-shelf-renderer>Shorts shelf</ytd-reel-shelf-renderer><button class="ytp-autonav-toggle-button" aria-checked="true" onclick="this.setAttribute('aria-checked','false')">Autoplay</button></ytd-app></body></html>`;
}
function feedHtml() {
  const card = (id, video, title) =>
    `<ytd-rich-item-renderer id="${id}"><a href="/watch?v=${video}"><h2>${title}</h2></a></ytd-rich-item-renderer>`;
  return `<!doctype html><html><head><title>YouTube subscriptions</title><style>ytd-rich-item-renderer{display:block;padding:20px;border:1px solid #ddd;margin:12px}</style></head><body><header>YouTube</header><h1>Subscriptions</h1><nav><a href="/feed/channels">All my channels</a></nav>${card("approved-card", good, "Approved video")}${card("blocked-card", bad, "Unapproved video")}${card("short-card", short, "A Short from an approved channel")}${card("unknown-card", unclassified, "Unclassified video")}</body></html>`;
}
async function rpc(type, payload = {}) {
  return settingsPage.evaluate(
    async ({ type, payload }) => {
      const response = await chrome.runtime.sendMessage({ type, ...payload });
      if (!response.ok) throw new Error(response.error);
      return response.data;
    },
    { type, payload },
  );
}
async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
    viewport: { width: 1440, height: 1040 },
  });
  await context.route("https://**.youtube.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/feeds/"))
      return route.fulfill({
        contentType: "application/atom+xml",
        body: `<feed><entry><yt:videoId>${good}</yt:videoId><yt:channelId>${approved}</yt:channelId><title>Me at the zoo</title><published>2026-09-17T08:00:00Z</published></entry>${url.searchParams.has("playlist_id") ? "" : `<entry><yt:videoId>${short}</yt:videoId><yt:channelId>${approved}</yt:channelId><title>A Short from an approved channel</title><published>2026-09-17T09:00:00Z</published></entry>`}</feed>`,
      });
    if (["/", "/feed/subscriptions", "/results"].includes(url.pathname))
      return route.fulfill({ contentType: "text/html", body: feedHtml() });
    const id = url.searchParams.get("v") || url.pathname.split("/").at(-1);
    if (id === slow && route.request().serviceWorker())
      await new Promise((resolve) => setTimeout(resolve, 650));
    return route.fulfill({
      contentType: "text/html",
      body: html(id, [bad].includes(id) ? other : approved),
    });
  });
  await context.route("https://www.youtube-nocookie.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: html(
        new URL(route.request().url()).pathname.split("/").at(-1),
        other,
      ),
    }),
  );
  await context.route("https://i.ytimg.com/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#d5dfc8"/><circle cx="240" cy="180" r="64" fill="#839572"/></svg>',
    }),
  );
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  extensionId = new URL(worker.url()).host;
  settingsPage = await context.newPage();
  await settingsPage.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(
    settingsPage.getByRole("heading", {
      name: "Channels",
      exact: true,
    }),
  ).toBeVisible();
}
test.beforeEach(async () => {
  profile = await mkdtemp(path.join(tmpdir(), "quiet-youtube-"));
  await launch();
});
test.afterEach(async () => {
  await context.close();
  await rm(profile, { recursive: true, force: true });
});

test("setup opens native YouTube, filters videos, persists settings, and removes approval immediately", async () => {
  await settingsPage
    .getByLabel("YouTube channel link or @handle")
    .fill("@jawed");
  await settingsPage.getByRole("button", { name: "Add channel" }).click();
  await expect(settingsPage.getByText("Jawed is on your list.")).toBeVisible();
  await settingsPage.getByRole("checkbox", { name: /^Comments/ }).uncheck();
  await expect
    .poll(async () => (await rpc("getSettings")).hideComments)
    .toBe(false);
  await settingsPage.reload();
  await expect(
    settingsPage.getByRole("checkbox", { name: /^Comments/ }),
  ).not.toBeChecked();
  await mkdir("qa", { recursive: true });
  await settingsPage.screenshot({ path: "qa/settings.png", fullPage: true });
  const opened = context.waitForEvent("page");
  await settingsPage
    .getByRole("link", { name: "My videos", exact: true })
    .click();
  const feedPage = await opened;
  await expect(feedPage).toHaveURL(
    "https://www.youtube.com/feed/subscriptions",
  );
  await expect(feedPage.locator("#approved-card")).toBeVisible();
  await expect(feedPage.locator("#blocked-card")).toBeHidden();
  await feedPage.screenshot({ path: "qa/native-feed.png", fullPage: true });
  const videoPage = await context.newPage();
  await videoPage.goto(`https://www.youtube.com/watch?v=${good}`);
  await expect(videoPage.locator("html")).toHaveAttribute(
    "data-qy-state",
    "allowed",
  );
  await rpc("removeChannel", { id: approved });
  await expect(videoPage.locator("html")).toHaveAttribute(
    "data-qy-state",
    "blocked",
  );
});
test("unapproved direct links are covered, playback denied, and metadata failure stays blocked", async () => {
  await rpc("addChannel", { input: "@jawed" });
  const page = await context.newPage();
  await page.goto(`https://www.youtube.com/watch?v=${bad}`);
  await expect(page.locator("html")).toHaveAttribute(
    "data-qy-state",
    "blocked",
  );
  const playback = await page.evaluate(async () => {
    try {
      await document.querySelector("video").play();
      return "played";
    } catch (error) {
      return error.name;
    }
  });
  expect(playback).toBe("NotAllowedError");
  await mkdir("qa", { recursive: true });
  await page.screenshot({ path: "qa/blocked.png" });
  await page.goto(`https://www.youtube.com/watch?v=${unknown}`);
  await expect(page.locator("html")).toHaveAttribute("data-qy-state", "error");
});
test("SPA navigation invalidates old approval and ignores late verification", async () => {
  await rpc("addChannel", { input: "@jawed" });
  const page = await context.newPage();
  await page.goto(`https://www.youtube.com/watch?v=${good}`);
  await expect(page.locator("html")).toHaveAttribute(
    "data-qy-state",
    "allowed",
  );
  await page.evaluate(
    (id) => history.pushState({}, "", `/watch?v=${id}`),
    slow,
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-qy-state",
    "checking",
  );
  await expect(page.locator("#quiet-youtube-overlay")).toBeHidden();
  await page.evaluate((id) => history.pushState({}, "", `/watch?v=${id}`), bad);
  await expect(page.locator("html")).toHaveAttribute(
    "data-qy-state",
    "blocked",
  );
  await page.waitForTimeout(900);
  await expect(page.locator("html")).toHaveAttribute(
    "data-qy-state",
    "blocked",
  );
  await page.evaluate(() => history.back());
  await expect(page.locator("html")).toHaveAttribute(
    "data-qy-state",
    "allowed",
  );
});
test("homepage routes to native subscriptions; Shorts, searches and embeds respect controls", async () => {
  await rpc("addChannel", { input: "@jawed" });
  const page = await context.newPage();
  await page.goto("https://www.youtube.com/");
  await expect(page).toHaveURL("https://www.youtube.com/feed/subscriptions");
  await page.goto("https://www.youtube.com/results?search_query=test");
  await expect(page).toHaveURL("https://www.youtube.com/feed/subscriptions");
  for (const url of [
    `https://www.youtube.com/shorts/${good}`,
    `https://www.youtube-nocookie.com/embed/${bad}`,
  ]) {
    await page.goto(url);
    await expect(page.locator("html")).toHaveAttribute(
      "data-qy-state",
      "blocked",
    );
  }
  await page.goto(`https://www.youtube.com/embed/${good}`);
  await expect(page.locator("html")).toHaveAttribute(
    "data-qy-state",
    "allowed",
  );
  await context.route("https://embed.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html><body><h1>Unrelated website</h1><iframe src="https://www.youtube-nocookie.com/embed/${bad}"></iframe></body></html>`,
    }),
  );
  await page.goto("https://embed.test/");
  await expect(page.frameLocator("iframe").locator("html")).toHaveAttribute(
    "data-qy-state",
    "blocked",
  );
  expect(await page.locator("html").getAttribute("data-qy-state")).toBeNull();
});
test("restricted navigation stays on subscriptions without showing an intermediate screen", async () => {
  await rpc("addChannel", { input: "@jawed" });
  const page = await context.newPage();
  const overlays = [];
  page.on("console", (message) => {
    if (message.text() === "quiet-overlay-visible") overlays.push(page.url());
  });
  await page.addInitScript(() => {
    new MutationObserver(() => {
      const overlay = document.getElementById("quiet-youtube-overlay");
      if (overlay && !overlay.hidden) console.info("quiet-overlay-visible");
    }).observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden"],
    });
  });
  await page.goto("https://www.youtube.com/feed/subscriptions");
  await expect(page.locator("#approved-card")).toBeVisible();
  const navigations = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });
  await page.getByRole("link", { name: "All my channels" }).click();
  await expect(page.locator("#approved-card")).toBeVisible();
  expect(navigations).toEqual([]);
  await expect(page).toHaveURL("https://www.youtube.com/feed/subscriptions");

  // Direct links and YouTube's SPA navigation must also return quietly.
  for (const path of [
    "/feed/channels",
    `/channel/${other}`,
    "/results?search_query=test",
    "/",
  ]) {
    await page.goto(`https://www.youtube.com${path}`);
    await expect(page).toHaveURL("https://www.youtube.com/feed/subscriptions");
    await expect(page.locator("#approved-card")).toBeVisible();
  }
  await page.evaluate(() => {
    document.dispatchEvent(new Event("yt-navigate-start"));
    history.pushState({}, "", "/feed/channels");
    document.dispatchEvent(new Event("yt-navigate-finish"));
  });
  await expect(page).toHaveURL("https://www.youtube.com/feed/subscriptions");
  await expect(page.locator("#approved-card")).toBeVisible();
  expect(overlays).toEqual([]);
});
test("subscriptions mode redirects home and applies reversible UI filters", async () => {
  await rpc("patchSettings", { patch: { mode: "subscriptions" } });
  const page = await context.newPage();
  await page.goto("https://www.youtube.com/");
  await expect(page).toHaveURL("https://www.youtube.com/feed/subscriptions");
  await page.goto(`https://www.youtube.com/watch?v=${bad}`);
  await expect(page.locator("html")).toHaveAttribute(
    "data-qy-state",
    "allowed",
  );
  for (const selector of [
    "#comments",
    "#related",
    "ytd-searchbox",
    "ytd-reel-shelf-renderer",
  ])
    await expect(page.locator(selector)).toBeHidden();
  await expect(page.locator(".ytp-autonav-toggle-button")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await rpc("patchSettings", {
    patch: { hideComments: false, hideSearch: false, hideShorts: false },
  });
  await expect(page.locator("#comments")).toBeVisible();
  await page.goto(`https://www.youtube.com/shorts/${good}`);
  await expect(page.locator("html")).toHaveAttribute(
    "data-qy-state",
    "allowed",
  );
});
test("actual media plays when approved, pauses on navigation, and cannot restart when blocked", async () => {
  await rpc("addChannel", { input: "@jawed" });
  const page = await context.newPage();
  await page.goto(`https://www.youtube.com/watch?v=${good}`);
  await expect(page.locator("html")).toHaveAttribute(
    "data-qy-state",
    "allowed",
  );
  await page.evaluate(async (src) => {
    const media = document.querySelector("video");
    media.src = src;
    media.loop = true;
    await media.play();
  }, mediaUrl);
  await expect
    .poll(() => page.locator("video").evaluate((media) => media.currentTime))
    .toBeGreaterThan(0.1);
  await page.evaluate((id) => history.pushState({}, "", `/watch?v=${id}`), bad);
  await expect(page.locator("html")).toHaveAttribute(
    "data-qy-state",
    "blocked",
  );
  expect(await page.locator("video").evaluate((media) => media.paused)).toBe(
    true,
  );
  const result = await page.locator("video").evaluate(async (media) => {
    try {
      await media.play();
      return "played";
    } catch (error) {
      return error.name;
    }
  });
  expect(result).toBe("NotAllowedError");
  // A separately inserted native-autoplay element also gets stopped.
  await page.evaluate((src) => {
    const media = document.createElement("video");
    media.id = "native";
    media.src = src;
    media.autoplay = true;
    document.body.append(media);
  }, mediaUrl);
  await expect
    .poll(() => page.locator("#native").evaluate((media) => media.readyState))
    .toBeGreaterThan(1);
  expect(await page.locator("#native").evaluate((media) => media.paused)).toBe(
    true,
  );
});
test("saved channels survive full browser restart; responsive settings and popup render", async () => {
  await rpc("addChannel", { input: "@jawed" });
  await context.close();
  await launch();
  expect((await rpc("getSettings")).channels[0].id).toBe(approved);
  await settingsPage.setViewportSize({ width: 390, height: 844 });
  expect(
    await settingsPage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await mkdir("qa", { recursive: true });
  await settingsPage.screenshot({
    path: "qa/settings-mobile.png",
    fullPage: true,
  });
  await settingsPage.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(
    settingsPage.getByRole("button", { name: "Open my videos" }),
  ).toBeVisible();
});
test("native feed hides unapproved videos and Shorts, handles reused cards, and blocks watch links", async () => {
  await rpc("addChannel", { input: "@jawed" });
  const page = await context.newPage();
  await page.goto("https://www.youtube.com/feed/subscriptions");
  await expect(page.locator("#approved-card")).toBeVisible();
  await expect(page.locator("#blocked-card")).toBeHidden();
  await expect(page.locator("#short-card")).toBeHidden();
  await expect(page.locator("#unknown-card")).toBeHidden();
  await page
    .locator("#approved-card a")
    .evaluate((link, id) => (link.href = `/watch?v=${id}`), bad);
  await expect(page.locator("#approved-card")).toBeHidden();
  await page
    .locator("#approved-card a")
    .evaluate((link, id) => (link.href = `/watch?v=${id}`), good);
  await expect(page.locator("#approved-card")).toBeVisible();
  await rpc("patchSettings", { patch: { hideShorts: false } });
  await expect(page.locator("#short-card")).toBeVisible();
  await expect(page.locator("#blocked-card")).toBeHidden();
  await page.goto(`https://www.youtube.com/watch?v=${short}`);
  await expect(page.locator("html")).toHaveAttribute(
    "data-qy-state",
    "allowed",
  );
  await rpc("patchSettings", { patch: { hideShorts: true } });
  await expect(page.locator("html")).toHaveAttribute(
    "data-qy-state",
    "blocked",
  );
  await rpc("patchSettings", { patch: { mode: "subscriptions" } });
  await expect(page.locator("html")).toHaveAttribute(
    "data-qy-state",
    "blocked",
  );
  await page.goto(`https://www.youtube.com/embed/${short}`);
  await expect(page.locator("html")).toHaveAttribute(
    "data-qy-state",
    "blocked",
  );
  await page.goto(`https://www.youtube.com/watch?v=${unclassified}`);
  await expect(page.locator("html")).toHaveAttribute("data-qy-state", "error");
  await rpc("patchSettings", { patch: { hideShorts: false } });
  await expect(page.locator("html")).toHaveAttribute(
    "data-qy-state",
    "allowed",
  );
});

test("native Home, search and newly inserted cards are filtered without changing YouTube layout", async () => {
  await rpc("addChannel", { input: "@jawed" });
  await rpc("patchSettings", {
    patch: { homeFeed: "home", hideSearch: false },
  });
  const page = await context.newPage();
  await page.goto("https://www.youtube.com/");
  await expect(page).toHaveURL("https://www.youtube.com/");
  await expect(page.locator("#approved-card")).toBeVisible();
  await expect(page.locator("#blocked-card")).toBeHidden();
  await page.evaluate((id) => {
    const card = document.createElement("ytd-rich-item-renderer");
    card.id = "late-card";
    const inner = document.createElement("yt-lockup-view-model");
    const link = document.createElement("a");
    link.href = `/watch?v=${id}`;
    link.textContent = "Later video";
    inner.append(link);
    card.append(inner);
    document.body.append(card);
  }, bad);
  await expect(page.locator("#late-card")).toBeHidden();
  await page
    .locator("#late-card a")
    .evaluate((link, id) => (link.href = `/watch?v=${id}`), good);
  await expect(page.locator("#late-card")).toBeVisible();
  await page.goto("https://www.youtube.com/results?search_query=test");
  await expect(page.locator("#approved-card")).toBeVisible();
  await expect(page.locator("#blocked-card")).toBeHidden();
  await rpc("removeChannel", { id: approved });
  await expect(page.locator("#approved-card")).toBeHidden();
});
test("managed rules disable editing and reject mutation messages even after local tampering", async () => {
  // Simulate the browser policy API without changing this workstation's /etc
  // policies. Installation/removal protection needs a separate device test.
  const worker = context.serviceWorkers()[0];
  await worker.evaluate((channel) => {
    chrome.storage.managed.get = async () => ({
      ParentSettings: {
        channels: [{ id: channel, name: "Parent-approved channel" }],
        hideShorts: true,
      },
    });
  }, approved);
  await settingsPage.reload();
  await expect(settingsPage.getByText(/Managed by a parent/)).toBeVisible();
  await expect(
    settingsPage.getByLabel("YouTube channel link or @handle"),
  ).toBeDisabled();
  await expect(
    settingsPage.getByRole("checkbox", { name: /^Shorts/ }),
  ).toBeDisabled();
  for (const [type, payload] of [
    ["patchSettings", { patch: { mode: "subscriptions" } }],
    ["removeChannel", { id: approved }],
    ["addChannel", { input: "@another" }],
  ]) {
    const response = await settingsPage.evaluate(
      ({ type, payload }) => chrome.runtime.sendMessage({ type, ...payload }),
      { type, payload },
    );
    expect(response.ok).toBe(false);
    expect(response.error).toContain("managed by a parent");
  }
  await settingsPage.evaluate(() =>
    chrome.storage.local.set({
      settings: { mode: "subscriptions", hideShorts: false, channels: [] },
    }),
  );
  const effective = await rpc("getSettings");
  expect(effective.mode).toBe("approved");
  expect(effective.hideShorts).toBe(true);
  expect(effective.channels[0].id).toBe(approved);
});

import {
  DEFAULT_SETTINGS,
  FILTERS,
  effectiveSettings,
  channelInput,
  channelMetadata,
  videoMetadata,
  VIDEO_ID,
} from "./core.js";

const metadataCache = new Map();
const metadataRequests = new Map();
let mutation = Promise.resolve();
const getSettings = async () => {
  const [local, managed] = await Promise.all([
    chrome.storage.local.get("settings"),
    chrome.storage.managed.get("ParentSettings"),
  ]);
  return effectiveSettings(local.settings, managed);
};
const isUi = (sender) =>
  sender.id === chrome.runtime.id &&
  sender.url?.startsWith(chrome.runtime.getURL(""));
const isYoutube = (sender) => {
  try {
    return [
      "www.youtube.com",
      "youtube.com",
      "m.youtube.com",
      "www.youtube-nocookie.com",
    ].includes(new URL(sender.url).hostname);
  } catch {
    return false;
  }
};
async function fetchText(input) {
  const url = new URL(input);
  // Request public, cookieless HTML. Without this YouTube redirects requests
  // from some regions to its interactive consent page. This parameter is
  // undocumented; missing metadata must continue to fail closed.
  if (!url.pathname.startsWith("/feeds/")) url.searchParams.set("ucbcb", "1");
  const response = await fetch(url.href, {
    credentials: "omit",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(`YouTube returned ${response.status}. Try again shortly.`);
  if (new URL(response.url).hostname !== "www.youtube.com")
    throw new Error(
      "YouTube redirected to a consent or sign-in page. Verification is unavailable.",
    );
  return response.text();
}
async function init() {
  await chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  if (!(await chrome.storage.local.get("settings")).settings)
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
}
chrome.runtime.onInstalled.addListener(() => {
  init().catch(console.error);
});
chrome.runtime.onStartup.addListener(() => {
  init().catch(console.error);
});
async function broadcast(settings) {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs.map((tab) =>
      chrome.tabs.sendMessage(tab.id, { type: "settingsChanged", settings }),
    ),
  );
}
async function save(settings) {
  if ((await getSettings()).managed)
    throw new Error("These settings are managed by a parent on this device.");
  await chrome.storage.local.set({ settings });
  const effective = await getSettings();
  await broadcast(effective);
  return effective;
}
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "managed")
    getSettings()
      .then(broadcast)
      .catch(() => broadcast({ mode: "approved", channels: [] }));
});
async function handle(message, sender) {
  if (!isUi(sender) && !isYoutube(sender))
    throw new Error("Unsupported message source.");
  if (message.type === "getSettings") return getSettings();
  if (message.type === "openLibrary") {
    const url = "https://www.youtube.com/feed/subscriptions";
    if (sender.tab && sender.frameId === 0)
      await chrome.tabs.update(sender.tab.id, { url });
    else await chrome.tabs.create({ url });
    return true;
  }
  if (message.type === "checkVideo") {
    if (!VIDEO_ID.test(message.videoId)) throw new Error("Invalid video ID.");
    let metadata = metadataCache.get(message.videoId);
    if (!metadata) {
      let pending = metadataRequests.get(message.videoId);
      if (!pending) {
        pending = fetchText(
          `https://www.youtube.com/watch?v=${message.videoId}&hl=en`,
        ).then((html) => videoMetadata(html, message.videoId));
        metadataRequests.set(message.videoId, pending);
      }
      try {
        metadata = await pending;
      } finally {
        metadataRequests.delete(message.videoId);
      }
      if (metadataCache.size >= 300)
        metadataCache.delete(metadataCache.keys().next().value);
      metadataCache.set(message.videoId, metadata);
    }
    const settings = await getSettings();
    const channelAllowed =
      settings.mode === "subscriptions" ||
      settings.channels.some((channel) => channel.id === metadata.channelId);
    const blockedReason =
      settings.hideShorts && metadata.isShort !== false
        ? metadata.isShort === true
          ? "shorts"
          : "shorts_unknown"
        : channelAllowed
          ? null
          : "channel";
    return {
      ...metadata,
      allowed: blockedReason === null,
      blockedReason,
    };
  }
  if (!isUi(sender))
    throw new Error("Settings can only be changed from the extension.");
  if (
    ["patchSettings", "addChannel", "removeChannel"].includes(message.type) &&
    (await getSettings()).managed
  )
    throw new Error("These settings are managed by a parent on this device.");
  if (message.type === "patchSettings") {
    const settings = await getSettings();
    if (message.patch?.homeFeed !== undefined) {
      if (!["subscriptions", "home"].includes(message.patch.homeFeed))
        throw new Error("Unknown homepage choice.");
      settings.homeFeed = message.patch.homeFeed;
    }
    if (message.patch?.mode !== undefined) {
      if (!["approved", "subscriptions"].includes(message.patch.mode))
        throw new Error("Unknown viewing mode.");
      settings.mode = message.patch.mode;
    }
    for (const [key] of FILTERS)
      if (message.patch?.[key] !== undefined) {
        if (typeof message.patch[key] !== "boolean")
          throw new Error("Invalid toggle value.");
        settings[key] = message.patch[key];
      }
    return save(settings);
  }
  if (message.type === "addChannel") {
    const channel = channelMetadata(
      await fetchText(channelInput(message.input)),
    );
    const settings = await getSettings();
    if (!settings.channels.some((item) => item.id === channel.id)) {
      if (settings.channels.length >= 50)
        throw new Error("This prototype supports up to 50 channels.");
      settings.channels.push(channel);
    }
    await save(settings);
    return { settings, channel };
  }
  if (message.type === "removeChannel") {
    const settings = await getSettings();
    settings.channels = settings.channels.filter(
      (channel) => channel.id !== message.id,
    );
    return save(settings);
  }
  throw new Error("Unknown request.");
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const run = () => handle(message, sender);
  const isMutation = ["patchSettings", "addChannel", "removeChannel"].includes(
    message?.type,
  );
  const result = isMutation ? mutation.then(run) : Promise.resolve().then(run);
  if (isMutation) mutation = result.catch(() => {});
  result.then(
    (data) => reply({ ok: true, data }),
    (error) => reply({ ok: false, error: error.message }),
  );
  return true;
});

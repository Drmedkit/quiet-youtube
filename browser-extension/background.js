// src/core.js
var CHANNEL_ID = /^UC[\w-]{22}$/;
var VIDEO_ID = /^[\w-]{11}$/;
var DEFAULT_SETTINGS = {
  enabled: true,
  mode: "approved",
  homeFeed: "subscriptions",
  channels: [],
  hideShorts: true,
  hideComments: true,
  hideRecommendations: true,
  hideSearch: true,
  hideEndScreens: true,
  hideLiveChat: true,
  hideNotifications: true,
  disableAutoplay: true
};
var FILTERS = [
  ["hideShorts", "Shorts", "Hide Shorts on YouTube and block their playback."],
  [
    "hideRecommendations",
    "Recommendations",
    "Remove suggested videos beside the player."
  ],
  [
    "hideComments",
    "Comments",
    "Keep the conversation below the video out of view."
  ],
  ["hideSearch", "Search", "Hide search and block search results pages."],
  [
    "hideEndScreens",
    "End-screen suggestions",
    "Remove suggested videos and cards over the player."
  ],
  ["hideLiveChat", "Live chat", "Hide chat alongside live videos."],
  ["hideNotifications", "Notifications", "Hide the notification bell."],
  [
    "disableAutoplay",
    "Autoplay",
    "Turn off the next-video switch and preview playback."
  ]
];
function normalizeSettings(raw = {}) {
  const settings = { ...DEFAULT_SETTINGS, channels: [] };
  settings.mode = raw.mode === "subscriptions" ? "subscriptions" : "approved";
  settings.homeFeed = raw.homeFeed === "home" ? "home" : "subscriptions";
  settings.enabled = raw.enabled !== false;
  for (const [key] of FILTERS)
    if (typeof raw[key] === "boolean") settings[key] = raw[key];
  const seen = /* @__PURE__ */ new Set();
  for (const channel of Array.isArray(raw.channels) ? raw.channels : []) {
    if (!CHANNEL_ID.test(channel?.id) || seen.has(channel.id)) continue;
    seen.add(channel.id);
    settings.channels.push({
      id: channel.id,
      name: String(channel.name || channel.id).slice(0, 160),
      handle: String(channel.handle || "").slice(0, 100)
    });
  }
  return settings;
}
function effectiveSettings(local, policy = {}) {
  if (Object.hasOwn(policy, "ParentSettings")) {
    const managed = policy.ParentSettings;
    if (!managed || typeof managed !== "object" || Array.isArray(managed))
      throw new Error("The parent policy could not be read.");
    return {
      ...normalizeSettings(
        managed.enabled === false ? {
          ...managed,
          mode: "subscriptions",
          homeFeed: "home",
          ...Object.fromEntries(FILTERS.map(([key]) => [key, false]))
        } : { ...managed, mode: "approved" }
      ),
      managed: true
    };
  }
  return { ...normalizeSettings(local), managed: false };
}
function channelInput(value) {
  const input = String(value || "").trim();
  if (CHANNEL_ID.test(input)) return `https://www.youtube.com/channel/${input}`;
  if (/^@[\p{L}\p{N}_.·-]{3,100}$/u.test(input))
    return `https://www.youtube.com/${encodeURIComponent(input).replace("%40", "@")}`;
  let url;
  try {
    url = new URL(/^https?:\/\//.test(input) ? input : `https://${input}`);
  } catch {
    throw new Error("Paste a YouTube channel link or @handle.");
  }
  if (!["youtube.com", "www.youtube.com", "m.youtube.com"].includes(
    url.hostname
  ) || url.protocol !== "https:" || url.username || url.password || url.port)
    throw new Error("Use an https://www.youtube.com channel link.");
  const path = url.pathname.match(
    /^\/(channel\/UC[\w-]{22}|@[^/]+|c\/[^/]+|user\/[^/]+)(?:\/.*)?$/
  )?.[1];
  if (!path)
    throw new Error("Use a channel link, not a video or playlist link.");
  return `https://www.youtube.com/${path}`;
}
function extractJson(html, marker) {
  let offset = html.indexOf(marker);
  if (offset < 0) return null;
  const start = html.indexOf("{", offset + marker.length);
  if (start < 0 || start - offset > marker.length + 40) return null;
  let depth = 0, quoted = false, escaped = false;
  for (let index = start; index < html.length; index++) {
    const char = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, index + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}
function videoMetadata(html, expectedId) {
  const player = extractJson(html, "var ytInitialPlayerResponse =") || extractJson(html, "ytInitialPlayerResponse =");
  const details = player?.videoDetails;
  if (!details || details.videoId !== expectedId || !CHANNEL_ID.test(details.channelId))
    throw new Error(
      "YouTube did not provide a verifiable channel for this video."
    );
  const format = player.microformat?.playerMicroformatRenderer;
  const isShort = typeof format?.isShortsEligible === "boolean" && (!format.externalVideoId || format.externalVideoId === expectedId) ? format.isShortsEligible : null;
  return {
    id: expectedId,
    channelId: details.channelId,
    channel: String(details.author || ""),
    title: String(details.title || ""),
    isShort
  };
}
function channelMetadata(html) {
  const data = extractJson(html, "var ytInitialData =") || extractJson(html, "ytInitialData =");
  const metadata = data?.metadata?.channelMetadataRenderer;
  if (!CHANNEL_ID.test(metadata?.externalId))
    throw new Error(
      "Could not identify this channel. Check the link and try again."
    );
  const canonical = metadata.vanityChannelUrl || metadata.channelUrl || "";
  const handle2 = canonical.match(/\/@([^/?]+)/)?.[1];
  return {
    id: metadata.externalId,
    name: metadata.title || metadata.externalId,
    handle: handle2 ? `@${decodeURIComponent(handle2)}` : ""
  };
}

// src/background.js
var metadataCache = /* @__PURE__ */ new Map();
var metadataRequests = /* @__PURE__ */ new Map();
var mutation = Promise.resolve();
var getSettings = async () => {
  const [local, managed] = await Promise.all([
    chrome.storage.local.get("settings"),
    chrome.storage.managed.get("ParentSettings")
  ]);
  return effectiveSettings(local.settings, managed);
};
var isUi = (sender) => sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(""));
var isYoutube = (sender) => {
  try {
    return [
      "www.youtube.com",
      "youtube.com",
      "m.youtube.com",
      "www.youtube-nocookie.com"
    ].includes(new URL(sender.url).hostname);
  } catch {
    return false;
  }
};
async function fetchText(input) {
  const url = new URL(input);
  if (!url.pathname.startsWith("/feeds/")) url.searchParams.set("ucbcb", "1");
  const response = await fetch(url.href, {
    credentials: "omit",
    signal: AbortSignal.timeout(15e3)
  });
  if (!response.ok)
    throw new Error(`YouTube returned ${response.status}. Try again shortly.`);
  if (new URL(response.url).hostname !== "www.youtube.com")
    throw new Error(
      "YouTube redirected to a consent or sign-in page. Verification is unavailable."
    );
  return response.text();
}
async function init() {
  await chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS"
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
    tabs.map(
      (tab) => chrome.tabs.sendMessage(tab.id, { type: "settingsChanged", settings })
    )
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
    getSettings().then(broadcast).catch(() => broadcast({ mode: "approved", channels: [] }));
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
          `https://www.youtube.com/watch?v=${message.videoId}&hl=en`
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
    const channelAllowed = settings.mode === "subscriptions" || settings.channels.some((channel) => channel.id === metadata.channelId);
    const blockedReason = settings.hideShorts && metadata.isShort !== false ? metadata.isShort === true ? "shorts" : "shorts_unknown" : channelAllowed ? null : "channel";
    return {
      ...metadata,
      allowed: blockedReason === null,
      blockedReason
    };
  }
  if (!isUi(sender))
    throw new Error("Settings can only be changed from the extension.");
  if (["patchSettings", "addChannel", "removeChannel"].includes(message.type) && (await getSettings()).managed)
    throw new Error("These settings are managed by a parent on this device.");
  if (message.type === "patchSettings") {
    const settings = await getSettings();
    if (message.patch?.homeFeed !== void 0) {
      if (!["subscriptions", "home"].includes(message.patch.homeFeed))
        throw new Error("Unknown homepage choice.");
      settings.homeFeed = message.patch.homeFeed;
    }
    if (message.patch?.mode !== void 0) {
      if (!["approved", "subscriptions"].includes(message.patch.mode))
        throw new Error("Unknown viewing mode.");
      settings.mode = message.patch.mode;
    }
    for (const [key] of FILTERS)
      if (message.patch?.[key] !== void 0) {
        if (typeof message.patch[key] !== "boolean")
          throw new Error("Invalid toggle value.");
        settings[key] = message.patch[key];
      }
    return save(settings);
  }
  if (message.type === "addChannel") {
    const channel = channelMetadata(
      await fetchText(channelInput(message.input))
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
      (channel) => channel.id !== message.id
    );
    return save(settings);
  }
  throw new Error("Unknown request.");
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const run = () => handle(message, sender);
  const isMutation = ["patchSettings", "addChannel", "removeChannel"].includes(
    message?.type
  );
  const result = isMutation ? mutation.then(run) : Promise.resolve().then(run);
  if (isMutation) mutation = result.catch(() => {
  });
  result.then(
    (data) => reply({ ok: true, data }),
    (error) => reply({ ok: false, error: error.message })
  );
  return true;
});

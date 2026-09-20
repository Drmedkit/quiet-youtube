export const CHANNEL_ID = /^UC[\w-]{22}$/;
export const VIDEO_ID = /^[\w-]{11}$/;
export const DEFAULT_SETTINGS = {
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
  disableAutoplay: true,
};
export const FILTERS = [
  ["hideShorts", "Shorts", "Hide Shorts on YouTube and block their playback."],
  [
    "hideRecommendations",
    "Recommendations",
    "Remove suggested videos beside the player.",
  ],
  [
    "hideComments",
    "Comments",
    "Keep the conversation below the video out of view.",
  ],
  ["hideSearch", "Search", "Hide search and block search results pages."],
  [
    "hideEndScreens",
    "End-screen suggestions",
    "Remove suggested videos and cards over the player.",
  ],
  ["hideLiveChat", "Live chat", "Hide chat alongside live videos."],
  ["hideNotifications", "Notifications", "Hide the notification bell."],
  [
    "disableAutoplay",
    "Autoplay",
    "Turn off the next-video switch and preview playback.",
  ],
];
export function normalizeSettings(raw = {}) {
  const settings = { ...DEFAULT_SETTINGS, channels: [] };
  settings.mode = raw.mode === "subscriptions" ? "subscriptions" : "approved";
  settings.homeFeed = raw.homeFeed === "home" ? "home" : "subscriptions";
  settings.enabled = raw.enabled !== false;
  for (const [key] of FILTERS)
    if (typeof raw[key] === "boolean") settings[key] = raw[key];
  const seen = new Set();
  for (const channel of Array.isArray(raw.channels) ? raw.channels : []) {
    if (!CHANNEL_ID.test(channel?.id) || seen.has(channel.id)) continue;
    seen.add(channel.id);
    settings.channels.push({
      id: channel.id,
      name: String(channel.name || channel.id).slice(0, 160),
      handle: String(channel.handle || "").slice(0, 100),
    });
  }
  return settings;
}
export function effectiveSettings(local, policy = {}) {
  if (Object.hasOwn(policy, "ParentSettings")) {
    const managed = policy.ParentSettings;
    if (!managed || typeof managed !== "object" || Array.isArray(managed))
      throw new Error("The parent policy could not be read.");
    // Parent policy is complete and authoritative. Local toggles never merge
    // into it, and a malformed/missing channel list defaults to no approvals.
    return {
      ...normalizeSettings(
        managed.enabled === false
          ? {
              ...managed,
              mode: "subscriptions",
              homeFeed: "home",
              ...Object.fromEntries(FILTERS.map(([key]) => [key, false])),
            }
          : { ...managed, mode: "approved" },
      ),
      managed: true,
    };
  }
  return { ...normalizeSettings(local), managed: false };
}
export function channelInput(value) {
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
  if (
    !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(
      url.hostname,
    ) ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error("Use an https://www.youtube.com channel link.");
  const path = url.pathname.match(
    /^\/(channel\/UC[\w-]{22}|@[^/]+|c\/[^/]+|user\/[^/]+)(?:\/.*)?$/,
  )?.[1];
  if (!path)
    throw new Error("Use a channel link, not a video or playlist link.");
  return `https://www.youtube.com/${path}`;
}
export function routeInfo(href) {
  const url = new URL(href);
  const path = url.pathname;
  const part = path.match(/^\/(embed|shorts|live)\/([\w-]{11})(?:\/|$)/);
  const id = path === "/watch" ? url.searchParams.get("v") : part?.[2];
  return {
    path,
    videoId: VIDEO_ID.test(id || "") ? id : null,
    shorts: path.startsWith("/shorts"),
    embed: path.startsWith("/embed/"),
    home: path === "/",
    subscriptions: path === "/feed/subscriptions",
  };
}
// Read only the JSON object immediately following a specific YouTube assignment.
// A balanced scanner is necessary: JSON strings can contain braces and escapes.
export function extractJson(html, marker) {
  let offset = html.indexOf(marker);
  if (offset < 0) return null;
  const start = html.indexOf("{", offset + marker.length);
  if (start < 0 || start - offset > marker.length + 40) return null;
  let depth = 0,
    quoted = false,
    escaped = false;
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
export function videoMetadata(html, expectedId) {
  const player =
    extractJson(html, "var ytInitialPlayerResponse =") ||
    extractJson(html, "ytInitialPlayerResponse =");
  const details = player?.videoDetails;
  if (
    !details ||
    details.videoId !== expectedId ||
    !CHANNEL_ID.test(details.channelId)
  )
    throw new Error(
      "YouTube did not provide a verifiable channel for this video.",
    );
  const format = player.microformat?.playerMicroformatRenderer;
  const isShort =
    typeof format?.isShortsEligible === "boolean" &&
    (!format.externalVideoId || format.externalVideoId === expectedId)
      ? format.isShortsEligible
      : null;
  return {
    id: expectedId,
    channelId: details.channelId,
    channel: String(details.author || ""),
    title: String(details.title || ""),
    isShort,
  };
}
export function channelMetadata(html) {
  const data =
    extractJson(html, "var ytInitialData =") ||
    extractJson(html, "ytInitialData =");
  const metadata = data?.metadata?.channelMetadataRenderer;
  if (!CHANNEL_ID.test(metadata?.externalId))
    throw new Error(
      "Could not identify this channel. Check the link and try again.",
    );
  const canonical = metadata.vanityChannelUrl || metadata.channelUrl || "";
  const handle = canonical.match(/\/@([^/?]+)/)?.[1];
  return {
    id: metadata.externalId,
    name: metadata.title || metadata.externalId,
    handle: handle ? `@${decodeURIComponent(handle)}` : "",
  };
}

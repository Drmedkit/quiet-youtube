import test from "node:test";
import assert from "node:assert/strict";
import {
  channelInput,
  channelMetadata,
  videoMetadata,
  normalizeSettings,
  effectiveSettings,
  extractJson,
  routeInfo,
} from "../src/core.js";
const channel = "UC4QobU6STFB0P71PMvOGN5A";
const video = "jNQXAC9IVRw";
test("channel inputs reject unrelated hosts, credentials, insecure URLs and video links", () => {
  assert.equal(channelInput("@jawed"), "https://www.youtube.com/@jawed");
  assert.equal(
    channelInput(channel),
    `https://www.youtube.com/channel/${channel}`,
  );
  assert.equal(
    channelInput("https://www.youtube.com/@jawed/videos?x=1"),
    "https://www.youtube.com/@jawed",
  );
  for (const value of [
    "https://evil.test/@jawed",
    "http://www.youtube.com/@jawed",
    "https://www.youtube.com.evil.test/@jawed",
    "https://u:p@www.youtube.com/@jawed",
    "https://www.youtube.com:8443/@jawed",
    `https://www.youtube.com/watch?v=${video}`,
  ])
    assert.throws(() => channelInput(value));
});
test("JSON extraction handles braces and escaped quotes in strings", () => {
  const data = { text: 'a { brace } and "quote" \\', nested: { a: [1, 2] } };
  assert.deepEqual(
    extractJson(
      `var ytInitialData = ${JSON.stringify(data)}; trailing();`,
      "var ytInitialData =",
    ),
    data,
  );
  assert.equal(
    extractJson("var ytInitialData = {bad}", "var ytInitialData ="),
    null,
  );
});
test("channel approval uses channel metadata, never a recommended channel ID", () => {
  const html = `var ytInitialData = ${JSON.stringify({ unrelated: { channelId: "UCxxxxxxxxxxxxxxxxxxxxxx" }, metadata: { channelMetadataRenderer: { externalId: channel, title: "Jawed", vanityChannelUrl: "https://www.youtube.com/@jawed" } } })};`;
  assert.deepEqual(channelMetadata(html), {
    id: channel,
    name: "Jawed",
    handle: "@jawed",
  });
  assert.throws(() => channelMetadata('{"channelId":"' + channel + '"}'));
});
test("video verification requires matching video identity and stable channel ID", () => {
  const html = `var ytInitialPlayerResponse = ${JSON.stringify({ videoDetails: { videoId: video, channelId: channel, author: "Jawed", title: "Me at the zoo" } })};`;
  assert.equal(videoMetadata(html, video).channelId, channel);
  assert.throws(() => videoMetadata(html, "aaaaaaaaaaa"));
  assert.throws(() => videoMetadata("<html>Sign in</html>", video));
});
test("Shorts classification uses YouTube's flag, not a duration guess", () => {
  const make = (format) =>
    `var ytInitialPlayerResponse = ${JSON.stringify({ videoDetails: { videoId: video, channelId: channel, lengthSeconds: "19" }, microformat: { playerMicroformatRenderer: format } })};`;
  assert.equal(
    videoMetadata(
      make({ isShortsEligible: false, externalVideoId: video }),
      video,
    ).isShort,
    false,
  );
  assert.equal(
    videoMetadata(
      make({ isShortsEligible: true, externalVideoId: video }),
      video,
    ).isShort,
    true,
  );
  assert.equal(videoMetadata(make({}), video).isShort, null);
  assert.equal(
    videoMetadata(
      make({ isShortsEligible: false, externalVideoId: "aaaaaaaaaaa" }),
      video,
    ).isShort,
    null,
  );
});
test("stored settings default to approved mode and reject invalid/duplicate channels", () => {
  const settings = normalizeSettings({
    mode: "anything",
    hideComments: "false",
    channels: [
      { id: channel, name: "one" },
      { id: channel, name: "two" },
      { id: "invalid" },
    ],
  });
  assert.equal(settings.mode, "approved");
  assert.equal(settings.hideComments, true);
  assert.equal(settings.channels.length, 1);
  assert.equal(normalizeSettings({ hideComments: false }).hideComments, false);
});
test("active parent policy overrides local settings and forces approved-channel mode", () => {
  const result = effectiveSettings(
    { mode: "subscriptions", hideShorts: false, channels: [{ id: channel }] },
    { ParentSettings: { mode: "subscriptions", channels: [] } },
  );
  assert.equal(result.managed, true);
  assert.equal(result.mode, "approved");
  assert.equal(result.hideShorts, true);
  assert.deepEqual(result.channels, []);
  assert.equal(effectiveSettings({ mode: "subscriptions" }).managed, false);
  assert.throws(() => effectiveSettings({}, { ParentSettings: null }));
});
test("only an explicit managed pause releases filtering while keeping settings managed", () => {
  const paused = effectiveSettings({}, { ParentSettings: { enabled: false } });
  assert.equal(paused.enabled, false);
  assert.equal(paused.managed, true);
  assert.equal(paused.mode, "subscriptions");
  assert.equal(paused.homeFeed, "home");
  assert.equal(paused.hideShorts, false);
  assert.equal(paused.disableAutoplay, false);
  const active = effectiveSettings({ enabled: false }, { ParentSettings: {} });
  assert.equal(active.enabled, true);
  assert.equal(active.mode, "approved");
});
test("routes distinguish video links, embeds, Shorts and malformed IDs", () => {
  assert.equal(
    routeInfo(`https://www.youtube.com/watch?v=${video}`).videoId,
    video,
  );
  assert.equal(
    routeInfo(`https://www.youtube-nocookie.com/embed/${video}`).videoId,
    video,
  );
  assert.equal(
    routeInfo(`https://www.youtube.com/shorts/${video}`).shorts,
    true,
  );
  assert.equal(routeInfo("https://www.youtube.com/watch?v=bad").videoId, null);
  assert.equal(routeInfo("https://www.youtube.com/").home, true);
});

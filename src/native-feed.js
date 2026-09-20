import { routeInfo } from "./core.js";

// Keep these in step with content.css. Known video containers start hidden
// before YouTube inserts them, so unverified thumbnails do not flash on screen.
export const CARD_SELECTOR = [
  "ytd-rich-item-renderer",
  "ytd-video-renderer",
  "ytd-grid-video-renderer",
  "ytd-compact-video-renderer",
  "ytd-playlist-video-renderer",
  "ytd-playlist-panel-video-renderer",
  "yt-lockup-view-model",
  "ytd-reel-item-renderer",
  "ytm-video-with-context-renderer",
  "ytm-shorts-lockup-view-model",
  "ytm-shorts-lockup-view-model-v2",
].join(",");

export function createFeedFilter(getSettings, checkVideo) {
  const records = new WeakMap();
  let generation = 0,
    active = 0,
    queue = [],
    cache = new Map();
  function fingerprint(card) {
    return [...card.querySelectorAll("a[href]")]
      .map((link) => link.getAttribute("href"))
      .join("\n");
  }
  function videoIn(card) {
    for (const link of card.querySelectorAll("a[href]")) {
      try {
        const url = new URL(link.href, location.href);
        if (
          !["www.youtube.com", "youtube.com", "m.youtube.com"].includes(
            url.hostname,
          )
        )
          continue;
        const route = routeInfo(url.href);
        if (route.videoId) return route;
      } catch {
        /* Ignore non-URL controls. */
      }
    }
    return null;
  }
  function finish(item, allowed) {
    if (
      item.generation !== generation ||
      records.get(item.card) !== item ||
      !item.card.isConnected ||
      fingerprint(item.card) !== item.fingerprint
    )
      return;
    item.card.setAttribute("data-qy-card", allowed ? "allowed" : "blocked");
  }
  function pump() {
    while (active < 4 && queue.length) {
      const item = queue.shift();
      if (item.generation !== generation || !item.card.isConnected) continue;
      active++;
      let request = cache.get(item.videoId);
      if (!request) {
        request = checkVideo(item.videoId);
        cache.set(item.videoId, request);
        if (cache.size > 500) cache.delete(cache.keys().next().value);
      }
      request
        .then(
          (result) => finish(item, result.allowed),
          () => finish(item, false),
        )
        .finally(() => {
          active--;
          pump();
        });
    }
  }
  function scan() {
    const settings = getSettings();
    if (!settings) return;
    const filter = settings.mode === "approved" || settings.hideShorts;
    document.documentElement?.toggleAttribute("data-qy-nativefilter", filter);
    for (const card of document.querySelectorAll(CARD_SELECTOR)) {
      // Rich items can wrap a lockup. Verify the outer card once, while letting
      // the nested element inherit its visibility.
      if (card.parentElement?.closest(CARD_SELECTOR)) {
        card.setAttribute("data-qy-card", "nested");
        continue;
      }
      if (!filter) {
        card.setAttribute("data-qy-card", "allowed");
        continue;
      }
      const signature = fingerprint(card);
      const old = records.get(card);
      if (old?.generation === generation && old.fingerprint === signature)
        continue;
      const video = videoIn(card);
      const item = {
        card,
        fingerprint: signature,
        generation,
        videoId: video?.videoId,
      };
      records.set(card, item);
      card.setAttribute("data-qy-card", "pending");
      if (
        !video ||
        (video.shorts && settings.hideShorts) ||
        (settings.mode === "approved" && settings.channels.length === 0)
      ) {
        finish(item, false);
        continue;
      }
      queue.push(item);
    }
    pump();
  }
  function invalidateNode(node) {
    const card =
      node instanceof Element
        ? node.closest(CARD_SELECTOR)
        : node.parentElement?.closest(CARD_SELECTOR);
    if (!card) return;
    const outer = card.parentElement?.closest(CARD_SELECTOR) || card;
    if (records.get(outer)?.fingerprint === fingerprint(outer)) return;
    records.delete(outer);
    outer.setAttribute("data-qy-card", "pending");
  }
  function reset() {
    generation++;
    queue = [];
    cache = new Map();
    scan();
  }
  return { scan, reset, invalidateNode };
}

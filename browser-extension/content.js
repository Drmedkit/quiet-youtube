(() => {
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
    const settings2 = { ...DEFAULT_SETTINGS, channels: [] };
    settings2.mode = raw.mode === "subscriptions" ? "subscriptions" : "approved";
    settings2.homeFeed = raw.homeFeed === "home" ? "home" : "subscriptions";
    settings2.enabled = raw.enabled !== false;
    for (const [key] of FILTERS)
      if (typeof raw[key] === "boolean") settings2[key] = raw[key];
    const seen = /* @__PURE__ */ new Set();
    for (const channel of Array.isArray(raw.channels) ? raw.channels : []) {
      if (!CHANNEL_ID.test(channel?.id) || seen.has(channel.id)) continue;
      seen.add(channel.id);
      settings2.channels.push({
        id: channel.id,
        name: String(channel.name || channel.id).slice(0, 160),
        handle: String(channel.handle || "").slice(0, 100)
      });
    }
    return settings2;
  }
  function routeInfo(href) {
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
      subscriptions: path === "/feed/subscriptions"
    };
  }

  // src/native-feed.js
  var CARD_SELECTOR = [
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
    "ytm-shorts-lockup-view-model-v2"
  ].join(",");
  function createFeedFilter(getSettings, checkVideo) {
    const records = /* @__PURE__ */ new WeakMap();
    let generation = 0, active = 0, queue = [], cache = /* @__PURE__ */ new Map();
    function fingerprint(card) {
      return [...card.querySelectorAll("a[href]")].map((link) => link.getAttribute("href")).join("\n");
    }
    function videoIn(card) {
      for (const link of card.querySelectorAll("a[href]")) {
        try {
          const url = new URL(link.href, location.href);
          if (!["www.youtube.com", "youtube.com", "m.youtube.com"].includes(
            url.hostname
          ))
            continue;
          const route = routeInfo(url.href);
          if (route.videoId) return route;
        } catch {
        }
      }
      return null;
    }
    function finish(item, allowed) {
      if (item.generation !== generation || records.get(item.card) !== item || !item.card.isConnected || fingerprint(item.card) !== item.fingerprint)
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
        request.then(
          (result) => finish(item, result.allowed),
          () => finish(item, false)
        ).finally(() => {
          active--;
          pump();
        });
      }
    }
    function scan() {
      const settings2 = getSettings();
      if (!settings2) return;
      const filter = settings2.mode === "approved" || settings2.hideShorts;
      document.documentElement?.toggleAttribute("data-qy-nativefilter", filter);
      for (const card of document.querySelectorAll(CARD_SELECTOR)) {
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
          videoId: video?.videoId
        };
        records.set(card, item);
        card.setAttribute("data-qy-card", "pending");
        if (!video || video.shorts && settings2.hideShorts || settings2.mode === "approved" && settings2.channels.length === 0) {
          finish(item, false);
          continue;
        }
        queue.push(item);
      }
      pump();
    }
    function invalidateNode(node) {
      const card = node instanceof Element ? node.closest(CARD_SELECTOR) : node.parentElement?.closest(CARD_SELECTOR);
      if (!card) return;
      const outer = card.parentElement?.closest(CARD_SELECTOR) || card;
      if (records.get(outer)?.fingerprint === fingerprint(outer)) return;
      records.delete(outer);
      outer.setAttribute("data-qy-card", "pending");
    }
    function reset() {
      generation++;
      queue = [];
      cache = /* @__PURE__ */ new Map();
      scan();
    }
    return { scan, reset, invalidateNode };
  }

  // src/content.js
  var settings = null;
  var revision = 0;
  var currentHref = "";
  var overlay;
  var status = { state: "checking" };
  var feedFilter = createFeedFilter(
    () => settings,
    (videoId) => send({ type: "checkVideo", videoId })
  );
  var root = () => document.documentElement;
  async function send(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok)
      throw new Error(
        response?.error || "The extension is unavailable. Reload this tab."
      );
    return response.data;
  }
  function gate(allow) {
    window.dispatchEvent(
      new CustomEvent("quiet-youtube-gate", {
        detail: {
          allow,
          href: location.href,
          disableAutoplay: settings?.disableAutoplay !== false
        }
      })
    );
    if (!allow)
      document.querySelectorAll("video,audio").forEach((media) => {
        media.pause();
        media.autoplay = false;
      });
  }
  function holdPage() {
    status = { state: "checking" };
    root()?.setAttribute("data-qy-state", "checking");
    root()?.setAttribute("data-qy-ready", "true");
    if (overlay) overlay.hidden = true;
    gate(false);
  }
  function returnToSubscriptions() {
    ++revision;
    holdPage();
    location.replace("https://www.youtube.com/feed/subscriptions");
  }
  function restrictedPage(route) {
    if (route.home && settings.homeFeed !== "home") return true;
    if (route.path === "/results" && settings.hideSearch) return true;
    if (route.videoId || route.path === "/watch" || route.embed || route.shorts && settings.hideShorts)
      return false;
    if (settings.mode !== "approved") return false;
    let path;
    try {
      path = decodeURIComponent(route.path);
    } catch {
      return true;
    }
    const channel = settings.channels.some(
      (item) => path === `/channel/${item.id}` || path.startsWith(`/channel/${item.id}/`) || item.handle && (path.toLowerCase() === `/${item.handle.toLowerCase()}` || path.toLowerCase().startsWith(`/${item.handle.toLowerCase()}/`))
    );
    return !channel && !route.home && !route.subscriptions && route.path !== "/results";
  }
  function showOverlay(title, message, state = "blocked") {
    status = { state, title, message };
    root()?.setAttribute("data-qy-state", state);
    gate(false);
    if (!root()) return;
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "quiet-youtube-overlay";
      const shadow = overlay.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent = `:host{all:initial;font-family:system-ui,sans-serif;color:#293329}*{box-sizing:border-box}.screen{min-height:100dvh;display:grid;place-items:center;padding:24px;background:#f5f4ef}.message{width:min(100%,460px)}.brand{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#60775e;margin-bottom:32px}h1{font-size:30px;line-height:1.15;font-weight:550;letter-spacing:-.035em;margin:0 0 15px}p{font-size:15px;line-height:1.65;color:#697068;margin:0 0 28px}button{font:inherit;background:#426349;color:#fff;border:0;border-radius:8px;padding:13px 18px;cursor:pointer}button:focus-visible{outline:3px solid #86a881;outline-offset:4px}button:active{transform:scale(.98)}.retry{background:transparent;color:#426349;margin-left:8px}.small{font-size:12px;margin-top:22px}@media(max-height:280px){.screen{padding:16px}.brand{margin-bottom:10px}h1{font-size:22px}p{margin-bottom:12px}.small{display:none}}`;
      const screen = document.createElement("section");
      screen.className = "screen";
      const box = document.createElement("div");
      box.className = "message";
      const brand = document.createElement("div");
      brand.className = "brand";
      brand.textContent = "Quiet YouTube";
      const heading = document.createElement("h1");
      heading.id = "heading";
      const description = document.createElement("p");
      description.id = "description";
      description.setAttribute("role", "status");
      const library = document.createElement("button");
      library.textContent = "Go to my videos";
      library.addEventListener(
        "click",
        () => send({ type: "openLibrary" }).catch((error) => {
          description.textContent = error.message;
        })
      );
      const retry = document.createElement("button");
      retry.className = "retry";
      retry.textContent = "Try again";
      retry.addEventListener("click", refresh);
      box.append(brand, heading, description, library, retry);
      screen.append(box);
      shadow.append(style, screen);
      overlay.heading = heading;
      overlay.description = description;
      root().append(overlay);
    }
    overlay.heading.textContent = title;
    overlay.description.textContent = message;
    overlay.hidden = false;
    root().setAttribute("data-qy-ready", "true");
  }
  function release(allowMedia, info = {}) {
    status = { state: "allowed", ...info };
    if (overlay) overlay.hidden = true;
    root()?.setAttribute("data-qy-state", "allowed");
    root()?.setAttribute("data-qy-ready", "true");
    gate(allowMedia);
    applyAutoplay();
    feedFilter.scan();
  }
  function applyFilters() {
    if (!root() || !settings) return;
    for (const [key] of FILTERS)
      root().toggleAttribute(`data-qy-${key.toLowerCase()}`, settings[key]);
    root().toggleAttribute(
      "data-qy-nativefilter",
      settings.mode === "approved" || settings.hideShorts
    );
  }
  function applyAutoplay() {
    if (!settings?.disableAutoplay) return;
    const toggle = document.querySelector(
      '.ytp-autonav-toggle-button[aria-checked="true"]'
    );
    if (toggle) toggle.click();
    document.querySelectorAll("video[autoplay],audio[autoplay]").forEach((media) => {
      media.autoplay = false;
    });
  }
  async function evaluate() {
    const check = ++revision;
    currentHref = location.href;
    const href = currentHref;
    gate(false);
    applyFilters();
    if (!settings) return holdPage();
    const route = routeInfo(href);
    if (restrictedPage(route)) {
      if (window.top !== window)
        return showOverlay(
          "Open YouTube",
          "Choose a video from your approved channels."
        );
      returnToSubscriptions();
      return;
    }
    if (route.shorts && settings.hideShorts)
      return showOverlay(
        "Shorts are switched off",
        "Choose a regular video from an approved channel instead."
      );
    if (!route.videoId && (route.path === "/watch" || route.embed))
      return showOverlay(
        "This player is not supported",
        "Open an individual video so its channel can be checked."
      );
    if (route.videoId) {
      if (settings.mode === "subscriptions" && !settings.hideShorts)
        return release(true, { videoId: route.videoId });
      holdPage();
      try {
        const result = await send({ type: "checkVideo", videoId: route.videoId });
        if (check !== revision || href !== location.href) return;
        if (result.allowed) release(true, result);
        else if (result.blockedReason === "shorts") {
          showOverlay(
            "Shorts are switched off",
            "Choose a regular video from an approved channel instead."
          );
        } else if (result.blockedReason === "shorts_unknown") {
          showOverlay(
            "We couldn\u2019t check this video",
            "YouTube did not confirm whether this is a Short. Playback stays paused. Try again shortly.",
            "error"
          );
        } else {
          showOverlay(
            "This channel is not on your list",
            `${result.channel || "This creator"} has not been approved. Open an approved channel instead.`
          );
          status = { ...status, video: result };
        }
      } catch (error) {
        if (check === revision && href === location.href)
          showOverlay(
            "We couldn\u2019t check this video",
            `${error.message} Playback stays paused. You can try again.`,
            "error"
          );
      }
      return;
    }
    release(!settings.disableAutoplay && settings.mode === "subscriptions");
  }
  function refresh() {
    evaluate().catch(
      (error) => showOverlay("The extension needs attention", error.message, "error")
    );
  }
  document.addEventListener(
    "yt-navigate-start",
    () => {
      ++revision;
      holdPage();
    },
    true
  );
  window.addEventListener(
    "click",
    (event) => {
      if (!settings || window.top !== window || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const link = event.composedPath().find((node) => node instanceof HTMLAnchorElement);
      if (!link || link.hasAttribute("download") || link.target && link.target !== "_self")
        return;
      const url = new URL(link.href);
      if (url.origin !== location.origin || !restrictedPage(routeInfo(url.href)))
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!routeInfo(location.href).subscriptions) returnToSubscriptions();
    },
    true
  );
  document.addEventListener("yt-navigate-finish", refresh, true);
  window.addEventListener("quiet-youtube-navigation", refresh);
  window.addEventListener("popstate", refresh);
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      applyFilters();
      refresh();
    },
    { once: true }
  );
  var mutationTimer;
  new MutationObserver((records) => {
    for (const record of records) feedFilter.invalidateNode(record.target);
    if (mutationTimer) return;
    mutationTimer = setTimeout(() => {
      mutationTimer = null;
      applyAutoplay();
      feedFilter.scan();
    }, 150);
  }).observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-checked", "href"]
  });
  setInterval(() => {
    if (location.href !== currentHref) refresh();
  }, 500);
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === "settingsChanged") {
      settings = normalizeSettings(message.settings);
      feedFilter.reset();
      refresh();
    }
    if (message.type === "getPageStatus")
      reply({ ...status, url: location.href });
  });
  send({ type: "getSettings" }).then((value) => {
    settings = normalizeSettings(value);
    refresh();
  }).catch(
    (error) => showOverlay(
      "The extension is unavailable",
      `${error.message} Reload the tab to reconnect.`,
      "error"
    )
  );
})();

// Playback coordination in YouTube's JS world. This is a UX guard, not a
// tamper-proof boundary: page scripts/devtools can inspect or replace it.
(() => {
  let allowed = false,
    approvedUrl = "",
    autoplayOff = true;
  const play = HTMLMediaElement.prototype.play;
  const pause = HTMLMediaElement.prototype.pause;
  function stop(media) {
    pause.call(media);
    media.autoplay = false;
  }
  function lock() {
    allowed = false;
    document.querySelectorAll("video,audio").forEach(stop);
  }
  HTMLMediaElement.prototype.play = function (...args) {
    if (!allowed || approvedUrl !== location.href) {
      stop(this);
      return Promise.reject(
        new DOMException("Choose an approved video first.", "NotAllowedError"),
      );
    }
    return play.apply(this, args);
  };
  for (const event of ["play", "playing", "loadeddata"])
    document.addEventListener(
      event,
      (e) => {
        if (
          e.target instanceof HTMLMediaElement &&
          (!allowed || approvedUrl !== location.href)
        )
          stop(e.target);
      },
      true,
    );
  window.addEventListener("quiet-youtube-gate", (event) => {
    const data = event.detail;
    if (!data || data.href !== location.href) return;
    autoplayOff = data.disableAutoplay !== false;
    approvedUrl = data.href;
    allowed = data.allow === true;
    if (!allowed) lock();
  });
  document.addEventListener("yt-navigate-start", lock, true);
  window.addEventListener("popstate", lock, true);
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function (...args) {
      const before = location.href;
      const result = original.apply(this, args);
      if (before !== location.href) {
        lock();
        window.dispatchEvent(new Event("quiet-youtube-navigation"));
      }
      return result;
    };
  }
  new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes)
        if (node instanceof Element) {
          const media = [
            ...node.querySelectorAll("video,audio"),
            ...(node.matches("video,audio") ? [node] : []),
          ];
          for (const item of media) {
            if (!allowed || approvedUrl !== location.href) stop(item);
            if (autoplayOff) item.autoplay = false;
          }
        }
  }).observe(document, { childList: true, subtree: true });
})();

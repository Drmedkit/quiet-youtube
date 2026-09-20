import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRightIcon,
  ArrowRightIcon,
  CheckIcon,
  PlusIcon,
  TrashIcon,
  PlayIcon,
  SlidersHorizontalIcon,
  SquaresFourIcon,
  YoutubeLogoIcon,
} from "@phosphor-icons/react";
import { FILTERS } from "./core.js";
import "./ui.css";

const popup = location.pathname.endsWith("popup.html");
if (popup) {
  document.body.style.width = "364px";
  document.body.style.minHeight = "300px";
}
async function request(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok)
    throw new Error(
      response?.error || "The extension did not respond. Reload and try again.",
    );
  return response.data;
}
const openPage = (hash) =>
  chrome.tabs.create({ url: chrome.runtime.getURL(`index.html#${hash}`) });
function Mark() {
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-leaf text-white">
      <PlayIcon size={17} weight="fill" />
    </span>
  );
}
function Brand() {
  return (
    <div className="flex items-center gap-3">
      <Mark />
      <div className="font-semibold tracking-tight">Quiet YouTube</div>
    </div>
  );
}
function Toggle({ label, description, checked, onChange, disabled }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-6 border-b border-line py-5 last:border-b-0">
      <span>
        <span className="block font-medium">{label}</span>
        <span className="mt-1 block text-xs leading-relaxed text-muted">
          {description}
        </span>
      </span>
      <span className="relative shrink-0">
        <input
          type="checkbox"
          className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
        />
        <span className="block h-6 w-11 rounded-full bg-[#cfd2c6] transition-colors peer-checked:bg-leaf peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-leaf peer-disabled:opacity-50" />
        <span className="absolute left-1 top-1 size-4 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}
function Popup({ settings }) {
  const [page, setPage] = useState(null);
  useEffect(() => {
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(async ([tab]) => {
        if (!tab?.id) return;
        try {
          setPage(
            await chrome.tabs.sendMessage(
              tab.id,
              { type: "getPageStatus" },
              { frameId: 0 },
            ),
          );
        } catch {
          setPage({ state: "unconnected" });
        }
      });
  }, []);
  return (
    <main className="p-6">
      <Brand />
      <div className="mb-6 mt-7 border-y border-line py-5">
        <p className="eyebrow">Viewing mode</p>
        <h1 className="mt-2 text-xl font-medium tracking-tight">
          {settings.mode === "approved"
            ? "Approved channels only"
            : "All channels"}
        </h1>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          {settings.mode === "approved"
            ? `${settings.channels.length} approved ${settings.channels.length === 1 ? "channel" : "channels"}. Other videos are checked and blocked.`
            : "Distractions hidden. Direct video links are still allowed."}
        </p>
      </div>
      <div className="mb-5 text-xs text-muted" role="status">
        {!page
          ? "Checking this tab…"
          : page.state === "unconnected"
            ? "Open or reload a YouTube tab to connect."
            : page.state === "allowed"
              ? "This YouTube page is ready."
              : page.title || "Checking this page…"}
      </div>
      <button
        className="primary w-full"
        onClick={() =>
          chrome.tabs.create({
            url: "https://www.youtube.com/feed/subscriptions",
          })
        }
      >
        Open my videos <ArrowUpRightIcon size={16} />
      </button>
      <button
        className="mt-2 w-full py-3 text-xs text-muted hover:text-ink"
        onClick={() => openPage("settings")}
      >
        Channels & settings
      </button>
      <p className="border-t border-line pt-4 text-[11px] leading-relaxed text-muted">
        Browser prototype · Settings can be changed and the extension can be
        removed.
      </p>
    </main>
  );
}
function Settings({ settings, setSettings }) {
  const [input, setInput] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState("");
  async function run(action, note) {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const result = await action();
      setSettings(result.settings || result);
      setSaved(typeof note === "function" ? note(result) : note);
    } catch (error) {
      setError(error.message);
      try {
        setSettings(await request("getSettings"));
      } catch {}
    } finally {
      setBusy(false);
    }
  }
  async function add(event) {
    event.preventDefault();
    await run(
      async () => {
        const result = await request("addChannel", { input });
        setInput("");
        return result;
      },
      (result) => `${result.channel.name} is on your list.`,
    );
  }
  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_260px] lg:gap-20">
      <div className="min-w-0">
        <h1 className="text-4xl font-medium tracking-[-.045em]">Channels</h1>
        {settings.managed && (
          <p className="notice mt-5" role="status">
            Managed by a parent.{" "}
            {settings.enabled === false ? "Protection is paused. " : ""}
            Change channels and settings in the Quiet YouTube Omarchy menu or
            CLI.
          </p>
        )}
        <section className="mt-10 border-t border-line pt-7">
          <div className="flex items-baseline gap-3">
            <span className="eyebrow">01</span>
            <h2 className="text-lg font-medium tracking-tight">
              Choose a viewing mode
            </h2>
          </div>
          <fieldset
            disabled={busy || settings.managed}
            className="mt-5 grid gap-3 sm:grid-cols-2"
          >
            <legend className="sr-only">Viewing mode</legend>
            {[
              [
                "approved",
                "Approved channels",
                "Use normal YouTube, with videos limited to the channels you approve.",
              ],
              [
                "subscriptions",
                "All channels",
                "Hide distractions without limiting which channels can play.",
              ],
            ].map(([value, title, description]) => (
              <label
                key={value}
                className={`relative cursor-pointer rounded-xl border p-4 ${settings.mode === value ? "border-leaf bg-wash" : "border-line bg-white/30"}`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="mode"
                    value={value}
                    checked={settings.mode === value}
                    onChange={() =>
                      run(
                        () =>
                          request("patchSettings", { patch: { mode: value } }),
                        "Viewing mode saved.",
                      )
                    }
                    className="accent-leaf"
                  />
                  <span className="font-medium">{title}</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  {description}
                </p>
              </label>
            ))}
          </fieldset>
          <label className="mt-5 block text-xs font-medium" htmlFor="home-feed">
            YouTube homepage
          </label>
          <select
            id="home-feed"
            className="input mt-2"
            disabled={busy || settings.managed}
            value={settings.homeFeed}
            onChange={(event) =>
              run(
                () =>
                  request("patchSettings", {
                    patch: { homeFeed: event.target.value },
                  }),
                "Homepage saved.",
              )
            }
          >
            <option value="subscriptions">Open Subscriptions</option>
            <option value="home">Keep YouTube Home</option>
          </select>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            The Subscriptions feed uses your signed-in YouTube account.
            Approving a channel here does not subscribe to it. You can also open
            an approved channel directly.
          </p>
        </section>
        <section className="mt-9 border-t border-line pt-7">
          <div className="flex items-baseline gap-3">
            <span className="eyebrow">02</span>
            <h2 className="text-lg font-medium tracking-tight">
              Your approved channels
            </h2>
            <span className="ml-auto text-xs tabular-nums text-muted">
              {settings.channels.length} / 50
            </span>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            Approving a channel permits all its videos, including future
            uploads. This list is separate from your Google subscriptions.
          </p>
          <form className="mt-5" onSubmit={add}>
            <label htmlFor="channel" className="mb-2 block text-xs font-medium">
              YouTube channel link or @handle
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="channel"
                className="input min-w-0 flex-1"
                placeholder="youtube.com/@channel"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                required
                disabled={busy || settings.managed}
                autoComplete="off"
              />
              <button
                className="primary shrink-0"
                disabled={busy || settings.managed || !input.trim()}
                type="submit"
              >
                <PlusIcon size={16} />
                {busy ? "Working…" : "Add channel"}
              </button>
            </div>
          </form>
          <div className="mt-4" aria-live="polite">
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {saved && (
              <p className="flex items-center gap-2 text-xs text-leaf">
                <CheckIcon size={16} />
                {saved}
              </p>
            )}
          </div>
          {settings.channels.length === 0 ? (
            <div className="my-6 border-y border-dashed border-line py-7">
              <p className="font-medium">No approved channels yet.</p>
              <p className="mt-2 max-w-md text-xs leading-relaxed text-muted">
                Add a channel you already trust. In approved-channel mode,
                videos stay blocked until you add one.
              </p>
            </div>
          ) : (
            <ul className="mt-5 divide-y divide-line">
              {settings.channels.map((channel) => (
                <li key={channel.id} className="flex items-center gap-3 py-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-wash font-medium text-leaf">
                    {channel.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <a
                      className="block truncate font-medium text-leaf hover:underline"
                      href={`https://www.youtube.com/channel/${channel.id}/videos`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {channel.name} ↗
                    </a>
                    <p className="mt-1 truncate text-[11px] text-muted">
                      {channel.handle || channel.id}
                    </p>
                  </div>
                  <button
                    className="rounded-lg p-2 text-muted hover:bg-wash hover:text-ink"
                    aria-label={`Remove ${channel.name}`}
                    disabled={busy || settings.managed}
                    onClick={() =>
                      run(
                        () => request("removeChannel", { id: channel.id }),
                        "Channel removed. Open YouTube tabs have been updated.",
                      )
                    }
                  >
                    <TrashIcon size={18} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="mt-9 border-t border-line pt-7">
          <div className="flex items-baseline gap-3">
            <span className="eyebrow">03</span>
            <h2 className="text-lg font-medium tracking-tight">
              Turn down the noise
            </h2>
          </div>
          <div className="mt-2">
            {FILTERS.map(([key, label, description]) => (
              <Toggle
                key={key}
                label={label}
                description={description}
                checked={settings[key]}
                disabled={busy || settings.managed}
                onChange={(value) => {
                  setSettings({ ...settings, [key]: value });
                  run(
                    () => request("patchSettings", { patch: { [key]: value } }),
                    "Viewing rules saved.",
                  );
                }}
              />
            ))}
          </div>
        </section>
      </div>
      <aside className="lg:pt-12">
        <div className="sticky top-8 rounded-2xl bg-wash p-6">
          <div className="mb-8 flex items-center justify-between">
            <YoutubeLogoIcon size={28} weight="light" />
            <span className="eyebrow">Browser preview</span>
          </div>
          <h2 className="text-xl font-medium leading-tight tracking-tight">
            YouTube
          </h2>
          <ol className="my-6 space-y-4 text-xs leading-relaxed">
            <li className="flex gap-3">
              <CheckIcon size={16} className="shrink-0 text-leaf" />
              Extension connected
            </li>
            <li className="flex gap-3">
              <span className="w-4 shrink-0 text-center text-muted">
                {settings.channels.length ? "✓" : "2"}
              </span>
              {settings.channels.length
                ? `${settings.channels.length} ${settings.channels.length === 1 ? "channel" : "channels"} chosen`
                : "Add your first channel"}
            </li>
            <li className="flex gap-3">
              <span className="w-4 shrink-0 text-center text-muted">3</span>Open
              YouTube and try a video
            </li>
          </ol>
          <button
            className="primary w-full text-xs"
            onClick={() =>
              chrome.tabs.create({
                url: "https://www.youtube.com/feed/subscriptions",
              })
            }
          >
            Try it on YouTube <ArrowRightIcon size={16} />
          </button>
        </div>
        <p className="mt-5 text-xs leading-relaxed text-muted">
          This is an early browser prototype. Settings are editable, and the
          extension can be disabled or removed. Parent authentication comes
          later.
        </p>
      </aside>
    </div>
  );
}
function App() {
  const [settings, setSettings] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    request("getSettings")
      .then(setSettings)
      .catch((error) => setError(error.message));
    if (!popup && location.hash === "#library")
      location.replace("https://www.youtube.com/feed/subscriptions");
    const storage = () => {
      request("getSettings")
        .then(setSettings)
        .catch((error) => setError(error.message));
    };
    chrome.storage.onChanged.addListener(storage);
    return () => {
      chrome.storage.onChanged.removeListener(storage);
    };
  }, []);
  if (error)
    return (
      <main className="p-8">
        <Brand />
        <p role="alert" className="error mt-6">
          {error}
        </p>
        <button className="secondary mt-4" onClick={() => location.reload()}>
          Try again
        </button>
      </main>
    );
  if (!settings)
    return (
      <main className="p-8" role="status">
        Connecting to Quiet YouTube…
      </main>
    );
  if (popup) return <Popup settings={settings} />;
  return (
    <div className="mx-auto max-w-[1280px] px-5 sm:px-10 lg:px-16">
      <header className="flex flex-wrap items-center justify-between gap-6 border-b border-line py-7">
        <Brand />
        <nav
          className="flex gap-1 rounded-xl bg-[#eaeae2] p-1"
          aria-label="Main"
        >
          <a
            href="https://www.youtube.com/feed/subscriptions"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs text-muted"
          >
            <SquaresFourIcon size={16} />
            My videos
          </a>
          <a
            href="#settings"
            className="flex items-center gap-2 rounded-lg bg-paper px-4 py-2.5 text-xs font-medium"
          >
            <SlidersHorizontalIcon size={16} />
            Settings
          </a>
        </nav>
      </header>
      <main className="py-12 sm:py-16">
        <Settings settings={settings} setSettings={setSettings} />
      </main>
      <footer className="flex flex-wrap justify-between gap-3 border-t border-line py-6 text-[11px] text-muted">
        <span>Quiet YouTube · Browser prototype 0.2</span>
        <span>Settings stored on this device.</span>
      </footer>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);

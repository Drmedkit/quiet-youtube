# Quiet YouTube

Keep YouTube's own pages and player, with videos from parent-approved channels and fewer distractions. Built for Omarchy Kids, with an Omarchy menu and a CLI that agents can use after a parent grants access.

**Early prototype, version 0.3.0.** Chromium on Omarchy is the tested setup. This filters YouTube and protects the supported settings/removal controls; it is not a complete child-device lockdown. Read the [protection limits](docs/PARENT-CONTROLS.md#protection-limits) before relying on it.

## What it does

- Approve channels by YouTube URL or `@handle`; supported video pages and embeds stay blocked until the channel is verified.
- Keep the native Subscriptions feed, filtered to approved channels. Optionally keep YouTube Home.
- Hide and block Shorts, including Shorts from approved channels.
- Hide recommendations, comments, search, end screens, live chat and notifications, and disable autoplay.
- Manage everything from an Omarchy bar menu protected by a parent password.
- Stay unlocked for **15 minutes**, including dismissing and reopening the menu. **Close** locks the panel early.
- Give an agent a temporary CLI session without sharing the password.
- Force-install a signed extension through Linux browser policy, with the rules owned by a local system service.

Approvals and Google subscriptions are separate: subscribe normally in YouTube to populate Subscriptions, then approve the channels you want to allow. Approving a channel permits its future uploads too. Quiet YouTube does **not** block advertising or sponsorships, assess content suitability, or import your Google subscriptions.

## Install on Omarchy

Requires Omarchy's Quickshell plugin API, Chromium, Python 3.10+, OpenSSL, systemd and polkit. Node/npm and a Chrome Web Store account are not needed for installation.

```sh
omarchy plugin add https://github.com/Drmedkit/quiet-youtube.git --enable
```

1. Open the Quiet YouTube icon on the right of the bar.
2. Choose **Install parent controls** and authenticate as an administrator.
3. Set a parent password or PIN of at least six characters, then choose **Set password and enable**. Initial setup also requires administrator authentication.
4. Unlock the panel and add approved channels.
5. Restart Chromium once, sign into YouTube if you want the Subscriptions feed, and test an approved video, an unapproved video, and a Short.

**The managed installation affects every profile of the selected browser.** It also disables browser developer tools, extension developer mode, guest/incognito access, and adding profiles. Until channels are approved, no channels are allowed. Use a dedicated child computer or browser deployment where these restrictions are appropriate.

For an archive installation, download `quiet-youtube-omarchy.tar.gz` and its `.sha256` file from [Releases](https://github.com/Drmedkit/quiet-youtube/releases), then:

```sh
sha256sum -c quiet-youtube-omarchy.tar.gz.sha256
tar -xzf quiet-youtube-omarchy.tar.gz
cd quiet-youtube-omarchy
python packaging/install-user.py
```

The archive installer adds the same menu and a user CLI launcher. Continue with the panel steps above. Chrome and Brave installer options exist but have not yet had the same compatibility testing as Chromium.

See [parent controls](docs/PARENT-CONTROLS.md) for updates, password recovery, removal, migration from an unpacked extension, and the full policy behavior. Updating the Git plugin updates the menu and staged files; installing the system update still requires administrator authentication.

## Let an agent manage channels

Unlock the menu and choose **Allow agent / CLI access**, or run `quiet-youtube unlock` privately in a terminal. The grant expires by the original 15-minute deadline. An agent can then run:

```sh
quiet-youtube status --json
quiet-youtube channels add @kurzgesagt --json
quiet-youtube channels list --json
quiet-youtube settings set hideShorts true --json
quiet-youtube lock
```

The explicit CLI grant survives closing the panel until its deadline; `quiet-youtube lock` revokes it sooner. Never put the password in chat, command arguments or Git. Any process running as the same Linux user can use an active CLI grant.

[Agent instructions](docs/AGENT.md) · [CLI reference](docs/CLI.md)

## Try only the browser extension

For an editable demo, open `chrome://extensions` or `brave://extensions`, enable Developer mode, and **Load unpacked** → this repository's `browser-extension/` directory. Open Quiet YouTube's settings and add channels. This mode has no parent-password protection. It is separate from the managed installation, which disables Developer mode.

To rebuild from source:

```sh
npm ci
npm run build
```

Load `dist/extension/` after building. `dist/quiet-youtube.zip` is the browser-only archive. Reload the extension and open YouTube tabs after rebuilding. A separate Wayland demo browser is available with `npx playwright install chromium` followed by `npm run demo`; its local `.demo-profile/` is excluded from Git.

## How it works

The extension checks stable channel IDs against managed rules and filters supported native video cards, direct links and embeds. The Omarchy menu and CLI talk to a Unix socket service. That service authenticates parent sessions and writes Chromium policy. Password hashes and each device's extension signing key stay in root-owned local storage, outside this repository.

YouTube metadata and layouts are not stable APIs. Unverifiable videos may stay blocked, and unknown layouts may show cards that have not been filtered. Mobile-site coverage is preliminary. The page-context playback guard and whole-device restrictions need further hardening.

[Architecture](docs/ARCHITECTURE.md) · [Privacy](docs/PRIVACY.md) · [Security](SECURITY.md)

## Development and contributions

Use Node 24+, npm, Python 3.10+ and Linux. The Omarchy UI requires the installed shell; browser tests use an isolated Playwright Chromium.

```sh
npm ci
npx playwright install --with-deps chromium
npm test
npm run test:native
npm run build
npm run test:browser
npm run package:omarchy
```

`npm run test:policy` additionally requires Arch/Omarchy's `/usr/lib/chromium/chromium` and `bubblewrap`. It confines temporary policies to a mount namespace and never changes host browser policies. The optional live YouTube checks are described in [CONTRIBUTING.md](CONTRIBUTING.md).

The repository includes generated `browser-extension/` files so Omarchy can install directly from Git. Maintainers refresh them with `npm run release:prepare`; source changes belong in `src/` and `extension/`.

[Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [Roadmap](docs/ROADMAP.md) · [Release process](docs/RELEASING.md)

## License

MIT. See [LICENSE](LICENSE). Bundled fonts and libraries retain their own licenses; see [third-party notices](THIRD-PARTY-NOTICES.md).

An independent community experiment for Omarchy Kids. Not affiliated with or endorsed by YouTube, Google, Brave, or the Omarchy project.

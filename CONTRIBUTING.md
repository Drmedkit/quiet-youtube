# Contributing

Issues and pull requests are welcome. Describe the user-visible problem, the behavior you changed, and the checks you ran. For bypasses or vulnerabilities, follow [SECURITY.md](SECURITY.md).

## Development setup

Use Linux, Node 24+, npm, and Python 3.10+. Omarchy's panel also requires its Quickshell plugin API. The native executable expects Python at `/usr/bin/python`, as supplied by Arch/Omarchy; other Linux development systems may need their `python-is-python3` package.

```sh
git clone https://github.com/Drmedkit/quiet-youtube.git
cd quiet-youtube
npm ci
npx playwright install --with-deps chromium
npm test
npm run test:native
npm run build
npm run test:browser
```

Change the browser sources in `src/` and `extension/`, service/CLI in `native/`, panel in `omarchy/`, or installers in `packaging/`. `browser-extension/` is generated for direct Git installation. Regenerate it with `npm run release:prepare` when preparing a release; do not hand-edit bundled files. `dist/`, profiles, reports, secrets and keys must stay out of Git.

## Checks

| Command | Coverage |
| --- | --- |
| `npm test` | Settings normalization, metadata and URL parsing, managed precedence |
| `npm run test:native` | Parent authentication, expiry, UID binding, retries, persistence, socket/CLI behavior |
| `npm run build` | Browser bundles and browser-only ZIP |
| `npm run test:browser` | Isolated browser fixtures, feeds, SPA navigation, direct links, Shorts, embeds, playback and managed settings |
| `npm run test:policy` | Real signed extension and Chromium policies in a temporary mount namespace |
| `npm run package:omarchy` | Release archive and SHA-256 checksum |
| `omarchy plugin validate dist/omarchy-plugin` | Omarchy plugin manifest and entry point |

The policy test is currently specific to Arch/Omarchy, expects `/usr/bin/bwrap` and `/usr/lib/chromium/chromium`, and requires unprivileged namespaces. Do not replace it with a test that writes host policies. The ordinary CI job runs unit, native and browser-fixture checks; it does not test the real Omarchy panel or real browser policy.

Optional network-dependent checks: `npm run test:live` and `node scripts/shorts-live.mjs`. They contact real YouTube and can fail when public metadata changes or requests are restricted. Signed-in Subscriptions is tested with fixtures, not an automated real Google account. Reports/screenshots go under ignored `qa/`.

## Keep the parent boundary intact

- Treat managed settings as authoritative. Browser settings cannot override them.
- Keep password verification and authenticated mutations in the root-owned service.
- Preserve fixed 15-minute session expiry, explicit CLI grants and early revocation.
- Never log passwords/tokens or include real family settings, browser profiles, signing keys or viewing history in a change.
- Keep documentation honest about known playback and device-control limitations.

Use a separate test environment for managed installation. It changes browser-wide policy. Public bug reports should include versions, a minimal reproduction and sanitized output, not credentials or a child's personal information.

Contributions are provided under the project's MIT license. Third-party contributions must retain their required notices.

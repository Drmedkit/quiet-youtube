# Quiet YouTube

For operating an installed instance, follow `docs/AGENT.md`. Use the authenticated CLI for approvals and settings. Never ask for the parent password in chat or bypass its checks. Installation and password recovery require the parent's administrator authentication.

For development, the browser extension is under `src/` and `extension/`; the management service/CLI under `native/`; the Omarchy panel under `omarchy/`. Keep the root-owned service as the authority for password checks. Disabling or removing the menu must not relax browser rules.

Run the checks relevant to a change: `npm test`, `npm run test:browser`, `npm run test:native`, and `npm run test:policy`. The policy test uses an isolated mount namespace; never overwrite the developer's browser policies for automated testing. `npm run package:omarchy` builds the shareable release without passwords, signing keys, profiles, or build dependencies. Validate it with `omarchy plugin validate dist/omarchy-plugin`.

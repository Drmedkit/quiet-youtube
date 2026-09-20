# Releasing

The source repository also carries `browser-extension/` so `omarchy plugin add` works without npm. Runtime secrets and device signing keys are never release artifacts.

1. Update the version together in `package.json`, the root package entries of `package-lock.json`, `extension/manifest.json` and root `manifest.json`. Browser extension versions must increase for an update to apply. Update `CHANGELOG.md`.
2. Run `npm ci`, `npm test`, `npm run test:native`, `npm run build`, and `npm run test:browser`. On Arch/Omarchy also run `npm run test:policy` and manually exercise the panel.
3. Run `npm run release:prepare`. This refreshes committed `browser-extension/`, builds the Omarchy archive and checksum, and rebuilds the browser-only ZIP with licenses included.
4. Run `omarchy plugin validate dist/omarchy-plugin`. Inspect the staged source and archive. Exclude profiles, personal rules, tokens, password hashes, private keys, dependencies and test reports. Verify `sha256sum -c quiet-youtube-omarchy.tar.gz.sha256` from `dist/`.
5. Commit source, documentation and generated browser files together. Push the commit and a matching version tag, such as `v0.3.0`.
6. Create a GitHub release for that tag, marked prerelease while this remains a prototype. Attach `dist/quiet-youtube-omarchy.tar.gz`, its `.sha256`, and `dist/quiet-youtube.zip`. Describe the tested browser/platform and outstanding limitations. Do not upload the automatically generated GitHub source archive as though it were the curated Omarchy archive.
7. Verify anonymous download/clone access and the published checksum. Users must rerun the administrator system installer to update the installed root-owned service and signed extension; a plugin Git update alone cannot do that.

The CI workflow runs tests and uploads the built archives for review. Publication is an explicit maintainer action, not automatic on every push. Never distribute a pre-generated signing key: the installer creates one on each device and preserves it for that device's updates.

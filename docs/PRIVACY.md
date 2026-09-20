# Privacy

Quiet YouTube has no analytics service, custom account or remote management server. The project does not receive your approved-channel list, parent password, or viewing history.

## Stored on the computer

- The browser-only demo keeps settings in extension-local browser storage. Managed installations read policy supplied by the local service.
- The service stores approved channels/settings, a salted scrypt password hash, and guessing-limit state under `/var/lib/quiet-youtube/`, readable by root. Each installation also generates a private signing key there.
- Parent session tokens live in service memory. Explicit CLI grants are written to a private directory under the user's runtime directory and expire by the parent session deadline.
- The generated browser policy contains channel approvals and settings, not passwords. Local users can inspect these rules. Read-only CLI status is also available without the password.
- The extension uses bounded in-memory metadata caches. It does not create a separate persistent viewing-history database. The browser and YouTube retain their own normal history/account behavior.

## Network traffic

The extension requests public YouTube metadata for channels and videos. Those extra metadata requests omit browser cookies; the native service also resolves channels using public YouTube pages without browser cookies. YouTube can still observe the requests and the computer's IP address. Watching YouTube uses its normal network services and, when signed in, your Google account.

Installing/updating from GitHub contacts GitHub. Building from source also downloads npm packages and, for tests, Playwright browser binaries. The managed browser extension updates from a local `file:` manifest prepared by the administrator installer; there is no project-hosted extension update service.

## Sharing and removal

Configuration exports contain rules, not password hashes or session tokens. Rules can still reveal your family's channel choices; review them before sharing. Do not upload real state files, profiles, service tokens, signing keys or unsanitized screenshots to an issue.

Uninstalling the system component retains `/var/lib/quiet-youtube/` for recovery. An administrator can explicitly delete that directory when the stored settings and device signing identity are no longer wanted. The separate browser demo/profile has its own storage. See [removal instructions](PARENT-CONTROLS.md#update-recovery-removal).

# Agent workflow

Quiet YouTube is managed through `quiet-youtube`, not by changing extension storage, browser preferences, or the panel's files.

1. Run `quiet-youtube status --json` to inspect service availability, configured state, rules, and whether the expected policy has been written. This command does not prove that a browser has applied the policy.
2. On a new computer, install the release's Omarchy menu with `python packaging/install-user.py`. The parent installs the system component and sets the password locally in the panel. Explain that managed policies affect every profile of the selected browser on that machine.
3. For changes, have the parent unlock the panel and use **Allow agent / CLI access**, or privately run `quiet-youtube unlock` in a terminal. Never request their password in chat, invent a password, reset it, or bypass authentication to finish an agent task.
4. Use bounded commands: `quiet-youtube channels add @handle --json`, `channels remove CHANNEL_ID --json`, or `settings set KEY VALUE --json`. Do not invoke `protection off` unless the parent requested pausing protection.
5. Read back with `quiet-youtube status --json`; report the actual changes. On completion run `quiet-youtube lock` to revoke the CLI grant.

Known setting keys: `hideShorts`, `hideComments`, `hideRecommendations`, `hideSearch`, `hideEndScreens`, `hideLiveChat`, `hideNotifications`, `disableAutoplay` (boolean `true`/`false`), and `homeFeed` (`subscriptions`/`home`). Approved-channel mode is enforced while protection is enabled. Commands are idempotent where practical; adding a channel twice does not duplicate it.

A `locked` response means authenticate through the parent flow. A `rate_limited` response means wait for its stated retry interval; do not repeatedly guess. `unavailable` means inspect the installed service. A parent can recover a forgotten password using administrator authentication, but recovery is a separate explicit operation.

Dependencies on receiving computers: Python 3.10+, OpenSSL, systemd, polkit, Omarchy's Quickshell plugin API and Chromium. Use the release archive so installing does not require Node/npm. Browser options for Chrome and Brave exist but require validation on the target machine. The release is a prototype with the limits documented in PARENT-CONTROLS.md.

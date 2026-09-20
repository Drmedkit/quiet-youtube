# Security

Quiet YouTube 0.3.x is an early prototype. Only the latest release is maintained; there is no promised response or patch timeline.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/Drmedkit/quiet-youtube/security/advisories/new) for password/service bypasses, privilege escalation or unintended access to private data. Include the version, affected component, a minimal reproduction using test data, and the expected/actual result. Do not send real passwords, tokens, signing keys or child browsing data.

Use ordinary [issues](https://github.com/Drmedkit/quiet-youtube/issues) for general bugs without sensitive information. If private reporting is unavailable, open an issue asking for a private contact without publishing the exploit or secrets.

## Current protection boundary

The root-owned service checks the parent password, limits guesses, binds expiring sessions to the local user's UID, and owns managed browser settings. The browser policy force-installs the extension and restricts normal removal/developer/guest/incognito paths. Removing the bar menu does not remove that policy.

This is not a hardened child operating system. Administrators, alternate browsers/operating systems, modified software and an unrestricted desktop can bypass the intended controls. The user-writable Omarchy panel is not a trusted password-entry surface against a determined attacker in the same account. Other processes under that account can use a deliberately granted CLI session. Arbitrary page JavaScript can bypass the page-context media guard. YouTube layout changes can expose unfiltered cards, and public metadata can become unavailable.

These limitations are documented, not a claim that the product is tamper-proof. See [parent controls](docs/PARENT-CONTROLS.md#protection-limits) and the [roadmap](docs/ROADMAP.md).

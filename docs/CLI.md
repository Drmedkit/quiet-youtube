# CLI reference

The managed system installer installs `quiet-youtube` on PATH. The archive user installer also creates a user launcher. Before system installation, the repository's `native/quiet-youtube` can show help but no protected service is available.

Use `--json` with commands for `{ "ok": true, "data": ... }` responses. Failures use `{ "ok": false, "error": { "code": "...", "message": "..." } }` and a nonzero exit status. `--socket PATH` is a development transport option and must precede the command.

| Command | Parent session | Purpose |
| --- | --- | --- |
| `status` | No | Current rules, deployment and on-disk policy status |
| `channels list` | No | Approved channels |
| `settings get` | No | Current settings |
| `config export [FILE]` | No | Rules only; omit FILE or use `-` for stdout |
| `unlock` | Password prompt | Create a 15-minute CLI session |
| `lock` | No | Revoke the current CLI grant and delete its local token file |
| `channels add @handle` | Yes | Resolve and approve a channel; YouTube URL or stable ID also accepted |
| `channels remove CHANNEL_ID` | Yes | Remove approval |
| `settings set KEY VALUE` | Yes | Change a setting |
| `config import FILE` | Yes | Replace rules; use `-` for stdin |
| `protection on` / `protection off` | Yes | Enable or pause filtering; managed installation remains |
| `password` | Yes | Set a new parent password and revoke sessions |
| `setup` | Administrator | First-time setup only |
| `password --reset` | Administrator | Explicit recovery without the old password |

Boolean settings accept `true` or `false`: `hideShorts`, `hideComments`, `hideRecommendations`, `hideSearch`, `hideEndScreens`, `hideLiveChat`, `hideNotifications`, `disableAutoplay`. `homeFeed` accepts `subscriptions` or `home`. Up to 50 channels can be approved.

```sh
quiet-youtube unlock
quiet-youtube channels add https://www.youtube.com/@kurzgesagt --json
quiet-youtube settings set homeFeed subscriptions --json
quiet-youtube config export rules.json
quiet-youtube lock
```

For a round-trip configuration file, export without `--json`: `--json` wraps the rules in the response envelope, whereas import expects the settings object itself. File exports contain the settings object in either mode.

The `status` response's `policyWritten` field checks the file on disk, not whether Chromium has applied it. Verify actual browser behavior on new installations. A `locked` response requires the parent unlock flow; `rate_limited` means respect the wait; `unavailable` means check the service with `systemctl status quiet-youtube.service`.

Password commands accept `--password-stdin` for a trusted local secret source. Never pass a password as a command argument, environment variable or chat message. `rpc` and `serve` are internal panel/development interfaces; normal agent work should use the commands above. See [agent instructions](AGENT.md).

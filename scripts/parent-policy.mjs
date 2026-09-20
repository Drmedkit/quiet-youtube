import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { normalizeSettings, CHANNEL_ID } from "../src/core.js";

const { values } = parseArgs({
  options: {
    "extension-id": { type: "string" },
    settings: { type: "string" },
    "update-url": { type: "string" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  console.log(
    "Usage: node scripts/parent-policy.mjs --extension-id ID --settings FILE --update-url HTTPS_URL\n\nPrints reviewable Linux browser policy JSON to stdout. Does not install anything.\nFILE must contain a settings object with an explicit channels array. ID and URL must\nrefer to the signed, self-hosted extension release, not the local unpacked demo.",
  );
} else {
  try {
    const id = values["extension-id"];
    if (!/^[a-p]{32}$/.test(id || ""))
      throw new Error("Provide the signed extension's 32-character ID.");
    if (!values.settings) throw new Error("Provide a settings JSON file.");
    const url = new URL(values["update-url"]);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error(
        "The update manifest must use HTTPS without URL credentials.",
      );
    const input = JSON.parse(await readFile(values.settings, "utf8"));
    if (
      !Array.isArray(input.channels) ||
      input.channels.some((channel) => !CHANNEL_ID.test(channel?.id))
    )
      throw new Error(
        "Settings must include an explicit channels array of valid YouTube channel IDs.",
      );
    const settings = normalizeSettings({ ...input, mode: "approved" });
    delete settings.mode;
    console.log(
      JSON.stringify(
        {
          ExtensionSettings: {
            "*": { installation_mode: "blocked" },
            [id]: {
              installation_mode: "force_installed",
              update_url: url.href,
              override_update_url: true,
            },
          },
          ExtensionDeveloperModeSettings: 1,
          DeveloperToolsAvailability: 2,
          BrowserGuestModeEnabled: false,
          BrowserAddPersonEnabled: false,
          IncognitoModeAvailability: 1,
          "3rdparty": { extensions: { [id]: { ParentSettings: settings } } },
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

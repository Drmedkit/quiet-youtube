// Real Chromium policies, confined to a mount namespace. Never writes host /etc.
import { chromium, expect } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  chmod,
} from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
const dir = await mkdtemp(path.join(tmpdir(), "quiet-policy-browser-"));
let context, browser, process;
try {
  await mkdir(path.join(dir, "etc/policies/managed"), { recursive: true });
  await mkdir(path.join(dir, "share/quiet-youtube"), { recursive: true });
  const result = JSON.parse(
    execFileSync(
      "python",
      [
        "-c",
        `
import json,sys,subprocess,os
from pathlib import Path
sys.path.insert(0,'packaging');sys.path.insert(0,'native')
from crx import pack
from quiet_youtube.service import browser_policy,DEFAULTS
root=Path(sys.argv[1]);key=root/'key.pem'
subprocess.run(['openssl','genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:2048','-out',str(key)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
os.chmod(key,0o600)
eid,version=pack(Path('dist/extension'),root/'share/quiet-youtube/extension.crx',key)
(root/'share/quiet-youtube/updates.xml').write_text(f'<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0"><app appid="{eid}"><updatecheck codebase="file:///usr/local/share/quiet-youtube/extension.crx" version="{version}" /></app></gupdate>')
installation=dict(extensionId=eid,updateUrl='file:///usr/local/share/quiet-youtube/updates.xml')
policy=browser_policy(DEFAULTS,True,installation)
# Keep CDP enabled only inside this test namespace so assertions can inspect the browser.
policy.pop('DeveloperToolsAvailability')
(root/'etc/policies/managed/quiet-youtube.json').write_text(json.dumps(policy))
print(json.dumps(dict(id=eid,version=version)))
`,
        dir,
      ],
      { encoding: "utf8" },
    ),
  );
  const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
  const wrapper = path.join(dir, "chromium");
  await writeFile(
    wrapper,
    `#!/bin/sh\nexec /usr/bin/bwrap --ro-bind / / --bind /tmp /tmp --bind ${quote(path.join(dir, "etc"))} /etc/chromium --bind ${quote(path.join(dir, "share"))} /usr/local/share --dev-bind /dev /dev --proc /proc --unshare-pid --die-with-parent /usr/lib/chromium/chromium "$@"\n`,
  );
  await chmod(wrapper, 0o755);
  const profile = path.join(dir, "profile");
  process = spawn(
    wrapper,
    [
      "--headless",
      "--no-sandbox",
      "--no-first-run",
      "--disable-gpu",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      port = (
        await readFile(path.join(profile, "DevToolsActivePort"), "utf8")
      ).split("\n")[0];
      break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!port)
    throw new Error("Isolated Chromium did not open its test debugging port.");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  context = browser.contexts()[0];
  console.log("Isolated Chromium launched.");
  const page = await context.newPage();
  await page.goto("chrome://extensions");
  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          const all = await chrome.developerPrivate.getExtensionsInfo({
            includeDisabled: true,
          });
          return all.find((e) => e.id === id)?.state;
        }, result.id),
      { timeout: 20000 },
    )
    .toBe("ENABLED");
  const info = await page.evaluate(async (id) => {
    const all = await chrome.developerPrivate.getExtensionsInfo({
      includeDisabled: true,
    });
    const extension = all.find((e) => e.id === id);
    return {
      state: extension.state,
      mayDisable: extension.userMayModify,
      name: extension.name,
      mustRemainInstalled: extension.mustRemainInstalled,
    };
  }, result.id);
  await page.goto(`chrome-extension://${result.id}/index.html`);
  await expect(page.getByText(/Managed by a parent/)).toBeVisible();
  await expect(
    page.getByLabel("YouTube channel link or @handle"),
  ).toBeDisabled();
  const managed = await page.evaluate(() =>
    chrome.storage.managed.get("ParentSettings"),
  );
  if (managed.ParentSettings.enabled !== true)
    throw new Error("Managed policy not read by extension");
  const policyPath = path.join(dir, "etc/policies/managed/quiet-youtube.json");
  const policy = JSON.parse(await readFile(policyPath, "utf8"));
  policy["3rdparty"].extensions[result.id].ParentSettings.enabled = false;
  await writeFile(policyPath, JSON.stringify(policy));
  await expect
    .poll(
      () =>
        page.evaluate(
          async () =>
            (await chrome.storage.managed.get("ParentSettings")).ParentSettings
              .enabled,
        ),
      { timeout: 20000 },
    )
    .toBe(false);
  await expect(page.getByText(/Protection is paused/)).toBeVisible();
  const mutation = await page.evaluate(() =>
    chrome.runtime.sendMessage({
      type: "patchSettings",
      patch: { hideShorts: false },
    }),
  );
  if (mutation.ok) throw new Error("Browser UI could override managed policy");
  console.log(
    "Live policy changes reached the extension; browser mutations remained blocked.",
  );
  if (info.mayDisable !== false)
    throw new Error(
      "Force-installed extension was modifiable: " + JSON.stringify(info),
    );
  console.log(
    JSON.stringify({
      signedCrxInstalled: true,
      managedPolicyRead: true,
      settingsLocked: true,
      extension: info,
      ...result,
    }),
  );
  const session = await browser.newBrowserCDPSession();
  await session.send("Browser.close").catch(() => {});
  await browser.close();
  context = null;
  browser = null;
  if (process.exitCode === null)
    await new Promise((resolve) => process.once("exit", resolve));
  process = null;
  const prefs = JSON.parse(
    await readFile(path.join(dir, "profile/Default/Preferences"), "utf8"),
  );
  const ext = prefs.extensions.settings[result.id];
  if (!ext) throw new Error("Extension missing from persisted profile");
  console.log(JSON.stringify({ persisted: true, location: ext.location }));
} finally {
  await browser?.close();
  if (process) {
    process.kill("SIGTERM");
    await new Promise((resolve) => process.once("exit", resolve));
  }
  await rm(dir, { recursive: true, force: true });
}

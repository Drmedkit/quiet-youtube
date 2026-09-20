import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const output = "dist/extension";
await mkdir(output, { recursive: true });
await cp("extension", output, { recursive: true });
for (const name of ["LICENSE", "THIRD-PARTY-NOTICES.md", "licenses"])
  await cp(name, `${output}/${name}`, { recursive: true });
for (const entry of ["background", "content", "guard"])
  await build({
    entryPoints: [`src/${entry}.js`],
    outfile: `${output}/${entry}.js`,
    bundle: true,
    format: entry === "background" ? "esm" : "iife",
    target: "chrome120",
  });
execFileSync("python3", [
  "-c",
  'import shutil; shutil.make_archive("dist/quiet-youtube", "zip", "dist/extension")',
]);
console.log(
  "Load dist/extension into your browser. Archive: dist/quiet-youtube.zip",
);

/**
 * Package dist/ into cinema-extension.zip and copy to apps/web/public/.
 * Uses Python's zipfile module (always available) instead of the `zip` CLI.
 */

import { spawnSync } from "child_process";
import { mkdirSync, copyFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");
const outZip = resolve(root, "cinema-extension.zip");
const webPublic = resolve(root, "../../apps/web/public");

const pythonScript = `
import zipfile, os, sys
dist, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as zf:
    for dirpath, _, files in os.walk(dist):
        for f in files:
            full = os.path.join(dirpath, f)
            zf.write(full, os.path.relpath(full, dist))
print('zip OK:', out)
`;

// Args passed separately — no shell interpolation, safe even with spaces in paths
const result = spawnSync("python3", ["-c", pythonScript, dist, outZip], {
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

mkdirSync(webPublic, { recursive: true });
copyFileSync(outZip, resolve(webPublic, "cinema-extension.zip"));
process.stdout.write("✅ Copied to apps/web/public/cinema-extension.zip\n");

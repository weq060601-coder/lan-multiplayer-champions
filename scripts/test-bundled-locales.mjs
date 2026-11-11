/** Check bundled translations without starting the game or downloading submodules. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const locales = join(root, "locales");
const checkDist = process.argv.includes("--dist");
const readJson = path => JSON.parse(readFileSync(path, "utf8"));

assert(!/\[submodule "locales"\]/.test(readFileSync(join(root, ".gitmodules"), "utf8")));
assert(!existsSync(join(locales, ".git")), "locales still has nested Git metadata");
assert(existsSync(join(locales, "LICENSE")), "Original translation license is missing");
if (existsSync(join(root, ".git"))) {
  const entries = execFileSync("git", ["ls-files", "--stage", "--", "locales"], {
    cwd: root,
    encoding: "utf8",
  });
  assert(!/^160000 /m.test(entries), "locales is still tracked as a gitlink");
  assert(entries.includes("\tlocales/zh-Hans/move.json"), "Chinese translations are not tracked by the main repo");
  assert(entries.includes("\tlocales/en/move.json"), "English fallback is not tracked by the main repo");
}

const languages = readdirSync(locales, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && /^[a-z]{2}(?:-[A-Za-z0-9]+)?$/.test(entry.name))
  .map(entry => entry.name);
assert(languages.includes("en") && languages.includes("zh-Hans"));
let jsonCount = 0;
function checkDirectory(path, relative) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const nextRelative = join(relative, entry.name);
    const nextPath = join(path, entry.name);
    if (entry.isDirectory()) {
      checkDirectory(nextPath, nextRelative);
    } else if (entry.name.endsWith(".json")) {
      const source = readJson(nextPath);
      if (checkDist) {
        assert.deepEqual(readJson(join(root, "dist", "locales", nextRelative)), source, nextRelative);
      }
      jsonCount++;
    }
  }
}
for (const language of languages) {
  checkDirectory(join(locales, language), language);
}

const moves = readJson(join(locales, "zh-Hans", "move.json"));
assert.equal(Object.keys(moves).length, 953, "Expected the existing 953 Chinese moves");
assert.equal(Object.values(moves).filter(move => typeof move.effect === "string" && move.effect.trim()).length, 953);
console.log(
  `Bundled locales OK: ${languages.length} languages, ${jsonCount} valid JSON files, 953 Chinese move descriptions.`,
);
if (checkDist) {
  console.log("Built translations match source JSON for every language.");
}

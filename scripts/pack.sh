#!/usr/bin/env bash
# Builds dist/pr-sidebar-v<version>.zip with only the files Chrome needs.
# Used by .github/workflows/pack.yml; also runnable locally.
# stdout is only key=value lines (GitHub step outputs); logs go to stderr.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/pr-sidebar-v${VERSION}.zip"
FILES=(manifest.json background.js github.js sidepanel.html sidepanel.css sidepanel.js options.html options.js icons/*.png)

# Syntax-check the scripts (they're ES modules).
tmp=$(mktemp -d)
for f in *.js; do cp "$f" "$tmp/${f%.js}.mjs"; node --check "$tmp/${f%.js}.mjs"; done
rm -rf "$tmp"

# Every file the manifest and pages point at must be in the package.
node -e '
const fs = require("fs");
const m = require("./manifest.json");
const refs = new Set([
  m.background.service_worker, m.side_panel.default_path, m.options_page,
  ...Object.values(m.icons), ...Object.values(m.action.default_icon || {}),
]);
for (const page of ["sidepanel.html", "options.html"]) {
  for (const [, ref] of fs.readFileSync(page, "utf8").matchAll(/(?:src|href)="([^"#:]+)"/g)) refs.add(ref);
}
const missing = [...refs].filter((f) => !fs.existsSync(f));
if (missing.length) { console.error("Missing files:", missing.join(", ")); process.exit(1); }
console.error(`Manifest OK: ${refs.size} referenced files present`);
'

rm -rf dist && mkdir -p dist
zip -q -X -r "$OUT" "${FILES[@]}"
echo "version=${VERSION}"
echo "zip=${OUT}"

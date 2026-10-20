// Cloudflare Pages build: copy the publishable site into dist/.
// Build command: node scripts/build-site.mjs   Output directory: dist
// Mirrors the _config.yml exclude list GitHub Pages uses, but by rule rather
// than by name, so a new internal doc or script is kept off the site by default.
import { cpSync, rmSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "dist");

const SKIP_DIRS = new Set(["dist", "supabase", "scripts", "node_modules", "private", "old-site-archive"]);
const SKIP_FILES = new Set(["CNAME", "_config.yml"]);
const SKIP_EXT = [".md", ".mjs", ".ts"];

function publishable(path) {
  const rel = relative(ROOT, path);
  if (!rel) return true;
  const parts = rel.split(sep);
  const name = parts[parts.length - 1];
  // dotfiles/dirs (.git, .gitignore, .claude, .DS_Store) never ship;
  // _headers/_redirects are Cloudflare config and must
  if (parts.some((p) => p.startsWith("."))) return false;
  if (SKIP_DIRS.has(parts[0])) return false;
  if (statSync(path).isDirectory()) return true;
  if (SKIP_FILES.has(name)) return false;
  return !SKIP_EXT.some((ext) => name.endsWith(ext));
}

rmSync(OUT, { recursive: true, force: true });
for (const entry of readdirSync(ROOT)) {
  const src = join(ROOT, entry);
  if (publishable(src)) cpSync(src, join(OUT, entry), { recursive: true, filter: publishable });
}
console.log("site built to dist/");

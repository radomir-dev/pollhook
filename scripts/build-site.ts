import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

const TEXT_FILES = new Set([".html", ".css", ".js", ".txt", ".svg", ".xml"]);

export interface SiteContext {
  version: string;
  repoUrl: string;
  releaseUrl: string;
  canonicalUrl: string;
}

export function siteContext(pkg: {
  name: string;
  version: string;
  repository: { url: string };
}): SiteContext {
  const repoUrl = pkg.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");
  return {
    version: pkg.version,
    repoUrl,
    releaseUrl: `${repoUrl}/releases/tag/v${pkg.version}`,
    canonicalUrl: `https://radomir.dev/${pkg.name}/`,
  };
}

export function render(content: string, context: SiteContext): string {
  return content
    .replaceAll("__VERSION__", context.version)
    .replaceAll("__REPO_URL__", context.repoUrl)
    .replaceAll("__RELEASE_URL__", context.releaseUrl)
    .replaceAll("__CANONICAL_URL__", context.canonicalUrl);
}

function renderTree(dir: string, context: SiteContext): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) renderTree(path, context);
    else if (TEXT_FILES.has(extname(entry.name))) {
      writeFileSync(path, render(readFileSync(path, "utf8"), context));
    }
  }
}

export function sitemap(context: SiteContext, today: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `  <url><loc>${context.canonicalUrl}</loc><lastmod>${today}</lastmod></url>`,
    "</urlset>",
    "",
  ].join("\n");
}

export function buildSite(
  root: string,
  out: string,
  today = new Date().toISOString().slice(0, 10),
): SiteContext {
  const context = siteContext(JSON.parse(readFileSync(join(root, "package.json"), "utf8")));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(join(root, "site"), out, { recursive: true });
  renderTree(out, context);
  writeFileSync(join(out, "sitemap.xml"), sitemap(context, today));
  const robots = readFileSync(join(out, "robots.txt"), "utf8").trimEnd();
  writeFileSync(
    join(out, "robots.txt"),
    `${robots}\nSitemap: ${context.canonicalUrl}sitemap.xml\n`,
  );
  return context;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = join(import.meta.dirname, "..");
  const context = buildSite(root, join(root, "dist-site"));
  process.stdout.write(`built the site for ${context.canonicalUrl} (v${context.version})\n`);
}

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "vitest";
import { buildSite, render, siteContext } from "../scripts/build-site.ts";
import { tempStateDir } from "./helpers.ts";

const root = join(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const out = join(tempStateDir(), "site");
const context = buildSite(root, out, "2026-11-26");
const html = readFileSync(join(out, "index.html"), "utf8");

function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesIn(path) : [path];
  });
}

describe("the built site", () => {
  test("every placeholder is replaced", () => {
    for (const file of filesIn(out).filter((path) => /\.(html|css|js|txt|svg|xml)$/.test(path))) {
      assert.doesNotMatch(readFileSync(file, "utf8"), /__[A-Z_]+__/, file);
    }
  });

  test("the version watermark links to the release tag of the package version", () => {
    assert.equal(context.version, pkg.version);
    assert.ok(html.includes(`v${pkg.version}`));
    assert.ok(
      html.includes(`https://github.com/radomir-dev/pollhook/releases/tag/v${pkg.version}`),
    );
    assert.ok(html.includes("author: radomir.dev"));
  });

  test("the canonical url, sitemap and robots agree", () => {
    assert.ok(html.includes(`<link rel="canonical" href="https://radomir.dev/pollhook/">`));
    assert.match(
      readFileSync(join(out, "sitemap.xml"), "utf8"),
      /<loc>https:\/\/radomir\.dev\/pollhook\/<\/loc><lastmod>2026-11-26<\/lastmod>/,
    );
    assert.match(
      readFileSync(join(out, "robots.txt"), "utf8"),
      /Sitemap: https:\/\/radomir\.dev\/pollhook\/sitemap\.xml/,
    );
  });

  test("the metadata that search engines read is present and within limits", () => {
    const title = /<title>([^<]+)<\/title>/.exec(html)![1]!;
    const description = /<meta name="description" content="([^"]+)"/.exec(html)![1]!;
    assert.ok(title.length <= 60, `title is ${title.length} characters`);
    assert.ok(description.length <= 160, `description is ${description.length} characters`);
    assert.ok(html.includes('<meta name="keywords"'));
    assert.ok(html.includes('property="og:image" content="https://radomir.dev/pollhook/og.png"'));
    assert.ok(html.includes('name="twitter:card" content="summary_large_image"'));
    assert.equal(html.match(/<h1[ >]/g)?.length, 1, "exactly one h1");
  });

  test("the structured data is valid JSON and names the right version and platforms", () => {
    const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1]!;
    const data = JSON.parse(json);
    assert.equal(data["@type"], "SoftwareApplication");
    assert.equal(data.softwareVersion, pkg.version);
    assert.doesNotMatch(data.operatingSystem, /Windows/);
  });

  test("every local asset the page references exists in the output", () => {
    const local = [...html.matchAll(/(?:href|src)="([^"#:]+?)"/g)].map((match) => match[1]!);
    for (const asset of local.filter((url) => !url.startsWith("/") && !url.startsWith("http"))) {
      assert.ok(existsSync(join(out, asset)), `${asset} is referenced but missing`);
    }
  });

  test("the copy never implies the project costs money", () => {
    assert.doesNotMatch(html, /\b(budget|billable)\b/i);
  });
});

test("render fills each placeholder everywhere it appears", () => {
  const filled = render("__VERSION__ __VERSION__ __REPO_URL__ __RELEASE_URL__ __CANONICAL_URL__", {
    version: "1.2.3",
    repoUrl: "https://github.com/o/r",
    releaseUrl: "https://github.com/o/r/releases/tag/v1.2.3",
    canonicalUrl: "https://radomir.dev/r/",
  });

  assert.equal(
    filled,
    "1.2.3 1.2.3 https://github.com/o/r https://github.com/o/r/releases/tag/v1.2.3 https://radomir.dev/r/",
  );
});

test("the repository url is derived from package.json without git prefixes", () => {
  const derived = siteContext({
    name: "tool",
    version: "0.1.0",
    repository: { url: "git+https://github.com/o/tool.git" },
  });

  assert.equal(derived.repoUrl, "https://github.com/o/tool");
  assert.equal(derived.canonicalUrl, "https://radomir.dev/tool/");
});

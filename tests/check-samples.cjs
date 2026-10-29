#!/usr/bin/env node
// Runs the sample receivers published in samples/*.mdx against RankHouse's real
// request-signing code (server/controllers/integrations/custom), so every
// sample on the site is known to work with what RankHouse actually sends.
//
// The code is pulled out of the .mdx pages themselves: the block whose info
// string is "javascript server.js", "python main.py" or "php index.php".
//
// Usage, from the root of this repo:
//   RANKHOUSE_SERVER="../Rank House/server" node tests/check-samples.cjs [node] [python] [php]
//
// Needs the RankHouse server folder with its node_modules (for the adapter and
// Express), Python with fastapi + uvicorn, and PHP. Set PYTHON or PHP to point
// at a specific binary. A runtime that is missing is reported as skipped.

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const DOCS_ROOT = path.resolve(__dirname, "..");
const SERVER = path.resolve(process.env.RANKHOUSE_SERVER || path.join(DOCS_ROOT, "..", "Rank House", "server"));

// Loading the adapter loads the server's shared services, which print their
// config and retry Redis in the background. None of that matters here.
const quiet = (write) => (...args) => {
  if (!/^\[initRedis\]/.test(String(args[0]))) write(...args);
};
console.error = quiet(console.error.bind(console));
console.warn = quiet(console.warn.bind(console));
const log = console.log.bind(console);
console.log = () => {};
const custom = require(path.join(SERVER, "controllers", "integrations", "custom"));
console.log = log;

const API_KEY = crypto.randomBytes(32).toString("hex");
const PYTHON = process.env.PYTHON || "python";
const PHP = process.env.PHP || "php";

const SAMPLES = {
  node: {
    page: "samples/node.mdx",
    block: "javascript server.js",
    file: "server.js",
    port: 4100,
    available: () => true,
    command: () => [process.execPath, ["server.js"]],
    env: { NODE_PATH: path.join(SERVER, "node_modules") },
  },
  python: {
    page: "samples/python.mdx",
    block: "python main.py",
    file: "main.py",
    port: 4101,
    available: () => spawnSync(PYTHON, ["-c", "import fastapi, uvicorn"]).status === 0,
    command: (port) => [PYTHON, ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(port), "--log-level", "warning"]],
    env: {},
  },
  php: {
    page: "samples/php.mdx",
    block: "php index.php",
    file: "index.php",
    port: 4102,
    available: () => spawnSync(PHP, ["-v"]).status === 0,
    command: (port) => [PHP, ["-S", `127.0.0.1:${port}`, "index.php"]],
    env: {},
  },
};

function extractBlock(page, info) {
  const text = fs.readFileSync(path.join(DOCS_ROOT, page), "utf8").replace(/\r\n/g, "\n");
  const start = text.indexOf("```" + info + "\n");
  assert(start !== -1, `${page} has no \`\`\`${info} block`);
  const from = start + info.length + 4;
  const end = text.indexOf("\n```", from);
  return text.slice(from, end) + "\n";
}

const hmac = (message, key = API_KEY) => crypto.createHmac("sha256", key).update(message).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntilListening(base, child) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`exited with code ${child.exitCode}`);
    try {
      await fetch(`${base}/pages`);
      return;
    } catch {
      await sleep(200);
    }
  }
  throw new Error("did not start listening within 20 seconds");
}

async function rawSigned(base, { path: p, method, body, timestamp, signWith }) {
  const ts = String(timestamp ?? Date.now());
  return fetch(`${base}${p}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": API_KEY,
      "X-RankHouse-Timestamp": ts,
      "X-RankHouse-Signature": hmac(`${ts}.${signWith ?? body ?? ""}`),
    },
    body,
  });
}

async function runChecks(base, siteUrl) {
  const results = [];
  const check = async (label, fn) => {
    try {
      await fn();
      results.push({ label, ok: true });
    } catch (error) {
      results.push({ label, ok: false, error: error.message });
    }
  };

  const integration = { rest_api: base, api_key: API_KEY, capabilities: [] };
  const sourceId = "6720f1c2a4b5c6d7e8f90123";
  const slug = "ten-trail-shoes-tested";
  const post = custom.buildCustomPostBody({
    title: "Ten trail shoes tested",
    content: "<p>We ran 400 km in ten pairs.</p>",
    excerpt: "Our picks after 400 km.",
    status: "publish",
    categories: "News, Guides",
    tags: ["trail shoes", "running"],
    author: "Jane Doe",
    featured_image: "https://example.com/hero.png",
    seo: { title: "Ten trail shoes tested", description: "Our picks.", keywords: "trail shoes, running" },
    source_id: sourceId,
    date: "2026-10-29 10:00:00",
    reading_time: "1 minute",
    language: "en",
  });
  let postId = null;

  await check("handshake: signs the challenge and declares the required capabilities", async () => {
    const challenge = crypto.randomBytes(32).toString("hex");
    const r = await custom.callCustom({ integration, path: "/handshake", method: "POST", body: { challenge } });
    assert(r.ok, `HTTP ${r.status} ${JSON.stringify(r.data)}`);
    assert.strictEqual(r.data.challenge_response, hmac(challenge));
    for (const c of custom.REQUIRED_CAPABILITIES) assert(r.data.capabilities.includes(c), `missing ${c}`);
    const known = [...custom.REQUIRED_CAPABILITIES, ...custom.OPTIONAL_CAPABILITIES];
    for (const c of r.data.capabilities) assert(known.includes(c), `unknown capability ${c}`);
    integration.capabilities = r.data.capabilities;
  });

  await check("POST /posts: answers with an id", async () => {
    const r = await custom.customCreatePost({ integration, body: post });
    assert(r.ok && r.external_id, `HTTP ${r.status} ${JSON.stringify(r.data)}`);
    postId = r.external_id;
  });

  await check("POST /posts: the same source_id again updates the first copy", async () => {
    const r = await custom.customCreatePost({ integration, body: { ...post, title: "Ten trail shoes tested (v2)" } });
    assert(r.ok, `HTTP ${r.status}`);
    assert.strictEqual(r.external_id, postId);
  });

  await check("PUT /posts/{id}: changes only the fields sent", async () => {
    const r = await custom.customUpdatePost({ integration, id: postId, body: { content: "<p>New body</p>", source_id: sourceId } });
    assert(r.ok, `HTTP ${r.status} ${JSON.stringify(r.data)}`);
    const pages = await custom.customGetPages({ integration });
    const page = pages.data.find((p) => p.id === postId);
    assert(page, "post missing from GET /pages");
    assert.strictEqual(page.title, "Ten trail shoes tested (v2)");
  });

  await check("PUT /posts/{id}: 404 with an error for an unknown id", async () => {
    const r = await custom.customUpdatePost({ integration, id: "does-not-exist", body: { content: "<p>x</p>" } });
    assert.strictEqual(r.status, 404);
    assert(r.data && r.data.error, "no error field");
  });

  await check("GET /pages: published posts with id, url, slug, title and type", async () => {
    const r = await custom.customGetPages({ integration });
    assert(r.ok, `HTTP ${r.status}`);
    const page = r.data.find((p) => p.id === postId);
    assert(page, "post missing");
    assert.strictEqual(page.slug, slug);
    assert.strictEqual(page.url, `${siteUrl}/blog/${slug}`);
    assert.strictEqual(page.type, "post");
  });

  await check("GET /pages: drafts are not listed", async () => {
    const draft = custom.buildCustomPostBody({ title: "Draft only", content: "<p>x</p>", status: "draft", source_id: "draft-1" });
    const created = await custom.customCreatePost({ integration, body: draft });
    assert(created.ok, `HTTP ${created.status}`);
    const r = await custom.customGetPages({ integration });
    assert(!r.data.some((p) => p.id === created.external_id), "draft is listed");
  });

  const seo = { title: "Ten trail shoes, tested", description: "What held up after 400 km." };
  await check("PUT /seo: finds the page by slug", async () => {
    const r = await custom.customUpdateSeo({ integration, slug, seo });
    assert(r.ok, `HTTP ${r.status} ${JSON.stringify(r.data)}`);
    assert.strictEqual(r.external_id, postId);
  });
  await check("PUT /seo: finds the page by URL", async () => {
    const r = await custom.customUpdateSeo({ integration, url: `${siteUrl}/blog/${slug}`, seo });
    assert(r.ok, `HTTP ${r.status}`);
    assert.strictEqual(r.external_id, postId);
  });
  await check("PUT /seo: finds the page by id", async () => {
    const r = await custom.customUpdateSeo({ integration, id: postId, url: "https://example.com/elsewhere", seo });
    assert(r.ok, `HTTP ${r.status}`);
    assert.strictEqual(r.external_id, postId);
  });
  await check("PUT /seo: 404 for a page the site does not have", async () => {
    const r = await custom.customUpdateSeo({ integration, slug: "no-such-page", seo });
    assert.strictEqual(r.status, 404);
  });

  await check("GET /blog-categories and GET /authors: names for the editor", async () => {
    const cats = await custom.customGetCategories({ integration });
    assert(cats.ok && cats.data.length && cats.data.every((c) => c.name), "categories without names");
    const auths = await custom.customGetAuthors({ integration });
    assert(auths.ok && auths.data.length && auths.data.every((a) => a.display_name || a.name), "authors without names");
  });

  await check("security: a wrong key is refused", async () => {
    const other = { ...integration, api_key: crypto.randomBytes(32).toString("hex") };
    const r = await custom.callCustom({ integration: other, path: "/pages", method: "GET" });
    assert.strictEqual(r.status, 401);
  });
  await check("security: a body changed after signing is refused", async () => {
    const r = await rawSigned(base, {
      path: "/handshake",
      method: "POST",
      body: JSON.stringify({ challenge: "changed" }),
      signWith: JSON.stringify({ challenge: "original" }),
    });
    assert.strictEqual(r.status, 401);
  });
  await check("security: a request signed 10 minutes ago is refused", async () => {
    const r = await rawSigned(base, {
      path: "/handshake",
      method: "POST",
      body: JSON.stringify({ challenge: "late" }),
      timestamp: Date.now() - 10 * 60 * 1000,
    });
    assert.strictEqual(r.status, 401);
  });

  return results;
}

async function main() {
  const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SAMPLES);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "rankhouse-samples-"));
  let failures = 0;

  for (const name of wanted) {
    const sample = SAMPLES[name];
    if (!sample) throw new Error(`Unknown sample "${name}"`);
    console.log(`\n${name} (${sample.page})`);
    if (!sample.available()) {
      console.log("  skipped: runtime not installed");
      continue;
    }

    const dir = path.join(workDir, name);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, sample.file), extractBlock(sample.page, sample.block));

    const siteUrl = `http://127.0.0.1:${sample.port}`;
    const base = `${siteUrl}/rankhouse`;
    const [cmd, args] = sample.command(sample.port);
    const child = spawn(cmd, args, {
      cwd: dir,
      env: { ...process.env, ...sample.env, RANKHOUSE_API_KEY: API_KEY, PORT: String(sample.port), SITE_URL: siteUrl },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));

    try {
      await waitUntilListening(base, child);
      for (const r of await runChecks(base, siteUrl)) {
        console.log(`  ${r.ok ? "ok  " : "FAIL"} ${r.label}${r.ok ? "" : `: ${r.error}`}`);
        if (!r.ok) failures++;
      }
    } catch (error) {
      failures++;
      console.log(`  FAIL could not start: ${error.message}\n${output}`);
    } finally {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await Promise.race([exited, sleep(5000)]);
    }
  }

  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {
    // Windows can hold a just-killed server's folder for a moment; it's in the temp dir.
  }
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

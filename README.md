# RankHouse developer docs

The Mintlify site for the RankHouse **publishing API**: the endpoints a custom
website builds so RankHouse can publish posts and SEO updates to it.

Pushes to `main` deploy automatically through the Mintlify GitHub app.

## Where the facts come from

Every page describes what the RankHouse server actually sends. The source of
truth lives in the main RankHouse repo:

| Topic | File in the RankHouse repo |
| --- | --- |
| Headers, signing, handshake, capabilities | `server/controllers/integrations/custom/index.js` (`callCustom`, `connectCustom`) |
| New post body | same file, `buildCustomPostBody` |
| SEO update body | `server/controllers/integrations/platform/postStructure.js`, `buildPageSeoBody` |
| Page list fields | `server/controllers/integrations/platform/syncSitePages.js` |
| Button labels | `client/src/components/account/AccountIntegrations.js` |

Change the server first, then the docs.

## Preview

```bash
npx mint dev            # http://localhost:3000
```

## Check before pushing

```bash
npx mint validate       # docs.json and page frontmatter
npx mint broken-links   # every internal link resolves
```

The sample receivers in `samples/*.mdx` are tested against the server's real
signing code. The script takes the code straight from the pages, runs each
sample and sends it real requests:

```bash
RANKHOUSE_SERVER="../Rank House/server" node tests/check-samples.cjs
```

It needs the RankHouse repo next to this one (with `server/node_modules`
installed), Python with `fastapi` and `uvicorn`, and PHP. Set `PYTHON` or `PHP`
to use a specific binary. Run it after any change to a sample or to the
server's custom-site code.

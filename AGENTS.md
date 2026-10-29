# Documentation project instructions

## About this project

- Public developer docs for the RankHouse publishing API (custom websites), built on [Mintlify](https://mintlify.com).
- Pages are MDX files with YAML frontmatter. Configuration lives in `docs.json`.
- Readers are developers at customer companies who build the endpoints on their own site.

## Rules

- Document only what the RankHouse server does today. Check every claim against the files listed in `README.md` before writing it.
- The signature headers are `X-RankHouse-Timestamp` and `X-RankHouse-Signature`. Never print any other header names for them.
- Don't document endpoints the product doesn't call: post deletion, products and product categories stay out until the product uses them.
- After changing a sample in `samples/`, run `node tests/check-samples.cjs` (see `README.md`).
- Support address: support@rankhouse.ai.

## Style

- Plain English, short sentences, second person ("you").
- Sentence case for headings.
- Bold for UI labels, exactly as the app shows them: **Generate key**, **Connect website**, **Re-verify**, **Sync pages**.
- Code formatting for endpoints, fields, headers and file names.
- No em dashes.

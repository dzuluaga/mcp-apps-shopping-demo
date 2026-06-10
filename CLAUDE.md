# CLAUDE.md

Project guidance for Claude (and human contributors). Read this before reviewing
or changing code. It captures invariants that are easy to violate and have bitten
us before.

## What this is

An **agentic shopping app** built as **one MCP server that runs on every surface**
(Claude native app, claude.ai, Claude Desktop, ChatGPT, Goose, Claude Code terminal).
One server, one small UI bundle (`src/`); each host renders the same widget natively,
or — in a no-GUI host — drives the whole flow from chat via MCP tools. TypeScript/Node;
tests run with `npm run test` (vitest). `npm run build` typechecks + builds.

## Architecture (where things live)

- `server.ts` / `app.ts` / `main.ts` — MCP tools + HTTP routes + stdio/http entrypoints.
- `catalog.ts`, `checkout.ts` — products, cart/order pricing, order encode/decode.
- `payment-gate/` — the authorization gates, each a self-contained module:
  - `passkey/` — WebAuthn same-device + cross-device (caBLE).
  - `dc-payment/` — Digital Credentials API + OpenID4VP, amount-bound (mdoc).
  - `credential-gate/` — (PR-in-flight) age / loyalty via OpenID4VP.
  - `mandate.ts` — the AP2-shaped mandate + the four deterministic gates.
- A new gate should **mirror** the `dc-payment` / `passkey` structure
  (`dcql`/`request`/`verify`/`page`/`routes` split) and reuse shared helpers
  (e.g. `makeEncryptionKey`) rather than copy them.

## Security invariants — DO NOT violate

These are load-bearing. A change that breaks one is blocking, even in "demo" code.

1. **Enforce gates server-side on EVERY completion path.** Age/payment/auth checks
   must run in `POST /checkout/place-order`, the `passkey` and `dc-payment` `/verify`
   handlers, AND the MCP `checkout` tool — not only in the rendered checkout HTML.
   Hiding a button is not enforcement.
2. **Never trust the order token.** Order tokens are unsigned base64url JSON and are
   hand-editable. Always **re-derive** amounts and flags from the cart/catalog
   server-side. Gate 1 re-sums the cart lines and refuses on mismatch — keep it that way.
3. **Discounts must reconcile with amount binding.** Any discount must keep the line
   sum, the order total, and the signed payment amount in agreement across *all* payment
   paths (passkey, dc-payment, instant-demo). A discount that one path accepts and another
   refuses is a bug.
4. **Scope verification/cart state per session/order — never process-global.** A single
   shared key means one user's verification unlocks checkout for everyone (cross-user
   bleed). Key state by the order/session id carried in the gate URL.
5. **Require explicit positive credential claims.** Verify the actual claim
   (e.g. `age_over_21 === true`), not merely "a token was present." Thresholds must match
   the product's restriction; don't accept an 18+ proof for a 21+ gate.
6. **Keep WebAuthn / OpenID4VP bound to this server's origin / RP-ID,** with nonce/replay
   protection. Seal and check the nonce; don't accept a presentation just because it decrypts.

> Cryptographic mdoc trust verification is acknowledged future work; until it lands, any
> gate relying on it must be fenced behind an explicit demo-only mode and must not be
> presented as a real safety control.

## Testing expectations

- Tests must exercise the **security-critical / bypass paths**, not just happy-path shape:
  e.g. POST an unverified age-restricted order and assert it is refused; authorize a
  discounted cart and assert amount binding passes; assert global-state bleed cannot occur.
- A test that would still pass with the security control removed is not a useful test.

## Conventions

- **Sign off every commit (DCO).** This repo (openmobilehub / OpenWallet Foundation)
  enforces the Developer Certificate of Origin: every commit must carry a
  `Signed-off-by:` line. Commit with `git commit -s` (and `git rebase --signoff` to fix
  existing commits) or your PR will be blocked by the DCO check.
- Match the style, naming, and comment density of surrounding code.
- Prefer small, well-bounded modules over growing a file past its one clear purpose.
- Deployment is on Vercel behind the stable alias `mcp-apps-nine.vercel.app/mcp`;
  changes that affect the served origin or that URL need extra care.

## Code review

PRs get both automated and human review:

> **Maintainers: push your feature branch to this repo — don't fork.** The automatic
> Claude review only runs on **same-repo** PRs (GitHub withholds secrets from fork-PR
> workflow runs on a public repo — regardless of your permission level). If you push to a
> branch here, you get the automatic review for free; if you fork, you only get a review
> on-demand by commenting `@claude`.

- **Same-repo PRs** — an automated Claude review (`anthropics/claude-code-action`) runs
  on every non-draft PR opened from a branch in this repo, grounded in this file's
  invariants. `claude-review` is a **required status check**: a same-repo PR can't merge
  until it's green.
- **Fork / external-contributor PRs** — the automated job is **skipped** (fork runs can't
  read the `CLAUDE_CODE_OAUTH_TOKEN` secret), so it never blocks you. A skipped required
  check counts as passing. Those PRs are reviewed by one of:
  - a maintainer commenting **`@claude`** on the PR (on-demand; runs in base-repo context
    so it has the secret),
  - the org-hosted **managed Claude review** integration (auto-reviews forks), and/or
  - an on-demand deep multi-agent review by a maintainer.
- **Human review** — at least one approving review is required to merge to `main`, and all
  review conversations must be resolved first.
- A PR that edits `.github/workflows/claude-code-review.yml` itself will fail
  `claude-review` by design (the action validates the workflow matches `main`) and needs
  an admin merge.

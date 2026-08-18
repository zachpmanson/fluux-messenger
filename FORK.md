# zachpmanson/fluux-messenger — fork layout

A personal fork of [processone/fluux-messenger](https://github.com/processone/fluux-messenger)
serving **chat.zachmanson.com**, where it replaced a converse.js fork on
2026-08-11.

The goal is to carry as little as possible. Anything that could live upstream
should be sent upstream — every feature ProcessOne merges is one this fork stops
rebasing forever.

## Branches

| Branch | Contents | Rule |
| --- | --- | --- |
| `main` | Mirrors `upstream/main` exactly | Never commit here. Fast-forward only. |
| `nix` | Fork infrastructure that upstream will never take: `flake.nix`, `.envrc`, this file, `scripts/sync-upstream.sh` | Rebased onto `main` |
| `feat/*` | One feature per branch, each a candidate PR to upstream | Rebased onto `main` |
| `master` | **The deploy branch.** `nix` plus whichever `feat/*` branches aren't upstreamed yet | Repo default; what naboo builds |

`master` is the repository's default branch, and `~/nix` pins `?ref=master`
explicitly.

**`master` is a build product — rebuild it, don't merge into it.** It is
`main` + `nix` + the carried `feat/*` branches, reconstructed by
`sync-upstream.sh` on every sync, so force-pushing it is routine rather than a
recovery. Merging a PR into it via GitHub is what to avoid: rebase-merge rewrites
the commit, after which the branch's own copy is no longer the same SHA, and the
next follow-up PR from that branch shows every commit again and conflicts. (Hit
on 2026-08-11 with the Markdown follow-up, PR #10 — resolved by rebuilding.)

So: reserve pull requests for **upstream**, where they're reviewed by someone
other than you. To land a feature locally, add it to the carried set and rebuild:

```sh
git checkout -B master nix && git cherry-pick main..feat/whatever
git push --force-with-lease origin master
```

Rebase rather than merge. With a handful of commits it keeps the fork's diff
readable as "here is what we changed", which is exactly what handing a feature to
upstream needs. Force-pushing `master` after a rebase is safe: `~/nix`'s
`flake.lock` pins a commit *hash*, so rewriting history never invalidates a
past deploy.

## Carried right now

- **nix packaging** — `flake.nix` exposes `packages.fluux` (the web bundle only;
  the Tauri desktop targets would need rustPlatform + a cargoHash + webkitgtk).
  Not upstreamable.
- **Markdown gaps** — tables, `[label](url)` links, nested lists, behind a
  setting. See PR #5 / issue #2. Upstreamable; offer it to ProcessOne.
- **Rebrand (deployment identity)** — favicon from the dotgrid diamond mark
  (`icon-variants/favicon-source.svg`) + `<title>Chat</title>`. Never
  upstreamable; stays in this fork for chat.zachmanson.com.

## Wanted, not yet built

- **Read receipts (XEP-0333)** — issue #3. Upstream lists 0333 and 0184 as
  "planned", so this is net-new SDK work and very likely wanted upstream.
- **Presence status in the chat header** — issue #4. Protocol side already
  exists; this is a UI change.
- **Slash-command bypass** — issue #1.

## Syncing

```sh
./scripts/sync-upstream.sh          # fetch, rebase nix + feat/*, run the suite
```

Then, when it's clean:

```sh
cd ~/nix
nix flake update fluux              # re-pin flake.lock to the new master
git commit -am 'fluux: bump' && git push origin master
make naboo-deploy
```

`git config rerere.enabled true` is worth setting in this checkout — the same
conflict in `messageStyles.tsx` recurs on every rebase, and rerere replays your
resolution after the first time. `sync-upstream.sh` sets it for you.

### The recurring chore

Every upstream `package-lock.json` change invalidates `npmDepsHash` in
`flake.nix`. Regenerate with:

```sh
nix run nixpkgs#prefetch-npm-deps -- package-lock.json
```

`sync-upstream.sh` detects a moved lockfile and tells you when this is needed.

### Conflict-prone spots

- `apps/fluux/src/utils/messageStyles.tsx` — the Markdown work lives here and
  upstream actively develops it.
- `apps/fluux/src/i18n/locales/*.json` — 34 files. Custom keys sit adjacent to
  where upstream adds its own settings keys, so expect line-adjacency conflicts.
  If the Markdown PR isn't taken upstream, move those keys to the end of the
  settings block to reduce the churn.

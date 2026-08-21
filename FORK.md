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
- **Square avatars** — Profile picture shape setting (circle/square), incl.
  the MUC-icon (#11), search-dropdown and rooms-list follow-ups. Issue #6.
  Net-new UI; offer it to ProcessOne.
- **Read receipts (XEP-0333/0184)** — issue #3, now built. Net-new SDK work;
  likely wanted upstream.
- **Presence status in the chat header** — issue #4, now built. UI change.
- **Slash-command bypass** — issue #1, now built.
- **Rebrand (deployment identity)** — favicon from the dotgrid diamond mark
  (`icon-variants/favicon-source.svg`) + `<title>Chat</title>`. Never
  upstreamable; stays in this fork for chat.zachmanson.com.

## Wanted, not yet built

- *(none currently — all carried features above are built)*

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

### Resync pitfalls (hit 2026-08-20)

Lessons from a fresh-features pass on master that caught more than expected:

1. **The sync exits early when upstream hasn't moved.** `sync-upstream.sh`
   fast-forwards `main` and bails if there's nothing new — which silently skips
   the rebuild even when the *carried set* changed. Check `ls-remote upstream`
   against local `main` first; if unchanged, force the rebuild explicitly.
2. **New features don't restack atomically onto fresh master.** Rebuilding
   master by cherry-picking each `feat/*` individually re-conflicts on
   `messageStyles.tsx` and the locale files *whenever the feature set changed*
   — rerere only replays the old, known merge triads. Expect manual resolution.
3. **Never `git add -u` an unresolved conflicted file.** Blindly staging
   produced a master *with `<<<<<<<` markers baked into the tree* (silently
   broken software). Resolve the hunks by hand; a marker'd master is worse than
   a conflicted one.
4. **Work in throwaway worktrees.** The shared checkout may be another agent's
   working tree; move branch refs and stage cherry-picks from a worktree, never
   there.
5. **Regenerate `npmDepsHash` from the real committed `package-lock.json`** —
   running `prefetch-npm-deps` on a reserialized copy yields a different hash
   (key order/formatting). The `/tmp` test gave `bFZeu…`; the actual file gave
   `5uWT…`. Hash what's committed.
6. **Fetch before `--force-with-lease` and don't clobber the owner's push.**
   If the remote master moved mid-task, rebase onto it rather than force over
   it — the owner may have made an intentional direct commit.
7. **A canonical rebuild changes history, not necessarily content.** Confirm a
   clean rebuild with `git diff <deployed> <rebuild>` (empty = safe force-push;
   the deploy is then a no-op, `'fluux' already at latest`).
8. **Every master-only change must also sit on a carried branch**, or the next
   rebuild silently drops it. (`feat/new-message-modal-height` survived because
   it was a carried branch.)

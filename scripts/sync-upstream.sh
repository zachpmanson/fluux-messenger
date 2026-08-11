#!/usr/bin/env bash
#
# Sync this fork with upstream. See FORK.md for the branch layout.
#
#   main    mirrors upstream/main (fast-forward only)
#   nix     fork infrastructure, rebased onto main
#   feat/*  one feature each, rebased onto main
#   master  the deploy branch: nix + un-upstreamed feat/* branches
#
# Rebases every carried branch onto the new upstream, rebuilds master from them,
# then runs the test suite. Stops at the first conflict and tells you where.
# Nothing is pushed — review, then push and bump ~/nix's flake.lock yourself.

set -euo pipefail

cd "$(dirname "$0")/.."

# The same conflicts recur on every rebase; remember their resolutions.
git config rerere.enabled true

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "sync-upstream: working tree is dirty — commit or set it aside first." >&2
  exit 1
fi

STARTING_BRANCH=$(git rev-parse --abbrev-ref HEAD)
LOCKFILE_BEFORE=$(git rev-parse main:package-lock.json)

echo "==> Fetching upstream"
git fetch upstream

BEFORE=$(git rev-parse --short main)
git branch -f main upstream/main
AFTER=$(git rev-parse --short main)

if [ "$BEFORE" = "$AFTER" ]; then
  echo "==> Already current at $AFTER; nothing to rebase."
  exit 0
fi
echo "==> main: $BEFORE -> $AFTER"
git --no-pager log --oneline "$BEFORE..$AFTER" | head -20

# Every branch this fork carries, in the order master should stack them.
CARRIED=(nix)
while IFS= read -r branch; do
  [ -n "$branch" ] && CARRIED+=("$branch")
done < <(git for-each-ref --format='%(refname:short)' 'refs/heads/feat/*')

for branch in "${CARRIED[@]}"; do
  echo "==> Rebasing $branch onto main"
  git checkout --quiet "$branch"
  if ! git rebase main; then
    echo >&2
    echo "sync-upstream: $branch hit a conflict. Resolve it, then:" >&2
    echo "    git rebase --continue && ./scripts/sync-upstream.sh" >&2
    echo "  or abandon with: git rebase --abort" >&2
    exit 1
  fi
done

echo "==> Rebuilding master from ${CARRIED[*]}"
git checkout --quiet -B master main
for branch in "${CARRIED[@]}"; do
  if ! git merge --ff-only "$branch" 2>/dev/null; then
    # Not a fast-forward once more than one branch stacks up — replay its commits.
    if ! git cherry-pick "main..$branch"; then
      echo >&2
      echo "sync-upstream: replaying $branch onto master hit a conflict." >&2
      echo "    Resolve it, then: git cherry-pick --continue" >&2
      exit 1
    fi
  fi
done

if [ "$(git rev-parse main:package-lock.json)" != "$LOCKFILE_BEFORE" ]; then
  echo
  echo "==> package-lock.json moved upstream — npmDepsHash in flake.nix is stale."
  echo "    Regenerate it on the nix branch with:"
  echo "      nix run nixpkgs#prefetch-npm-deps -- package-lock.json"
fi

echo "==> npm ci"
npm ci --silent

echo "==> Tests"
npm run test

echo "==> Typecheck"
npm run typecheck

git checkout --quiet "$STARTING_BRANCH"

cat <<'EOF'

==> Clean. To ship it:

    git push --force-with-lease origin main nix master
    for b in $(git for-each-ref --format='%(refname:short)' 'refs/heads/feat/*'); do
      git push --force-with-lease origin "$b"
    done

    cd ~/nix && nix flake update fluux
    git commit -am 'fluux: bump' && git push origin master
    make naboo-deploy
EOF

#!/usr/bin/env bash
# The previous publish tool release, for the release notes of <version>.
#
#   git tag --list 'publish-v*' | scripts/prev-publish-tag.sh 1.11.40
#
# Reads tag names on stdin and prints the greatest exact publish-vX.Y.Z
# strictly below <version>, or nothing. Never the release's own tag (a re-run
# would diff it against itself), a prerelease or suffixed tag, or a later one.
set -euo pipefail

if [[ $# -ne 1 || ! "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: $0 <X.Y.Z>  (tag names on stdin)" >&2
  exit 2
fi
current=$1

prev=$( { grep -E '^publish-v[0-9]+\.[0-9]+\.[0-9]+$' || true; } \
  | sed 's/^publish-v//' \
  | { cat; echo "$current"; } \
  | sort -uV \
  | awk -v cur="$current" '$0 == cur { print last; exit } { last = $0 }')
if [[ -n "$prev" ]]; then
  echo "publish-v$prev"
fi

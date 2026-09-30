#!/usr/bin/env bash
# Maintainer-only: create a publish-v<version> tag on an older commit, so
# tag-to-tag diffs of tools/publish work (#274). Run by the repo owner, once
# per tag, after the release workflow has merged. CI never runs this.
#
#   scripts/backfill-publish-tag.sh 1.11.30 5779522
#   scripts/backfill-publish-tag.sh 1.11.39 95bdd0cf
#
# It refuses if the tag exists (a tag is never moved) or if
# tools/publish/package.json at <sha> does not say <version>. It creates the
# tag locally and prints the push command; it does not push. Backfilled tags
# carry no release or tarball: those commits predate the packed release.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <version> <sha>" >&2
  exit 2
fi
version=$1
sha=$2
tag="publish-v${version}"

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "version must be X.Y.Z, got: $version" >&2
  exit 2
fi
full=$(git rev-parse --verify "${sha}^{commit}")

actual=$(git show "${full}:tools/publish/package.json" | jq -r '.version')
if [[ "$actual" != "$version" ]]; then
  echo "tools/publish/package.json at ${sha} says ${actual}, not ${version}; refusing." >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/${tag}" >/dev/null \
   || git ls-remote --tags origin "refs/tags/${tag}" | grep -q .; then
  echo "${tag} already exists; tags are never moved." >&2
  exit 1
fi

git tag -a "$tag" "$full" -m "Publish tool ${version}"
echo "Created ${tag} at ${full}."
echo "Push it with: git push origin refs/tags/${tag}"

#!/bin/bash
set -euo pipefail

BUILD_DIR=_site

if [[ `git status --porcelain --untracked-files=no` ]]; then
  echo "Uncommitted changes - commit changes before deploying."
  exit 1
fi

git branch -D gh-pages
git checkout --orphan gh-pages
git --work-tree $BUILD_DIR add --all
git --work-tree $BUILD_DIR commit -m 'deploy to gh-pages'
git push origin HEAD:gh-pages --force
git checkout -f main

echo "Deployed to https://kwlch.dev!"
exit 0
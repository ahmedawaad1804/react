#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ] || [ -e "$1" ]; then
  echo 'Usage: bash build.sh NEW_OUTPUT_DIRECTORY' >&2
  exit 1
fi

harness_dir=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$1"
output_dir=$(cd "$1" && pwd)
base=b05c0b75fd9778536152eead30814c9ca90c810a
entries=react/index,react/jsx-runtime,react-dom/index,react-dom/client,react-noop-renderer/index,react-reconciler,scheduler

git init -q "$output_dir/source"
cd "$output_dir/source"
git remote add origin https://github.com/react/react.git
git fetch --depth=1 origin "$base"
git checkout -q --detach FETCH_HEAD
yarn install --frozen-lockfile --non-interactive

build_variant() {
  RELEASE_CHANNEL=stable node scripts/rollup/build.js "$entries" --type=NODE_PROD
  mkdir "$output_dir/$1"
  cp -R build/node_modules "$output_dir/$1/node_modules"
}

build_variant baseline
git apply "$harness_dir/reconciler.patch"
build_variant patched

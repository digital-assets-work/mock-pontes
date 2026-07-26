#!/bin/sh

entrypoint_ts=$1
shift # remove the fist param the rest is in "$@" and will be passed to the execution
dest=dist
test -d $dest || mkdir -p $dest
entrypoint_js=$dest/index.js

if [ -f "$entrypoint_ts" ]; then
  echo processing file $entrypoint_ts
else
  echo "File [$entrypoint_ts] does not exists. Pls check"
  exit 1
fi


# npx tsc --noEmit --module esnext --moduleResolution Bundler $entrypoint_ts
npx tsc # $entrypoint_ts

if [ $? -eq 0 ]; then
  echo "Syntax check succeeded"
else
  echo "syntax check failed"
  exit 1
fi

npx esbuild --bundle --outfile=$entrypoint_js --sourcemap --platform=node --format=esm --packages=external --log-level=warning $entrypoint_ts

if [ $? -eq 0 ]; then
  echo "Build succeeded"
else
  echo "Build failed"
  exit 2
fi

# node $entrypoint_js "$@"

#!/usr/bin/env sh
set -eu

site_dir="${KEYLINT_SITE_DIRECTORY:-keylint-report/site}"

if [ ! -f "${site_dir}/index.html" ]; then
  echo "KeyLint HTML report not found; skipping S3 publication."
  exit 0
fi

: "${KEYLINT_S3_URI:?Set KEYLINT_S3_URI to the destination S3 URI.}"

aws s3 cp "${site_dir}/index.html" "${KEYLINT_S3_URI%/}/index.html" \
  --content-type "text/html; charset=utf-8" \
  --cache-control "no-cache, max-age=0, must-revalidate" \
  --only-show-errors

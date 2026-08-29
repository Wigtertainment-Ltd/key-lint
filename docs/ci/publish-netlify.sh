#!/usr/bin/env sh
set -eu

site_dir="${KEYLINT_SITE_DIRECTORY:-keylint-report/site}"
deploy_mode="${KEYLINT_NETLIFY_DEPLOY_MODE:-preview}"

if [ ! -f "${site_dir}/index.html" ]; then
  echo "KeyLint HTML report not found; skipping Netlify publication."
  exit 0
fi

: "${NETLIFY_AUTH_TOKEN:?Provide NETLIFY_AUTH_TOKEN through the CI secret store.}"
: "${NETLIFY_SITE_ID:?Provide NETLIFY_SITE_ID through the CI secret store.}"

case "${deploy_mode}" in
  preview)
    ./node_modules/.bin/netlify deploy --dir="${site_dir}"
    ;;
  production)
    ./node_modules/.bin/netlify deploy --dir="${site_dir}" --prod
    ;;
  *)
    echo "KEYLINT_NETLIFY_DEPLOY_MODE must be 'preview' or 'production'." >&2
    exit 2
    ;;
esac

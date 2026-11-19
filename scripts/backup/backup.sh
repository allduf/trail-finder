#!/usr/bin/env bash
# Trail Finder nightly backup (.github/workflows/backup.yml). Makes ONE encrypted file with:
#   db/schema.sql            every table, function and rule (row-level security) in the public schema
#   db/data-auth.sql         sign-ins (auth.users, auth.identities) and photo records (storage.buckets, .objects)
#   db/data-public.sql       every row in the public schema
#   json/<table>.json        the same rows as JSON, used to put back one person's things (restore.sh person)
#   files/<bucket>/<path>    every stored photo (ride, point, trail and photo-find pictures)
#   manifest.txt             row counts, file count and a checksum of every file
# The file is encrypted (AES-256) with BACKUP_PASSWORD before it leaves this machine. Nothing personal is printed:
# the repository and its Actions logs are PUBLIC, so this script prints only "done" lines, never names, ids or counts.
#
# Needs: SUPABASE_DB_URL (Session pooler connection string), BACKUP_PASSWORD, SUPABASE_SECRET_KEY (photos).
# Optional: SUPABASE_URL, OUT (folder for the encrypted file, default ./backup-out), DAY (default today, UTC).
# Writes $OUT/tf-backup-<DAY>.tgz.gpg and prints its path on the last line.
set -euo pipefail
umask 077

: "${SUPABASE_DB_URL:?Add the SUPABASE_DB_URL secret (see scripts/backup/README.md).}"
: "${BACKUP_PASSWORD:?Add the BACKUP_PASSWORD secret (see scripts/backup/README.md).}"
SUPABASE_URL="${SUPABASE_URL:-https://fohdmserpbkurcvcrbbb.supabase.co}"
OUT="${OUT:-backup-out}"
DAY="${DAY:-$(date -u +%F)}"
NAME="tf-backup-$DAY"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
D="$WORK/$NAME"
mkdir -p "$D/db" "$D/json" "$D/files" "$OUT"

psqlq() { psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 -At "$@"; }

# 1. The database, as SQL (for putting the whole project back).
pg_dump "$SUPABASE_DB_URL" --schema-only --schema=public --no-owner -f "$D/db/schema.sql"
# Two data files: pg_dump ignores --schema when --table is given.
pg_dump "$SUPABASE_DB_URL" --data-only \
  --table=auth.users --table=auth.identities --table=storage.buckets --table=storage.objects \
  -f "$D/db/data-auth.sql"
pg_dump "$SUPABASE_DB_URL" --data-only --schema=public -f "$D/db/data-public.sql"
echo "Database dumped."

# 2. The same rows as JSON, one file per table (for putting back one person's things).
TABLES="$(psqlq -c "select table_schema||'.'||table_name from information_schema.tables
  where table_type='BASE TABLE' and table_schema='public' order by 1")
auth.users
auth.identities
storage.objects"
: > "$D/manifest.txt"
echo "backup $DAY" >> "$D/manifest.txt"
for t in $TABLES; do
  psqlq -c "select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from $t x" > "$D/json/$t.json"
  echo "rows $t $(psqlq -c "select count(*) from $t")" >> "$D/manifest.txt"
done
echo "Tables copied."

# 3. Photos: every object in Storage, fetched with the secret key.
FILES=0; MISSING=0
if [ -n "${SUPABASE_SECRET_KEY:-}" ]; then
  AUTH=(-H "apikey: $SUPABASE_SECRET_KEY")
  case "$SUPABASE_SECRET_KEY" in sb_*) ;; *) AUTH+=(-H "Authorization: Bearer $SUPABASE_SECRET_KEY") ;; esac
  while IFS=$'\t' read -r bucket name; do
    [ -n "$bucket" ] && [ -n "$name" ] || continue
    case "/$bucket/$name/" in */../*|*/./*) MISSING=$((MISSING+1)); continue ;; esac
    enc="$(jq -rn --arg p "$name" '$p | split("/") | map(@uri) | join("/")')"
    dest="$D/files/$bucket/$name"
    mkdir -p "$(dirname "$dest")"
    if curl -sf --retry 3 --retry-delay 2 "${AUTH[@]}" -o "$dest" \
        "$SUPABASE_URL/storage/v1/object/authenticated/$(jq -rn --arg b "$bucket" '$b|@uri')/$enc"; then
      FILES=$((FILES+1))
    else
      rm -f "$dest"; MISSING=$((MISSING+1))
    fi
  done < <(psqlq -F $'\t' -c "select bucket_id, name from storage.objects where name is not null and name not like '%/.emptyFolderPlaceholder' order by 1, 2")
else
  echo "::warning::No SUPABASE_SECRET_KEY: photos were not copied."
fi
echo "files $FILES" >> "$D/manifest.txt"
echo "files-missing $MISSING" >> "$D/manifest.txt"
[ "$MISSING" = 0 ] || echo "::warning::Some stored photos could not be fetched (see manifest inside the backup)."
echo "Photos copied."

# 4. Checksums of everything, then pack and encrypt.
(cd "$D" && find db json files -type f -print0 | sort -z | xargs -0 -r sha256sum > checksums.sha256)
ENC="$OUT/$NAME.tgz.gpg"
tar -C "$WORK" -czf - "$NAME" | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
  --symmetric --cipher-algo AES256 --s2k-digest-algo SHA512 --s2k-mode 3 --s2k-count 65011712 \
  -o "$ENC" 3<<<"$BACKUP_PASSWORD"

# 5. Prove it opens: decrypt, unpack to a new folder and check every checksum.
CHECK="$(mktemp -d)"
gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 -d "$ENC" 3<<<"$BACKUP_PASSWORD" | tar -C "$CHECK" -xzf -
(cd "$CHECK/$NAME" && sha256sum --quiet -c checksums.sha256)
grep -q '^files ' "$CHECK/$NAME/manifest.txt"
rm -rf "$CHECK"
echo "Encrypted backup made and checked: it opens with the password and every file matches."
echo "$ENC"

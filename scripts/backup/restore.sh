#!/usr/bin/env bash
# Trail Finder: put things back from a nightly backup (made by backup.sh). Steps for alex: scripts/backup/README.md.
#
#   restore.sh check       <file>            open the backup and check every file in it (changes nothing)
#   restore.sh person      <file> <user id>  put back one person's missing rows, sign-in and photos
#   restore.sh missing     <file> [table]    put back every missing row (and photo) of people who still have an
#                                            account, plus rows that belong to no account (shared cabin trips...)
#   restore.sh new-project <file>            load everything into a NEW, EMPTY Supabase project (disaster only)
#
# Rows already in the database are never changed or deleted: only missing rows are added (on conflict do nothing).
# Accounts deleted since the backup are not brought back by "person" (unless you name them) or "missing".
# Needs BACKUP_PASSWORD, and for every mode but check: SUPABASE_DB_URL (+ SUPABASE_URL, SUPABASE_SECRET_KEY for photos)
# of the project being written to. Prints counts only, never names or ids (Actions logs are public).
set -euo pipefail
umask 077

MODE="${1:-}"; FILE="${2:-}"
[ -n "$MODE" ] && [ -f "$FILE" ] || { sed -n '2,13p' "$0"; exit 2; }
: "${BACKUP_PASSWORD:?Set BACKUP_PASSWORD.}"
SUPABASE_URL="${SUPABASE_URL:-https://fohdmserpbkurcvcrbbb.supabase.co}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 -d "$FILE" 3<<<"$BACKUP_PASSWORD" | tar -C "$WORK" -xzf -
D="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d -name 'tf-backup-*' | head -1)"
[ -n "$D" ] || { echo "No backup folder inside the file."; exit 1; }
(cd "$D" && sha256sum --quiet -c checksums.sha256)
echo "Backup $(basename "$D" | sed 's/tf-backup-//') opened: $(find "$D/json" -name '*.json' | wc -l) tables, $(find "$D/files" -type f | wc -l) photos, every checksum matches."
[ "$MODE" = check ] && exit 0

: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL (the project to write to).}"
psqlq() { psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 -At "$@"; }
AUTH=()
if [ -n "${SUPABASE_SECRET_KEY:-}" ]; then
  AUTH=(-H "apikey: $SUPABASE_SECRET_KEY")
  case "$SUPABASE_SECRET_KEY" in sb_*) ;; *) AUTH+=(-H "Authorization: Bearer $SUPABASE_SECRET_KEY") ;; esac
fi

# Upload one stored photo if it is missing. $1 bucket, $2 path, $3 content type, $4 "upsert" to overwrite.
put_file() {
  local src="$D/files/$1/$2" enc code
  [ -f "$src" ] || return 1
  enc="$(jq -rn --arg p "$2" '$p | split("/") | map(@uri) | join("/")')"
  code="$(curl -s -o /dev/null -w '%{http_code}' --retry 3 "${AUTH[@]}" -H "Content-Type: ${3:-application/octet-stream}" \
    -H "x-upsert: $([ "${4:-}" = upsert ] && echo true || echo false)" --data-binary @"$src" \
    "$SUPABASE_URL/storage/v1/object/$(jq -rn --arg b "$1" '$b|@uri')/$enc")"
  case "$code" in 200|201) return 0 ;; 400|409) return 3 ;; *) return 1 ;; esac   # 400/409: already there
}

# Photos listed in storage.objects.json that match a jq filter. Puts back the missing ones, then gives each its owner.
put_files() {
  local filter="$1" mode="${2:-}" n=0 had=0 bad=0 b p t
  [ ${#AUTH[@]} -gt 0 ] || { echo "No SUPABASE_SECRET_KEY: photos skipped."; return 0; }
  while IFS=$'\t' read -r b p t; do
    if put_file "$b" "$p" "$t" "$mode"; then n=$((n+1)); else
      rc=$?; if [ $rc = 3 ]; then had=$((had+1)); else bad=$((bad+1)); fi
    fi
  done < <(jq -r ".[] | select($filter) | [.bucket_id, .name, (.metadata.mimetype // \"application/octet-stream\")] | @tsv" "$D/json/storage.objects.json")
  # Uploads with the secret key have no owner: copy the owner from the backup so the person's own rules still work.
  load_json storage.objects
  psqlq -c "update storage.objects o set owner = r.owner from $ROWS r
    where o.bucket_id = r.bucket_id and o.name = r.name and o.owner is distinct from r.owner and r.owner is not null" >/dev/null
  if psqlq -c "select 1 from information_schema.columns where table_schema='storage' and table_name='objects' and column_name='owner_id'" | grep -q 1; then
    psqlq -c "update storage.objects o set owner_id = r.owner_id from $ROWS r
      where o.bucket_id = r.bucket_id and o.name = r.name and o.owner_id is distinct from r.owner_id and r.owner_id is not null" >/dev/null
  fi
  echo "Photos: $n put back, $had already there, $bad failed."
}

# Load a table's JSON rows into tf_restore.rows_in (same columns as the real table). A real table in a private
# schema, so the next psql call can read it; the schema is dropped at the end.
load_json() {
  local t="$1" f="$D/json/$1.json"
  psqlq -c "set client_min_messages = warning; create schema if not exists tf_restore; drop table if exists tf_restore.rows_in, tf_restore._rows_raw;
    create table tf_restore._rows_raw (j jsonb)" >/dev/null
  psqlq -c "\\copy tf_restore._rows_raw(j) from program 'jq -c \".[]\" \"$f\"' with (format csv, quote e'\\x01', delimiter e'\\x02')" >/dev/null
  psqlq -c "create table tf_restore.rows_in as select r.* from tf_restore._rows_raw, jsonb_populate_record(null::$t, j) r" >/dev/null
  ROWS=tf_restore.rows_in
}
cleanup_db() { psqlq -c "set client_min_messages = warning; drop schema if exists tf_restore cascade" >/dev/null 2>&1 || true; }
trap 'cleanup_db; rm -rf "$WORK"' EXIT

# Columns of a table that point at a person (auth.users), plus well-known names.
user_cols() {
  psqlq -c "select distinct a.attname from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.contype = 'f' and c.conrelid = '$1'::regclass and c.confrelid = 'auth.users'::regclass
    union select column_name::name from information_schema.columns
      where table_schema||'.'||table_name = '$1' and column_name in ('user_id','owner') and data_type = 'uuid'"
}

# Add the rows of table $1 that match SQL condition $2 (on r.*) and are not there yet. Prints how many were added.
add_rows() {
  local t="$1" cond="$2" out cols
  load_json "$t"
  # Every column but generated ones (auth.users.confirmed_at...), which the database fills in itself.
  cols="$(psqlq -c "select string_agg(quote_ident(attname), ',' order by attnum) from pg_attribute
    where attrelid = '$t'::regclass and attnum > 0 and not attisdropped and attgenerated = ''")"
  # A table with no primary key or unique rule can't say "already there": skip rows that are there word for word.
  if [ "$(psqlq -c "select count(*) from pg_index where indrelid = '$t'::regclass and indisunique")" = 0 ]; then
    cond="($cond) and not exists (select 1 from $t x where to_jsonb(x) = to_jsonb(r))"
  fi
  out="$(psqlq -c "with ins as (insert into $t ($cols) overriding system value select $cols from $ROWS r where $cond
    on conflict do nothing returning 1) select count(*) from ins" 2>&1)" || { echo "  $t: not done ($(echo "$out" | head -1 | cut -c1-160))"; return 1; }
  ADDED=$((ADDED + out))
}

# Tables in the backup that still exist in the database, public ones only.
public_tables() {
  for f in "$D"/json/public.*.json; do
    t="$(basename "$f" .json)"
    psqlq -c "select to_regclass('$t') is not null" | grep -q t && echo "$t"
  done
}

# Run add_rows over tables, repeating the ones that failed (a row can need a row of another table first).
add_all() {   # $1 = function giving the condition for a table
  local todo next pass
  todo="$(public_tables | { if [ -n "${ONLY:-}" ]; then grep -x "public.${ONLY#public.}" || true; else cat; fi; })"
  [ -n "$todo" ] || { echo "No such table in the backup."; FAILED=1; return 0; }
  for pass in 1 2 3; do
    next=""
    for t in $todo; do
      cond="$($1 "$t")"
      [ -n "$cond" ] || continue
      add_rows "$t" "$cond" || next="$next $t"
    done
    todo="$next"; [ -n "$todo" ] || break
  done
  [ -z "$todo" ] || { echo "Some tables could not be put back (see above)."; FAILED=1; }
}

ADDED=0; FAILED=0
case "$MODE" in
  person)
    UID_="${3:-}"
    [[ "$UID_" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo "Give the person's user id (a 36-character id from Supabase, Authentication, Users)."; exit 2; }
    echo "::add-mask::$UID_" 2>/dev/null || true
    # Their sign-in first (only if it is gone), so their rows can point at it.
    if [ "$(psqlq -c "select count(*) from auth.users where id = '$UID_'")" = 0 ]; then
      add_rows auth.users "r.id = '$UID_'" && add_rows auth.identities "r.user_id = '$UID_'" || FAILED=1
    fi
    cond_person() { local c w=""; for c in $(user_cols "$1"); do w="${w:+$w or }r.$c = '$UID_'"; done; echo "$w"; }
    add_all cond_person
    echo "Rows put back: $ADDED."
    put_files ".owner == \"$UID_\" or .owner_id == \"$UID_\" or (.name | startswith(\"$UID_/\"))"
    ;;
  missing)
    ONLY="${3:-}"
    # Rows of people who still have an account, and rows that belong to nobody. Deleted accounts stay deleted.
    cond_missing() {
      local c w="true"
      for c in $(user_cols "$1"); do w="$w and (r.$c is null or exists (select 1 from auth.users u where u.id = r.$c))"; done
      echo "$w"
    }
    add_all cond_missing
    echo "Rows put back: $ADDED."
    [ -n "$ONLY" ] || {
      users="$(psqlq -c "select coalesce(jsonb_agg(id::text), '[]') from auth.users")"
      echo "$users" > "$WORK/users.json"
      put_files "(.owner // .owner_id) as \$o | (\$o == null or ([\$o] | inside($(cat "$WORK/users.json"))))"
    }
    ;;
  new-project)
    if [ "$(psqlq -c "select count(*) from auth.users")" != 0 ] && [ "${I_AM_SURE:-}" != yes ]; then
      echo "This project already has accounts. new-project is only for a brand-new, empty project. Stopping."; exit 1
    fi
    # Tables, functions and rules, then every row with triggers and checks between tables paused (Supabase's own
    # restore steps), in one go: if anything fails, nothing is kept.
    sed -e '/^SET transaction_timeout/d' -e '/^CREATE SCHEMA public;/d' -e '/^COMMENT ON SCHEMA public /d' \
      "$D/db/schema.sql" > "$WORK/schema.sql"
    sed -e '/^SET transaction_timeout/d' "$D/db/data-auth.sql" > "$WORK/data-auth.sql"
    sed -e '/^SET transaction_timeout/d' "$D/db/data-public.sql" > "$WORK/data-public.sql"
    psql "$SUPABASE_DB_URL" -X -q --single-transaction -v ON_ERROR_STOP=1 \
      -f "$WORK/schema.sql" -c "SET session_replication_role = replica" \
      -f "$WORK/data-auth.sql" -f "$WORK/data-public.sql" >/dev/null
    echo "Database loaded: $(psqlq -c "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'") tables."
    put_files "true" upsert
    ;;
  *) sed -n '2,13p' "$0"; exit 2 ;;
esac
[ "$FAILED" = 0 ] || exit 1
echo "Done."

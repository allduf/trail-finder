#!/usr/bin/env bash
# Full test of backup.sh and restore.sh on a local Postgres (never the real project):
#   1. builds a fake Trail Finder database from supabase/*.sql with made-up people, trips, rides and photos
#   2. backs it up (encrypted), then checks the file
#   3. new-project: loads the backup into an empty database and compares every row and photo
#   4. person: deletes one person (account, rows and photos), puts them back, compares
#   5. missing: loses a shared cabin trip and a ride, deletes another account after the backup, puts back
#      what's missing and checks the deleted account stays deleted
# Needs a local Postgres you can reach as PGBASE (default postgresql://postgres:pw@localhost), plus psql, pg_dump,
# gpg, jq, curl and node. Run from the repository root: bash scripts/backup/test/run.sh
set -euo pipefail
PGBASE="${PGBASE:-postgresql://postgres:pw@localhost}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
T="$(mktemp -d)"
KEY="sb_secret_test"
export BACKUP_PASSWORD="test password, not a real one"
PIDS=()
finish() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap finish EXIT

A="$PGBASE/tf_backup_a"; B="$PGBASE/tf_backup_b"
for db in tf_backup_a tf_backup_b; do
  psql "$PGBASE/postgres" -X -q -c "drop database if exists $db" -c "create database $db"
done
q() { psql "$1" -X -q -v ON_ERROR_STOP=1 -At -c "$2"; }

# 1. Schema: Supabase stand-ins, then every supabase/*.sql (a few need real Supabase parts and may fail: fine).
for db in "$A" "$B"; do psql "$db" -X -q -v ON_ERROR_STOP=1 -f "$HERE/supabase-stub.sql" >/dev/null; done
fails=0
for f in "$ROOT"/supabase/*.sql; do psql "$A" -X -q -f "$f" >/dev/null 2>&1 || fails=$((fails+1)); done
echo "Schema loaded ($(q "$A" "select count(*) from information_schema.tables where table_schema='public'") public tables)."

U1=11111111-1111-4111-8111-111111111111; U2=22222222-2222-4222-8222-222222222222; U3=33333333-3333-4333-8333-333333333333
q "$A" "insert into auth.users (id, email, email_confirmed_at) values
  ('$U1','person-one',now()), ('$U2','person-two',now()), ('$U3','person-three',now()) on conflict do nothing"
q "$A" "insert into auth.identities (user_id, provider, provider_id, identity_data)
  select id, 'email', id::text, jsonb_build_object('email', email) from auth.users"
q "$A" "insert into public.settings (user_id, data) values ('$U1','{\"tf:skiTrips\":[{\"id\":\"t1\",\"n\":\"Wedge \\\\ \\\"quote\\\" é\"}]}'),
  ('$U2','{\"a\":1}'), ('$U3','{\"b\":2}')"
q "$A" "insert into public.rides (user_id, id, data) values ('$U1','r1','{\"km\":12}'), ('$U1','r2','{\"km\":3}'),
  ('$U2','r3','{\"km\":7}'), ('$U3','r4','{\"km\":1}')"
q "$A" "insert into public.shared_trips (secret, data) values ('s1','{\"cabin\":\"x\"}'), ('s2','{\"cabin\":\"y\"}')"
# Two reports (identity ids), so a put-back report must keep its id: delete the first, keep the second.
q "$A" "insert into public.trail_reports (user_id, osm_type, osm_id, lat, lon, condition, note) values
  ('$U1','way',1,50,-123,'dry','line one
line two, a tab	here and a backslash \\ too'), ('$U2','way',2,50,-123,'muddy',null)"
q "$A" "insert into public.tf_agreements (device, user_id, what, v, agreed_at) values ('device-one','$U1','terms',1,now()),
  ('device-two',null,'terms',1,now())"
q "$A" "insert into storage.buckets (id, name) values ('ride-photos','ride-photos'), ('point-photos','point-photos') on conflict do nothing"
mkdir -p "$T/files-a" "$T/files-b"
for spec in "ride-photos|$U1/r1/a b.jpg|$U1" "ride-photos|$U2/r3/c.jpg|$U2" "point-photos|$U3/p/d.jpg|$U3" "ride-photos|$U1/r2/é.jpg|$U1"; do
  IFS='|' read -r bk nm ow <<<"$spec"
  mkdir -p "$(dirname "$T/files-a/$bk/$nm")"; head -c 3000 /dev/urandom > "$T/files-a/$bk/$nm"
  q "$A" "insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('$bk', \$n\$$nm\$n\$, '$ow', '$ow', '{\"mimetype\":\"image/jpeg\"}')"
done
echo "Made-up people, trips, rides and photos added."

node "$HERE/fake-storage.mjs" 54331 "$T/files-a" "$A" "$KEY" & PIDS+=($!)
node "$HERE/fake-storage.mjs" 54332 "$T/files-b" "$B" "$KEY" & PIDS+=($!)
# Wait until both stand-ins answer (on a fresh GitHub runner the first node start can take several seconds;
# a fixed one-second sleep let the backup run before the server was up, and every photo download failed).
for port in 54331 54332; do
  for i in $(seq 1 60); do
    curl -s -o /dev/null "http://localhost:$port/" && break
    [ "$i" = 60 ] && { echo "FAIL: fake storage on port $port did not start"; exit 1; }
    sleep 0.5
  done
done

# A fingerprint of every row of the tables we keep (storage.objects without its random id and dates).
print() {
  local db="$1" t
  for t in $(q "$db" "select table_schema||'.'||table_name from information_schema.tables where table_type='BASE TABLE'
      and (table_schema='public' or table_schema||'.'||table_name in ('auth.users','auth.identities')) order by 1"); do
    echo "$t $(q "$db" "select count(*)||' '||coalesce(md5(string_agg(to_jsonb(x)::text, ',' order by to_jsonb(x)::text)),'-') from $t x")"
  done
  echo "objects $(q "$db" "select count(*)||' '||coalesce(md5(string_agg(bucket_id||'/'||name||'/'||coalesce(owner::text,'')||'/'||coalesce(owner_id,''), ',' order by name)),'-') from storage.objects")"
}
files_sum() { (cd "$1" && find . -type f -print0 | sort -z | xargs -0 sha256sum); }
ok() { echo "PASS: $1"; }
bad() { echo "FAIL: $1"; exit 1; }

print "$A" > "$T/before.txt"; files_sum "$T/files-a" > "$T/files-before.txt"

# 2. Back up.
FILE="$(SUPABASE_DB_URL="$A" SUPABASE_URL=http://localhost:54331 SUPABASE_SECRET_KEY="$KEY" OUT="$T/out" bash "$ROOT/scripts/backup/backup.sh" | tee "$T/backup.log" | tail -1)"
grep -q "photos could not be fetched" "$T/backup.log" && { cat "$T/backup.log"; bad "backup could not fetch every photo"; }
[ -s "$FILE" ] || bad "no backup file"
! grep -a -q "person-one" "$FILE" || bad "backup file is not encrypted"
BACKUP_PASSWORD="wrong" bash "$ROOT/scripts/backup/restore.sh" check "$FILE" >/dev/null 2>&1 && bad "opened with a wrong password"
bash "$ROOT/scripts/backup/restore.sh" check "$FILE" && ok "backup is encrypted, opens only with the password, checksums match"

# 3. new-project into the empty database B.
SUPABASE_DB_URL="$B" SUPABASE_URL=http://localhost:54332 SUPABASE_SECRET_KEY="$KEY" bash "$ROOT/scripts/backup/restore.sh" new-project "$FILE"
print "$B" > "$T/b.txt"
diff "$T/before.txt" "$T/b.txt" && ok "new-project: every table row matches" || bad "new-project rows differ"
files_sum "$T/files-b" | diff "$T/files-before.txt" - && ok "new-project: every photo matches" || bad "new-project photos differ"
SUPABASE_DB_URL="$B" bash "$ROOT/scripts/backup/restore.sh" new-project "$FILE" >/dev/null 2>&1 && bad "new-project ran on a project that has accounts"
ok "new-project refuses a project that already has accounts"

# 4. person: one person loses everything (account deleted: rows go with it), plus their photo files.
q "$A" "delete from storage.objects where owner = '$U1'"; rm -rf "$T/files-a/ride-photos/$U1"
q "$A" "delete from public.trail_reports where user_id = '$U1'" 2>/dev/null || true
q "$A" "delete from auth.users where id = '$U1'"
[ "$(q "$A" "select count(*) from public.rides where user_id='$U1'")" = 0 ] || bad "test setup: rides not gone"
SUPABASE_DB_URL="$A" SUPABASE_URL=http://localhost:54331 SUPABASE_SECRET_KEY="$KEY" bash "$ROOT/scripts/backup/restore.sh" person "$FILE" "$U1"
# "I agree" records are kept without the account when it is deleted (privacy page), and are never changed by a
# restore, so they stay unlinked: leave them out of this comparison.
print "$A" | grep -v '^public.tf_agreements ' | diff <(grep -v '^public.tf_agreements ' "$T/before.txt") - \
  && ok "person: account, rows and photo owners back exactly" || bad "person restore differs"
files_sum "$T/files-a" | diff "$T/files-before.txt" - && ok "person: photos back" || bad "person photos differ"
again="$(SUPABASE_DB_URL="$A" SUPABASE_URL=http://localhost:54331 SUPABASE_SECRET_KEY="$KEY" bash "$ROOT/scripts/backup/restore.sh" person "$FILE" "$U1")"
grep -q "Rows put back: 0." <<<"$again" && grep -q "Photos: 0 put back, 2 already there" <<<"$again" && ok "person: running it again adds nothing" || bad "second person run added rows"

# 5. missing: a cabin trip and a ride lost; person 3 deleted their account after the backup (must stay deleted).
q "$A" "delete from public.shared_trips where secret = 's1'"
q "$A" "delete from public.rides where id = 'r3'"
q "$A" "update public.settings set data = '{\"changed\":true}' where user_id = '$U2'"
q "$A" "delete from storage.objects where owner = '$U3'"; rm -rf "$T/files-a/point-photos"
q "$A" "delete from auth.users where id = '$U3'"
SUPABASE_DB_URL="$A" SUPABASE_URL=http://localhost:54331 SUPABASE_SECRET_KEY="$KEY" bash "$ROOT/scripts/backup/restore.sh" missing "$FILE"
[ "$(q "$A" "select count(*) from public.shared_trips where secret='s1'")" = 1 ] && ok "missing: lost cabin trip back" || bad "cabin trip not back"
[ "$(q "$A" "select count(*) from public.rides where id='r3'")" = 1 ] && ok "missing: lost ride back" || bad "ride not back"
[ "$(q "$A" "select data->>'changed' from public.settings where user_id='$U2'")" = true ] && ok "missing: newer changes are kept, never overwritten" || bad "overwrote a newer row"
[ "$(q "$A" "select count(*) from auth.users where id='$U3'")" = 0 ] && [ "$(q "$A" "select count(*) from public.rides where user_id='$U3'")" = 0 ] \
  && [ ! -e "$T/files-a/point-photos" ] && ok "missing: account deleted after the backup stays deleted (rows and photos)" || bad "deleted account came back"

q "$A" "delete from public.shared_trips where secret = 's2'"; q "$A" "delete from public.rides where id = 'r1'"
SUPABASE_DB_URL="$A" bash "$ROOT/scripts/backup/restore.sh" missing "$FILE" shared_trips
[ "$(q "$A" "select count(*) from public.shared_trips where secret='s2'")" = 1 ] && [ "$(q "$A" "select count(*) from public.rides where id='r1'")" = 0 ] \
  && ok "missing, one table: only that table is put back" || bad "one-table restore"

psql "$PGBASE/postgres" -X -q -c "drop database tf_backup_a" -c "drop database tf_backup_b"
echo "All backup and restore tests passed."

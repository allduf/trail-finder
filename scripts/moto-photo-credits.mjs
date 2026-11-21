// Moto route photos: the photographer and licence of each Wikipedia page picture (data rights check, 2026-11-20).
// Reads each picture's Artist and LicenseShortName from Wikipedia's API (which also answers for Commons files) and saves
// them on the photo as by and lic. A picture marked non-free (fair use on Wikipedia only) or with no licence is dropped.
// node scripts/moto-photo-credits.mjs            updates data/moto-routes.json in place
// build-moto-routes.mjs calls addPhotoCredits() before it writes the file.
import fs from 'node:fs';

const UA = { 'User-Agent': 'TrailFinder/1.0 (data build)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const plain = (h) => String(h || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

export async function addPhotoCredits(routes) {
  const file = (p) => decodeURIComponent(p.page.split('/wiki/File:')[1] || '').replace(/_/g, ' ');
  const withPhoto = routes.filter((r) => r.photo && r.photo.page);
  const names = [...new Set(withPhoto.map((r) => file(r.photo)).filter(Boolean))];
  const meta = {};
  for (let i = 0; i < names.length; i += 40) {
    const u = 'https://en.wikipedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=extmetadata'
      + '&iiextmetadatafilter=Artist|LicenseShortName|NonFree&titles=' + encodeURIComponent(names.slice(i, i + 40).map((n) => 'File:' + n).join('|'));
    let j = null; for (let k = 0; k < 4 && !j; k++) { try { j = await (await fetch(u, { headers: UA })).json(); } catch { await sleep(3000 * 2 ** k); } }
    if (!j) throw new Error('Wikipedia API did not answer');
    const back = {}; for (const m of j.query?.normalized || []) back[m.to] = m.from;
    for (const pg of Object.values(j.query?.pages || {})) {
      const em = pg.imageinfo?.[0]?.extmetadata || {}; const t = (back[pg.title] || pg.title).replace(/^File:/, '');
      meta[t] = { by: plain(em.Artist?.value), lic: plain(em.LicenseShortName?.value), nonFree: /true/i.test(em.NonFree?.value || '') };
    }
    await sleep(1000);
  }
  let kept = 0, dropped = 0;
  for (const r of withPhoto) {
    const m = meta[file(r.photo)];
    if (!m || m.nonFree || !m.lic) { delete r.photo; dropped++; continue; }
    r.photo.by = m.by || 'Unknown author'; r.photo.lic = m.lic; kept++;
  }
  console.error(`Moto photos: ${kept} credited, ${dropped} dropped (non-free or no licence).`);
  return routes;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const f = new URL('../data/moto-routes.json', import.meta.url);
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  await addPhotoCredits(d.routes);
  d.note = d.note.replace('photo from the Wikipedia source page', 'photo from the Wikipedia source page, with its author and licence');
  fs.writeFileSync(f, JSON.stringify(d));
}

// Runs on a schedule in GitHub Actions: reads the ThoughtDrop gist, pushes anything that just came due,
// marks it notified, and drops dead device subscriptions.
import webpush from 'web-push';

const { GIST_TOKEN, VAPID_PRIVATE_KEY } = process.env;
const FN = 'thoughtdrop.json';
if (!GIST_TOKEN || !VAPID_PRIVATE_KEY) { console.log('Secrets GIST_TOKEN / VAPID_PRIVATE_KEY not set yet — skipping.'); process.exit(0); }

const gh = async (path, opt = {}) => {
  const r = await fetch('https://api.github.com' + path, { ...opt, headers: { Authorization: `Bearer ${GIST_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opt.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json();
};

let id = '';
for (let p = 1; p <= 10 && !id; p++) {
  const list = await gh(`/gists?per_page=100&page=${p}`);
  id = (list.find(g => g.files && g.files[FN]) || {}).id || '';
  if (list.length < 100) break;
}
if (!id) { console.log('No ThoughtDrop gist found yet.'); process.exit(0); }

const g = await gh(`/gists/${id}`);
const f = g.files[FN];
const text = f.truncated ? await (await fetch(f.raw_url, { headers: { Authorization: `Bearer ${GIST_TOKEN}` } })).text() : f.content;
const data = JSON.parse(text);
const pub = data.settings && data.settings.vapid && data.settings.vapid.pub;
if (!pub) { console.log('No push key created in the app yet.'); process.exit(0); }
webpush.setVapidDetails('mailto:noreply@github.com', pub, VAPID_PRIVATE_KEY);
const subs = data.subs || {};
data.tomb ||= {};
const now = Date.now(), DAY = 864e5;

const due = (data.notes || []).filter(n => n.due && !n.done && !n.archived && !n.notified
  && Date.parse(n.due) <= now && Date.parse(n.due) > now - DAY);
console.log(`${due.length} due, ${Object.keys(subs).length} device(s)`);
if (!due.length) process.exit(0);

const dead = new Set();
for (const n of due) {
  const body = n.kind === 'list' ? n.title : n.text;
  const payload = JSON.stringify({ title: n.kind === 'task' ? 'Task due' : 'Reminder', body, tag: n.id, url: './#feed' });
  for (const [dev, s] of Object.entries(subs)) {
    if (dead.has(dev)) continue;
    try { await webpush.sendNotification(s.sub, payload, { TTL: 3600, urgency: 'high' }); }
    catch (e) {
      console.log(`push to ${s.name || dev} failed: ${e.statusCode || e.message}`);
      if (e.statusCode === 404 || e.statusCode === 410) dead.add(dev);
    }
  }
  n.notified = true; n.updated = now;
}
for (const dev of dead) { delete subs[dev]; data.tomb['sub-' + dev] = now; }

await gh(`/gists/${id}`, { method: 'PATCH', body: JSON.stringify({ files: { [FN]: { content: JSON.stringify(data) } } }) });
console.log('Gist updated.');

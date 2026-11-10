// Vercel serverless function: turns a Smart-fill prompt into a set of street furniture and a density.
// Needs ANTHROPIC_API_KEY in the project's environment. Without it the function answers 503 and the
// game falls back to reading the prompt by keywords in the browser.
const ITEMS = ['tree', 'bench', 'lamp', 'planter', 'fountain', 'plaza'];
const SYSTEM = [
  'You configure an auto-detail tool in a city builder game.',
  'The player describes how an area should feel. Choose which items to place and how densely.',
  `Items: ${ITEMS.join(', ')}.`,
  'Answer with JSON only, no prose, in this exact shape:',
  '{"items":{"tree":bool,"bench":bool,"lamp":bool,"planter":bool,"fountain":bool,"plaza":bool},"density":number}',
  'density is between 0.1 (sparse) and 1 (packed). Respect negations such as "no benches".',
].join('\n');

function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string') { try { return Promise.resolve(JSON.parse(req.body)); } catch { return Promise.resolve({}); } }
  return new Promise((resolve) => {
    let raw = ''; req.on('data', (c) => { raw += c; if (raw.length > 8000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ error: 'POST only' })); }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.statusCode = 503; return res.end(JSON.stringify({ error: 'not configured' })); }
  const body = await readBody(req), prompt = String(body.prompt || '').slice(0, 400).trim();
  if (!prompt) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'empty prompt' })); }
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5', max_tokens: 200, system: SYSTEM, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!r.ok) { res.statusCode = 502; return res.end(JSON.stringify({ error: `model answered ${r.status}` })); }
    const j = await r.json(), text = (j.content || []).map((c) => c.text || '').join(''), m = text.match(/\{[\s\S]*\}/);
    if (!m) { res.statusCode = 502; return res.end(JSON.stringify({ error: 'no JSON in the answer' })); }
    const out = JSON.parse(m[0]), items = {};
    for (const k of ITEMS) items[k] = !!(out.items && out.items[k]);
    if (!ITEMS.some((k) => items[k])) { items.tree = true; items.lamp = true; }
    const density = Math.min(1, Math.max(0.1, Number(out.density) || 0.5));
    res.statusCode = 200; res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ items, density }));
  } catch (e) {
    res.statusCode = 502; return res.end(JSON.stringify({ error: 'request failed' }));
  }
};

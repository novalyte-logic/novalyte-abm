const functions = require('@google-cloud/functions-framework');
const dns = require('node:dns').promises;
const net = require('node:net');

const PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.VITE_GOOGLE_PLACES_API_KEY || '';

const SOCIAL_HOSTS = [
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'yelp.com',
  'healthgrades.com',
  'zocdoc.com',
  'vitals.com',
  'webmd.com',
  'google.com',
  'goo.gl',
  'maps.google.com',
  'yellowpages.com',
  'bbb.org',
];

function cors(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function cleanWebsite(url) {
  if (!url) return null;
  const raw = String(url).trim();
  if (!raw) return null;
  const withProto = raw.startsWith('http') ? raw : `https://${raw}`;
  try {
    const u = new URL(withProto);
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function isSocialHost(host) {
  const h = String(host || '').toLowerCase();
  return SOCIAL_HOSTS.some(s => h === s || h.endsWith(`.${s}`) || h.includes(s));
}

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

async function fetchJson(url, opts = {}) {
  const { timeoutMs = 15000, headers = {}, method = 'GET', body } = opts;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method,
      headers,
      body,
      signal: ac.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      const err = new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
      err.status = resp.status;
      throw err;
    }
    return await resp.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url, timeoutMs = 12000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ac.signal,
      headers: {
        'User-Agent': 'NovalyteGoogleVerify/1.0 (+https://novalyte.io)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!resp.ok) return '';
    const ct = String(resp.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text/html') && !ct.includes('text/plain') && !ct.includes('application/xhtml+xml')) return '';
    return await resp.text();
  } catch {
    return '';
  } finally {
    clearTimeout(t);
  }
}

function extractEmailsFromText(text) {
  if (!text) return [];
  const re = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const found = text.match(re) || [];
  const cleaned = found
    .map(e => e.trim().replace(/[),.;:]+$/g, ''))
    .filter(e => e.length <= 254);

  // Filter obvious garbage.
  return uniq(
    cleaned.filter(e => {
      const lower = e.toLowerCase();
      if (lower.includes('example.com')) return false;
      if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif')) return false;
      return true;
    })
  );
}

function pickConfirmedEmail(foundEmails, officialHost) {
  const list = (foundEmails || []).slice();
  if (!list.length) return null;

  const host = String(officialHost || '').toLowerCase();
  if (host) {
    const sameDomain = list.filter(e => {
      const parts = e.split('@');
      const d = (parts[1] || '').toLowerCase().replace(/^www\./, '');
      return d === host || d.endsWith(`.${host}`);
    });
    if (sameDomain.length) return sameDomain[0];
  }

  return list[0];
}

async function placesDetails(placeId) {
  if (!PLACES_API_KEY || !placeId) return null;
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`;
  const data = await fetchJson(url, {
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': PLACES_API_KEY,
      'X-Goog-FieldMask': [
        'id',
        'displayName',
        'formattedAddress',
        'nationalPhoneNumber',
        'websiteUri',
      ].join(','),
    },
  });
  return {
    placeId: data?.id || placeId,
    name: data?.displayName?.text,
    address: data?.formattedAddress,
    phone: data?.nationalPhoneNumber,
    website: data?.websiteUri,
  };
}

async function placesSearchText(query) {
  if (!PLACES_API_KEY || !query) return [];
  const data = await fetchJson('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': PLACES_API_KEY,
      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.nationalPhoneNumber',
        'places.websiteUri',
      ].join(','),
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: 5,
    }),
  });

  return (data?.places || []).map(p => ({
    placeId: p?.id,
    name: p?.displayName?.text,
    address: p?.formattedAddress,
    phone: p?.nationalPhoneNumber,
    website: p?.websiteUri,
  }));
}

function parseEmail(email) {
  const raw = String(email || '').trim();
  const m = raw.match(/^([^@\s]+)@([^@\s]+)$/);
  if (!m) return null;
  return { email: raw, local: m[1], domain: m[2].toLowerCase() };
}

async function resolveMx(domain) {
  try {
    const mx = await dns.resolveMx(domain);
    return (mx || [])
      .map(r => ({ exchange: r.exchange, priority: r.priority }))
      .sort((a, b) => a.priority - b.priority);
  } catch {
    return [];
  }
}

function smtpDialogue({ host, fromEmail, toEmail, timeoutMs = 9000 }) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: 25 });
    let buffer = '';
    let stage = 0;
    let lastCode = null;
    let done = false;

    const finish = (result) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch {}
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, code: lastCode, message: 'timeout' });
    }, timeoutMs);

    const send = (line) => {
      try { socket.write(`${line}\r\n`); } catch {}
    };

    socket.on('error', (err) => {
      clearTimeout(timer);
      finish({ ok: false, code: lastCode, message: err?.message || 'socket error' });
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      // Process complete lines
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        const m = line.match(/^(\d{3})\s/);
        if (!m) continue;
        lastCode = Number(m[1]);

        // Some servers send multi-line replies; we keep it simple and advance on first code each stage.
        if (stage === 0 && lastCode >= 200 && lastCode < 400) {
          stage = 1;
          send(`HELO novalyte.io`);
        } else if (stage === 1 && lastCode >= 200 && lastCode < 400) {
          stage = 2;
          send(`MAIL FROM:<${fromEmail}>`);
        } else if (stage === 2 && lastCode >= 200 && lastCode < 400) {
          stage = 3;
          send(`RCPT TO:<${toEmail}>`);
        } else if (stage === 3) {
          clearTimeout(timer);
          // Common interpretation: 250 = accepted, 550/551/553 = rejected.
          if (lastCode >= 500) {
            finish({ ok: false, code: lastCode, message: line });
          } else if (lastCode >= 200 && lastCode < 400) {
            finish({ ok: true, code: lastCode, message: line });
          } else {
            finish({ ok: false, code: lastCode, message: line });
          }
          try { send('QUIT'); } catch {}
        }
      }
    });

    socket.on('connect', () => {
      // wait for banner
    });
  });
}

async function verifyEmailDeliverability(email) {
  const parsed = parseEmail(email);
  if (!parsed) {
    return { status: 'invalid', verified: false, reason: 'bad_syntax' };
  }

  const mx = await resolveMx(parsed.domain);
  if (!mx.length) {
    // Some domains (esp. consumer providers) use implicit MX via A, but for our purposes treat as not found.
    return { status: 'invalid', verified: false, reason: 'no_mx' };
  }

  // SMTP probing is best-effort. Many providers tarp it or accept-all.
  const mxHost = mx[0].exchange;
  const fromEmail = process.env.SMTP_FROM || 'verify@novalyte.io';

  const smtp = await smtpDialogue({ host: mxHost, fromEmail, toEmail: parsed.email });
  if (smtp.ok) {
    return { status: 'valid', verified: true, reason: 'smtp_accepted', mxHost, smtpCode: smtp.code };
  }

  // If SMTP is blocked/timeout/etc., treat as unknown rather than invalid.
  const msg = String(smtp.message || '');
  if (msg === 'timeout' || /connect|econn|timed out|socket/i.test(msg)) {
    return { status: 'unknown', verified: false, reason: 'smtp_unreachable', mxHost };
  }

  // Hard reject.
  if (smtp.code && smtp.code >= 550) {
    return { status: 'invalid', verified: false, reason: 'smtp_rejected', mxHost, smtpCode: smtp.code };
  }

  return { status: 'unknown', verified: false, reason: 'smtp_unknown', mxHost, smtpCode: smtp.code };
}

async function verifyClinic({ clinic, leadEmail }) {
  const clinicName = String(clinic?.name || '').trim();
  const city = String(clinic?.address?.city || clinic?.city || '').trim();
  const state = String(clinic?.address?.state || clinic?.state || '').trim();
  const placeId = String(clinic?.googlePlaceId || clinic?.placeId || '').trim();

  let officialWebsite = cleanWebsite(clinic?.website);
  let officialPlaceId = placeId || null;
  let place = null;

  // 1) Try Places details if we have a placeId.
  if (!officialWebsite && placeId) {
    try {
      place = await placesDetails(placeId);
      officialWebsite = cleanWebsite(place?.website);
      officialPlaceId = place?.placeId || placeId;
    } catch {
      // ignore
    }
  }

  // 2) Places text search fallback (clinic name + city/state)
  if (!officialWebsite && clinicName && (city || state)) {
    try {
      const q = `${clinicName} ${city ? `in ${city}` : ''}${state ? ` ${state}` : ''}`.trim();
      const results = await placesSearchText(q);
      if (results && results.length) {
        const best = results.find(r => r.website && !isSocialHost(hostnameOf(r.website))) || results[0];
        place = best;
        officialPlaceId = best.placeId || officialPlaceId;
        officialWebsite = cleanWebsite(best.website);
      }
    } catch {
      // ignore
    }
  }

  // Bail early if we still have no usable website.
  const host = officialWebsite ? hostnameOf(officialWebsite) : '';
  if (officialWebsite && isSocialHost(host)) {
    officialWebsite = null;
  }

  const pages = [];
  if (officialWebsite) {
    try {
      const u = new URL(officialWebsite);
      pages.push(u.toString());
      const base = `${u.protocol}//${u.host}`;
      pages.push(`${base}/contact`);
      pages.push(`${base}/contact-us`);
      pages.push(`${base}/about`);
      pages.push(`${base}/team`);
      pages.push(`${base}/staff`);
    } catch {
      // ignore
    }
  }

  const htmls = await Promise.all(uniq(pages).slice(0, 5).map(p => fetchText(p)));
  const foundEmails = uniq(htmls.flatMap(extractEmailsFromText));
  const confirmedEmail = pickConfirmedEmail(foundEmails, host);

  // Deliverability checks (best-effort) for the lead email and the confirmed email.
  const deliverability = {};
  const lead = leadEmail ? String(leadEmail).trim().toLowerCase() : '';
  if (lead) deliverability.leadEmail = await verifyEmailDeliverability(lead);
  if (confirmedEmail) deliverability.confirmedEmail = await verifyEmailDeliverability(confirmedEmail);

  // Status mapping expected by UI:
  // - Verified: the relevant email is deliverable/valid AND matches the official confirmed email when available
  // - Mismatch: an official email exists but differs, or the provided email is not deliverable
  // - Not Found: no official email discovered on the official website
  let status = 'Not Found';
  if (lead) {
    if (confirmedEmail && confirmedEmail.toLowerCase() === lead) {
      status = deliverability.leadEmail?.status === 'valid' ? 'Verified' : 'Mismatch';
    } else if (confirmedEmail || foundEmails.length) {
      status = 'Mismatch';
    } else {
      status = 'Not Found';
    }
  } else {
    if (confirmedEmail) {
      status = deliverability.confirmedEmail?.status === 'valid' ? 'Verified' : 'Mismatch';
    } else {
      status = 'Not Found';
    }
  }

  return {
    status,
    officialWebsite: officialWebsite || null,
    officialPlaceId,
    foundEmails,
    confirmedEmail: confirmedEmail || null,
    deliverability,
    checkedAt: new Date().toISOString(),
    place,
  };
}

functions.http('googleVerifyHandler', async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const action = String(body.action || '').toLowerCase();

    if (action === 'verify_email') {
      const email = String(body.email || '').trim();
      const result = await verifyEmailDeliverability(email);
      return res.json({ ok: true, action: 'verify_email', email, result, checkedAt: new Date().toISOString() });
    }

    if (action === 'verify_clinic') {
      const result = await verifyClinic({ clinic: body.clinic || {}, leadEmail: body.leadEmail || null });
      return res.json({ ok: true, action: 'verify_clinic', ...result });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action. Use verify_clinic or verify_email.' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

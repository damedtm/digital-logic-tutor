import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- Config ----
const CLASS_PASSCODE = process.env.CLASS_PASSCODE || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const MAX_MESSAGES_PER_WINDOW = Number(process.env.RATE_LIMIT_MAX || 60);
const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60 * 60 * 1000); // 1 hour
const MAX_HISTORY_TURNS = 20; // trim long conversations before sending to the API

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, 'system-prompt.txt'),
  'utf8'
);

// Prompt caching
const SYSTEM_BLOCKS = [
  {
    type: 'text',
    text: SYSTEM_PROMPT,
    cache_control: { type: 'ephemeral' },
  },
];

if (!CLASS_PASSCODE) {
  console.warn('WARNING: CLASS_PASSCODE is not set — anyone can use this bot.');
}
if (!ANTHROPIC_API_KEY) {
  console.warn('WARNING: ANTHROPIC_API_KEY is not set — /api/chat will fail.');
}

// Rolling window rate limiter
const hits = new Map();
function isRateLimited(key) {
  const now = Date.now();
  const timestamps = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (timestamps.length >= MAX_MESSAGES_PER_WINDOW) {
    hits.set(key, timestamps); // still prune expired entries
    return true;
  }
  timestamps.push(now);
  hits.set(key, timestamps);
  return false;
}

//Cache usage tracking 
const cacheStats = {
  requests: 0,
  cacheReadTokens: 0,   // tokens served from cache, billed at ~10% of normal input price
  cacheWriteTokens: 0,  // tokens written to cache (first request / cache miss), billed at ~1.25x
  freshInputTokens: 0,  // uncached input tokens (the per-message dynamic part)
  outputTokens: 0,
};

function trackCacheUsage(usage) {
  if (!usage) return;
  cacheStats.requests += 1;
  cacheStats.cacheReadTokens += usage.cache_read_input_tokens || 0;
  cacheStats.cacheWriteTokens += usage.cache_creation_input_tokens || 0;
  cacheStats.freshInputTokens += usage.input_tokens || 0;
  cacheStats.outputTokens += usage.output_tokens || 0;
}

// Stats endpoint 
app.get('/api/cache-stats', (req, res) => {
  const providedCode = req.get('X-Class-Passcode') || '';
  if (!CLASS_PASSCODE || providedCode !== CLASS_PASSCODE) {
    return res.status(401).json({ error: 'invalid_passcode' });
  }
  const cacheHitRate = cacheStats.requests
    ? (cacheStats.cacheReadTokens / (cacheStats.cacheReadTokens + cacheStats.cacheWriteTokens + cacheStats.freshInputTokens) * 100).toFixed(1)
    : '0.0';
  res.json({ ...cacheStats, cacheHitRatePercent: Number(cacheHitRate) });
});

//Chat endpoint 
app.post('/api/chat', async (req, res) => {
  const providedCode = req.get('X-Class-Passcode') || '';
  if (!CLASS_PASSCODE || providedCode !== CLASS_PASSCODE) {
    return res.status(401).json({ error: 'invalid_passcode' });
  }

  const clientKey = req.get('X-Client-Id') || req.ip;
  if (isRateLimited(clientKey)) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  const { messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'missing_messages' });
  }

  const trimmed = messages.slice(-MAX_HISTORY_TURNS).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 4000),
  }));

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        system: SYSTEM_BLOCKS,
        messages: trimmed,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(502).json({ error: 'upstream_error' });
    }

    const data = await response.json();
    const reply = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    trackCacheUsage(data.usage);

    res.json({ reply: reply || "I didn't catch that — could you rephrase?" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Digital Logic Tutor running on http://localhost:${PORT}`);
});

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '2mb' }));

// CORS & Cache Busting Headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.path.includes('/api/') || req.path.includes('-room') || req.path.includes('-answer')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

// HTML File Resolver
function serveHtml(filename, res) {
  const candidates = [
    path.resolve(__dirname, 'public', filename),
    path.join(process.cwd(), 'public', filename),
    path.resolve(__dirname, filename),
    path.join(process.cwd(), filename)
  ];

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }
  }
  return res.status(404).send(`Cannot find ${filename} in public or root directory.`);
}

app.get(['/', '/host', '/host.html'], (req, res) => serveHtml('host.html', res));
app.get(['/player', '/player.html'], (req, res) => serveHtml('player.html', res));

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '0' }));
app.use(express.static(__dirname, { maxAge: '0' }));

// In-Memory Storage
const rooms = new Map();

function shuffleOptions(item) {
  if (!item || !Array.isArray(item.options) || item.options.length < 2) return item;
  const indices = item.options.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const newOptions = indices.map(idx => item.options[idx]);
  const newAnswer = indices.indexOf(Number(item.answer));
  return { ...item, options: newOptions, answer: newAnswer >= 0 ? newAnswer : 0 };
}

// ----------------- HARDCODED API KEYS & RESOLVERS -----------------

// 1. PRIMARY: xAI (Grok)
const HARDCODED_XAI_KEY = 'xai-qAAAn7YE4usKnBtRTGHLeR3TgTuaVHcwJMuUIFaevwQeMUh7ykuZchFVHARhmwcVvZ9l6O9beJrn9nzW';

// 2. FALLBACK 1: Google Gemini
const HARDCODED_GEMINI_KEY = 'AQ.Ab8RN6LVQQdawFKFisAxNJK0qdK7LieandMIjlT3WVFTI2jyBQ';

// 3. FALLBACK 2: OpenAI
const HARDCODED_OPENAI_KEY = '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';

function getXAIApiKeys() {
  const keys = [];
  const envVal = (process.env.XAI_API_KEY || process.env.GROK_API_KEY || '').trim();
  if (envVal) {
    keys.push(...envVal.split(',').map(k => k.trim()).filter(Boolean));
  }
  if (HARDCODED_XAI_KEY && !keys.includes(HARDCODED_XAI_KEY)) {
    keys.push(HARDCODED_XAI_KEY);
  }
  return keys;
}

function getGeminiApiKeys() {
  const keys = [];
  const envVal = process.env.GEMINI_API_KEY || '';
  if (envVal) {
    keys.push(...envVal.split(',').map(k => k.trim()).filter(Boolean));
  }
  if (HARDCODED_GEMINI_KEY && !keys.includes(HARDCODED_GEMINI_KEY)) {
    keys.push(HARDCODED_GEMINI_KEY);
  }
  ['GEMINI_API_KEY_2', 'GEMINI_API_KEY_3', 'GEMINI_BACKUP_KEY'].forEach(envName => {
    const val = (process.env[envName] || '').trim();
    if (val && !keys.includes(val)) keys.push(val);
  });
  return keys;
}

function getOpenAIApiKeys() {
  const keys = [];
  const envVal = process.env.OPENAI_API_KEY || '';
  if (envVal) {
    keys.push(...envVal.split(',').map(k => k.trim()).filter(Boolean));
  }
  if (HARDCODED_OPENAI_KEY && !keys.includes(HARDCODED_OPENAI_KEY)) {
    keys.push(HARDCODED_OPENAI_KEY);
  }
  ['OPENAI_API_KEY_2', 'OPENAI_BACKUP_KEY'].forEach(envName => {
    const val = (process.env[envName] || '').trim();
    if (val && !keys.includes(val)) keys.push(val);
  });
  return keys;
}

// ----------------- AI CALLERS -----------------

// 1. xAI (Grok) - PRIMARY ENGINE
async function callXAIWithKeys(apiKeys, prompt) {
  const models = ['grok-beta', 'grok-2', 'grok-2-latest'];
  let lastErr = null;

  for (let kIdx = 0; kIdx < apiKeys.length; kIdx++) {
    const apiKey = apiKeys[kIdx];
    console.log(`[xAI Engine] Attempting with xAI Key #${kIdx + 1}...`);

    for (const m of models) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 14000);

      try {
        const res = await fetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey.trim()}`
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: m,
            messages: [
              {
                role: 'system',
                content: 'You are a professional trivia generator. Generate authentic, real trivia questions matching the topics exactly. Output ONLY a valid JSON array of question objects without markdown backticks or commentary.'
              },
              { role: 'user', content: prompt }
            ],
            temperature: 0.65
          })
        });

        clearTimeout(timeout);
        const data = await res.json();

        if (!res.ok) {
          lastErr = new Error(data?.error?.message || `xAI status ${res.status}`);
          console.warn(`[xAI Engine] Key #${kIdx + 1} with model ${m} failed: ${lastErr.message}`);
          if (res.status === 429 || res.status === 403 || res.status === 401) {
            break;
          }
          continue;
        }

        let text = data.choices?.[0]?.message?.content || '';
        text = text.trim();

        if (text.startsWith('```json')) text = text.slice(7);
        if (text.startsWith('```')) text = text.slice(3);
        if (text.endsWith('```')) text = text.slice(0, -3);
        text = text.trim();

        const s = text.indexOf('[');
        const e = text.lastIndexOf(']');
        if (s !== -1 && e !== -1) text = text.substring(s, e + 1);

        const parsed = JSON.parse(text);
        if (Array.isArray(parsed) && parsed.length > 0) {
          console.log(`✅ [xAI SUCCESS] Generated ${parsed.length} questions using ${m}!`);
          return parsed.map(shuffleOptions);
        }
      } catch (e) {
        clearTimeout(timeout);
        lastErr = e;
        console.warn(`[xAI Engine] Model ${m} attempt error: ${e.message}`);
      }
    }
  }

  throw lastErr || new Error('All xAI models and keys exhausted');
}

// 2. Google Gemini - FALLBACK 1
async function callGeminiWithKeys(apiKeys, prompt) {
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
  let lastErr = null;

  for (let kIdx = 0; kIdx < apiKeys.length; kIdx++) {
    const apiKey = apiKeys[kIdx];
    console.log(`[Gemini Engine] Trying Gemini API Key #${kIdx + 1}...`);

    for (const model of models) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 14000);

      try {
        const url = `[https://generativelanguage.googleapis.com/v1beta/models/$](https://generativelanguage.googleapis.com/v1beta/models/$){model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            systemInstruction: {
              parts: [{
                text: "You are a professional trivia generator. You write authentic, factual trivia strictly tied to specific real-world topics. Never generate placeholder or boilerplate templates."
              }]
            },
            generationConfig: {
              temperature: 0.6,
              maxOutputTokens: 8192,
              responseMimeType: 'application/json'
            }
          })
        });

        clearTimeout(timeout);
        const data = await res.json();

        if (!res.ok) {
          lastErr = new Error(data?.error?.message || `Gemini status ${res.status}`);
          console.warn(`[Gemini Engine] Key #${kIdx + 1} with model ${model} failed: ${lastErr.message}`);
          if (res.status === 429 || res.status === 403 || res.status === 400) {
            break;
          }
          continue;
        }

        let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        text = text.trim();

        if (text.startsWith('```json')) text = text.slice(7);
        if (text.startsWith('```')) text = text.slice(3);
        if (text.endsWith('```')) text = text.slice(0, -3);
        text = text.trim();

        const s = text.indexOf('[');
        const e = text.lastIndexOf(']');
        if (s !== -1 && e !== -1) text = text.substring(s, e + 1);

        const parsed = JSON.parse(text);
        if (Array.isArray(parsed) && parsed.length > 0) {
          console.log(`✅ [Gemini SUCCESS] Generated ${parsed.length} questions using Key #${kIdx + 1} & model ${model}`);
          return parsed.map(shuffleOptions);
        }
      } catch (e) {
        clearTimeout(timeout);
        lastErr = e;
        console.warn(`[Gemini Engine] Key #${kIdx + 1} with model ${model} error: ${e.message}`);
      }
    }
  }

  throw lastErr || new Error('All Gemini API keys and models exhausted');
}

// 3. OpenAI - FALLBACK 2
async function callOpenAIWithKeys(apiKeys, prompt) {
  let lastErr = null;

  for (let kIdx = 0; kIdx < apiKeys.length; kIdx++) {
    const apiKey = apiKeys[kIdx];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 13000);

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are an authentic trivia engine. Return ONLY a valid JSON array of 20 trivia question objects directly testing knowledge of the assigned topics.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.6
        })
      });

      clearTimeout(timeout);
      const data = await res.json();
      if (!res.ok) {
        lastErr = new Error(data?.error?.message || `OpenAI status ${res.status}`);
        console.warn(`[OpenAI Engine] Key #${kIdx + 1} failed: ${lastErr.message}`);
        continue;
      }

      let text = data.choices?.[0]?.message?.content || '';
      text = text.trim();
      if (text.startsWith('```json')) text = text.slice(7);
      if (text.startsWith('```')) text = text.slice(3);
      if (text.endsWith('```')) text = text.slice(0, -3);
      text = text.trim();

      const s = text.indexOf('[');
      const e = text.lastIndexOf(']');
      if (s !== -1 && e !== -1) text = text.substring(s, e + 1);

      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.length > 0) {
        console.log(`✅ [OpenAI SUCCESS] Generated ${parsed.length} questions using Key #${kIdx + 1}`);
        return parsed.map(shuffleOptions);
      }
    } catch (err) {
      clearTimeout(timeout);
      lastErr = err;
      console.warn(`[OpenAI Engine] Key #${kIdx + 1} error: ${err.message}`);
    }
  }

  throw lastErr || new Error('All OpenAI keys exhausted');
}

// ----------------- COMPLETE GENERATION PIPELINE -----------------

async function generateQuizQuestions(t1, t2, t3) {
  const xaiKeys = getXAIApiKeys();
  const geminiKeys = getGeminiApiKeys();
  const openaiKeys = getOpenAIApiKeys();

  const topic1 = (t1 && t1.trim()) || 'World Cinema';
  const topic2 = (t2 && t2.trim()) || 'World Geography';
  const topic3 = (t3 && t3.trim()) || 'Modern Science';

  console.log(`[Diagnostic] Generating questions for:`);
  console.log(`  Tier 1 (EASY): "${topic1}" (8 Qs)`);
  console.log(`  Tier 2 (MODERATE): "${topic2}" (6 Qs)`);
  console.log(`  Tier 3 (HARD): "${topic3}" (6 Qs)`);
  console.log(`  Available Keys -> xAI (Primary): ${xaiKeys.length}, Gemini: ${geminiKeys.length}, OpenAI: ${openaiKeys.length}`);

  const prompt = `You are a trivia quiz master. Write exactly 20 authentic, factual, well-researched multiple choice questions based specifically on the following user-provided topics:

TOPIC BREAKDOWN:
- 8 EASY questions strictly on the topic: "${topic1}"
  * Level: "EASY"
  * Criteria: Widely known facts, famous names, memorable milestones, or iconic elements of "${topic1}".
- 6 MODERATE questions strictly on the topic: "${topic2}"
  * Level: "MODERATE"
  * Criteria: Intermediate trivia, specific records, technical details, or notable moments requiring solid knowledge of "${topic2}".
- 6 HARD questions strictly on the topic: "${topic3}"
  * Level: "HARD"
  * Criteria: Deep trivia, obscure details, niche achievements, or advanced facts about "${topic3}".

CRITICAL INSTRUCTIONS:
1. Every question MUST explicitly test real trivia about the exact named topic. Never write generic, placeholder, or template questions.
2. Provide exactly 4 realistic, plausible multiple-choice options per question.
3. The "answer" field must be the integer index (0, 1, 2, or 3) representing the correct choice in the "options" array.
4. Distribute the correct answer across indices 0, 1, 2, and 3 (do not make 0 the answer every time).
5. Output ONLY a valid JSON array of 20 objects. No markdown backticks, no comments, no explanation.

JSON format:
[
  {
    "question": "Clear, factual question text specifically about the topic?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "answer": 1,
    "level": "EASY"
  }
]`;

  // 1. PRIMARY: Try xAI (Grok) First
  if (xaiKeys.length > 0) {
    try {
      console.log(`[Engine] Calling xAI (Grok) as primary...`);
      const q = await callXAIWithKeys(xaiKeys, prompt);
      if (q && q.length >= 10) return q;
    } catch (e) {
      console.warn(`⚠️ [xAI Primary Failed]: ${e.message}`);
    }
  }

  // 2. FALLBACK 1: Try Google Gemini
  if (geminiKeys.length > 0) {
    try {
      console.log(`[Engine] Falling back to Google Gemini...`);
      const q = await callGeminiWithKeys(geminiKeys, prompt);
      if (q && q.length >= 10) return q;
    } catch (e) {
      console.warn(`⚠️ [Gemini Fallback Failed]: ${e.message}`);
    }
  }

  // 3. FALLBACK 2: Try OpenAI
  if (openaiKeys.length > 0) {
    try {
      console.log(`[Engine] Falling back to OpenAI...`);
      const q = await callOpenAIWithKeys(openaiKeys, prompt);
      if (q && q.length >= 10) return q;
    } catch (e) {
      console.warn(`⚠️ [OpenAI Fallback Failed]: ${e.message}`);
    }
  }

  throw new Error("All AI providers (xAI, Gemini, OpenAI) failed to generate questions. Check API key status or network limits.");
}

// ----------------- API ENDPOINTS -----------------

// Create Room
app.post(['/api/create-room', '/create-room'], async (req, res) => {
  try {
    const { customPin, mode, manualQuestions, topic1, topic2, topic3 } = req.body || {};
    const pin = (customPin && String(customPin).trim()) || Math.floor(100000 + Math.random() * 900000).toString();

    let questions = [];
    if (mode === 'manual' && Array.isArray(manualQuestions) && manualQuestions.length > 0) {
      questions = manualQuestions.map((q, idx) => ({
        index: idx + 1,
        question: q.question,
        options: q.options,
        answer: Number(q.answer),
        level: q.level || 'CUSTOM'
      }));
    } else {
      questions = await generateQuizQuestions(topic1, topic2, topic3);
    }

    rooms.set(pin, {
      pin,
      questions,
      currentIndex: 0,
      state: 'LOBBY',
      revealedAnswer: null,
      players: {},
      answersThisRound: {},
      createdAt: Date.now()
    });

    console.log(`Room [${pin}] established with ${questions.length} questions.`);
    return res.status(200).json({ success: true, pin, count: questions.length });
  } catch (err) {
    console.error('Create Room Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Room Status (Host & Player polling)
app.get(['/api/room-status', '/room-status'], (req, res) => {
  const pin = String(req.query.pin || '').trim();
  const room = rooms.get(pin);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const playerList = Object.values(room.players);
  const currentQ = (room.currentIndex > 0 && room.currentIndex <= room.questions.length)
    ? room.questions[room.currentIndex - 1]
    : null;

  return res.status(200).json({
    pin: room.pin,
    state: room.state,
    currentIndex: room.currentIndex,
    totalQuestions: room.questions.length,
    playerCount: playerList.length,
    players: playerList.map(p => p.name),
    responsesCount: Object.keys(room.answersThisRound).length,
    question: currentQ ? {
      index: room.currentIndex,
      total: room.questions.length,
      level: currentQ.level,
      question: currentQ.question,
      options: currentQ.options
    } : null,
    revealedAnswer: room.revealedAnswer,
    leaderboard: [...playerList].sort((a, b) => b.score - a.score)
  });
});

// Host Actions: NEXT, REVEAL, END
app.post(['/api/host-action', '/host-action'], (req, res) => {
  const { pin, action } = req.body || {};
  const room = rooms.get(String(pin || '').trim());
  if (!room) return res.status(404).json({ error: 'Room not found' });

  if (action === 'NEXT') {
    if (room.currentIndex >= room.questions.length) {
      room.state = 'FINISHED';
    } else {
      room.currentIndex++;
      room.state = 'QUESTION';
      room.revealedAnswer = null;
      room.answersThisRound = {};
    }
  } else if (action === 'REVEAL') {
    if (room.currentIndex > 0 && room.currentIndex <= room.questions.length) {
      room.state = 'REVEAL';
      room.revealedAnswer = room.questions[room.currentIndex - 1].answer;
    }
  } else if (action === 'END') {
    room.state = 'FINISHED';
  }

  return res.status(200).json({ success: true, state: room.state, currentIndex: room.currentIndex });
});

// Player Join
app.post(['/api/join-room', '/join-room'], (req, res) => {
  const { pin, name } = req.body || {};
  const room = rooms.get(String(pin || '').trim());
  if (!room) return res.status(404).json({ error: 'Invalid PIN. Room not found.' });

  const cleanName = String(name || '').trim() || 'Player';
  const playerKey = cleanName.toLowerCase();

  if (!room.players[playerKey]) {
    room.players[playerKey] = { name: cleanName, score: 0, correctCount: 0 };
  }

  return res.status(200).json({ success: true, name: cleanName, score: room.players[playerKey].score });
});

// Player Submit Answer
app.post(['/api/submit-answer', '/submit-answer'], (req, res) => {
  const { pin, name, answerIndex } = req.body || {};
  const room = rooms.get(String(pin || '').trim());
  if (!room || room.state !== 'QUESTION') return res.status(400).json({ error: 'Not accepting answers' });

  const playerKey = String(name || '').trim().toLowerCase();
  if (room.answersThisRound[playerKey] !== undefined) {
    return res.status(200).json({ message: 'Answer already submitted' });
  }

  room.answersThisRound[playerKey] = answerIndex;
  const currentQ = room.questions[room.currentIndex - 1];
  if (currentQ && answerIndex === currentQ.answer) {
    if (room.players[playerKey]) {
      room.players[playerKey].score += 100;
      room.players[playerKey].correctCount++;
    }
  }

  return res.status(200).json({ success: true });
});

// Catch-all 404
app.use((req, res) => {
  if (req.path.startsWith('/api/') || req.method === 'POST') {
    return res.status(404).json({ success: false, error: `Endpoint not found: ${req.method} ${req.path}` });
  }
  return res.status(404).send('Page not found');
});

// Local dev listener
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Quiz server active on port ${PORT}`);
  });
}

module.exports = app;

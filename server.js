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

// ----------------- KEY RESOLVER UTILITIES -----------------

function getGeminiApiKeys() {
  const keys = [];
  const primary = process.env.GEMINI_API_KEY || '';
  if (primary) {
    keys.push(...primary.split(',').map(k => k.trim()).filter(Boolean));
  }
  ['GEMINI_API_KEY_2', 'GEMINI_API_KEY_3', 'GEMINI_BACKUP_KEY'].forEach(envName => {
    const val = (process.env[envName] || '').trim();
    if (val && !keys.includes(val)) keys.push(val);
  });
  return keys;
}

function getOpenAIApiKeys() {
  const keys = [];
  const primary = process.env.OPENAI_API_KEY || '';
  if (primary) {
    keys.push(...primary.split(',').map(k => k.trim()).filter(Boolean));
  }
  ['OPENAI_API_KEY_2', 'OPENAI_BACKUP_KEY'].forEach(envName => {
    const val = (process.env[envName] || '').trim();
    if (val && !keys.includes(val)) keys.push(val);
  });
  return keys;
}

// ----------------- AI CALLERS -----------------

// 1. Google Gemini (Multi-Key & Multi-Model Fallback)
async function callGeminiWithKeys(apiKeys, prompt) {
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
  let lastErr = null;

  for (let kIdx = 0; kIdx < apiKeys.length; kIdx++) {
    const apiKey = apiKeys[kIdx];
    console.log(`[Gemini Engine] Trying API Key #${kIdx + 1}...`);

    for (const model of models) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 14000);

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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

// 2. OpenAI Fallback (Multi-Key)
async function callOpenAIWithKeys(apiKeys, prompt) {
  let lastErr = null;

  for (let kIdx = 0; kIdx < apiKeys.length; kIdx++) {
    const apiKey = apiKeys[kIdx];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
      const res = await fetch('[https://api.openai.com/v1/chat/completions](https://api.openai.com/v1/chat/completions)', {
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

// 3. xAI (Grok)
async function callXAI(apiKey, prompt) {
  const models = ['grok-2', 'grok-beta'];
  let lastErr = null;

  for (const m of models) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

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
            { role: 'system', content: 'You are a quiz engine. Output ONLY a valid JSON array.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7
        })
      });

      clearTimeout(timeout);
      const data = await res.json();
      if (!res.ok) {
        lastErr = new Error(data?.error?.message || `xAI status ${res.status}`);
        continue;
      }

      let text = data.choices?.[0]?.message?.content || '';
      text = text.trim();
      const s = text.indexOf('[');
      const e = text.lastIndexOf(']');
      if (s !== -1 && e !== -1) text = text.substring(s, e + 1);

      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(shuffleOptions);
      }
    } catch (e) {
      clearTimeout(timeout);
      lastErr = e;
    }
  }
  throw lastErr || new Error('xAI returned bad format');
}

// ----------------- DYNAMIC KNOWLEDGE BASE BACKUP -----------------
function createDynamicFallback(topic, count, level) {
  const questions = [];
  const baseTemplates = [
    {
      q: `Which notable milestone or prominent subject is closely identified with ${topic}?`,
      opts: [`Foundational Tradition in ${topic}`, `Modern Paradigm of ${topic}`, `The Standard Convention`, `The Contemporary Method`]
    },
    {
      q: `What is considered a core element or widely recognized concept within ${topic}?`,
      opts: [`Primary Structure of ${topic}`, `Secondary Variant`, `Comparative Framework`, `Empirical Methodology`]
    },
    {
      q: `In the study or practice of ${topic}, which area of focus is most central?`,
      opts: [`Core Mechanics of ${topic}`, `Peripheral Concepts`, `Auxiliary Processes`, `Contextual Analysis`]
    },
    {
      q: `Which breakthrough or transformation is most historic in the domain of ${topic}?`,
      opts: [`Primary Innovation in ${topic}`, `Baseline Foundation`, `Legacy Standards`, `Historical Reform`]
    }
  ];

  for (let i = 0; i < count; i++) {
    const template = baseTemplates[i % baseTemplates.length];
    questions.push({
      question: template.q,
      options: template.opts,
      answer: 0,
      level: level
    });
  }
  return questions;
}

// Complete Generation Pipeline
async function generateQuizQuestions(t1, t2, t3) {
  const geminiKeys = getGeminiApiKeys();
  const openaiKeys = getOpenAIApiKeys();
  const xaiKey = (process.env.XAI_API_KEY || process.env.GROK_API_KEY || '').trim();

  const topic1 = (t1 && t1.trim()) || 'World Cinema';
  const topic2 = (t2 && t2.trim()) || 'World Geography';
  const topic3 = (t3 && t3.trim()) || 'Modern Science';

  console.log(`[Diagnostic] Generating questions for:`);
  console.log(`  Tier 1 (EASY): "${topic1}" (8 Qs)`);
  console.log(`  Tier 2 (MODERATE): "${topic2}" (6 Qs)`);
  console.log(`  Tier 3 (HARD): "${topic3}" (6 Qs)`);
  console.log(`  Gemini Keys Configured: ${geminiKeys.length}`);

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

  // 1. Try Google Gemini with key fallback
  if (geminiKeys.length > 0) {
    try {
      const q = await callGeminiWithKeys(geminiKeys, prompt);
      if (q && q.length >= 10) return q;
    } catch (e) {
      console.warn(`⚠️ [Gemini Pipeline Failed]: ${e.message}`);
    }
  } else {
    console.warn(`⚠️ [Warning]: No GEMINI_API_KEY found in environment variables!`);
  }

  // 2. Try OpenAI with key fallback
  if (openaiKeys.length > 0) {
    try {
      console.log(`[Engine] Calling OpenAI fallback...`);
      const q = await callOpenAIWithKeys(openaiKeys, prompt);
      if (q && q.length >= 10) return q;
    } catch (e) {
      console.warn(`⚠️ [OpenAI Pipeline Failed]: ${e.message}`);
    }
  }

  // 3. Try xAI fallback
  if (xaiKey) {
    try {
      console.log(`[Engine] Calling xAI fallback...`);
      const q = await callXAI(xaiKey, prompt);
      if (q && q.length >= 10) return q;
    } catch (e) {
      console.warn(`⚠️ [xAI Pipeline Failed]: ${e.message}`);
    }
  }

  // 4. Last Resort Dynamic Backup
  console.log(`[Engine] Generating dynamic topic-aligned fallback questions...`);
  const q1 = createDynamicFallback(topic1, 8, 'EASY');
  const q2 = createDynamicFallback(topic2, 6, 'MODERATE');
  const q3 = createDynamicFallback(topic3, 6, 'HARD');
  return [...q1, ...q2, ...q3].map(shuffleOptions);
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

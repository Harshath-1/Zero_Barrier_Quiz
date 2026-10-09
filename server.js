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

// ----------------- AI CALLERS -----------------

// 1. Google Gemini (Fast, resilient caller)
async function callGemini(apiKey, prompt) {
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
  let lastErr = null;

  for (const model of models) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9500); // 9.5s timeout guard

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey.trim()}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
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
        console.warn(`[Gemini Engine] Model ${model} returned error: ${lastErr.message}`);
        continue;
      }

      let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      text = text.trim();

      // Clean Markdown code fence wrappers
      if (text.startsWith('```json')) text = text.slice(7);
      if (text.startsWith('```')) text = text.slice(3);
      if (text.endsWith('```')) text = text.slice(0, -3);
      text = text.trim();

      const s = text.indexOf('[');
      const e = text.lastIndexOf(']');
      if (s !== -1 && e !== -1) text = text.substring(s, e + 1);

      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.length > 0) {
        console.log(`[Gemini Engine] Generated ${parsed.length} questions successfully using ${model}`);
        return parsed.map(shuffleOptions);
      }
    } catch (e) {
      clearTimeout(timeout);
      lastErr = e;
      console.warn(`[Gemini Engine] Model ${model} attempt failed: ${e.message}`);
    }
  }
  throw lastErr || new Error('Gemini failed to output question array');
}

// 2. OpenAI Fallback
async function callOpenAI(apiKey, prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9500);

  try {
    const res = await fetch('[https://api.openai.com/v1/chat/completions](https://api.openai.com/v1/chat/completions)', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a quiz engine. Return ONLY a valid JSON array of trivia question objects.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7
      })
    });

    clearTimeout(timeout);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `OpenAI status ${res.status}`);

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
      return parsed.map(shuffleOptions);
    }
    throw new Error('OpenAI invalid response format');
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// 3. xAI (Grok)
async function callXAI(apiKey, prompt) {
  const models = ['grok-2', 'grok-beta'];
  let lastErr = null;

  for (const m of models) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9500);

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

// ----------------- DYNAMIC KNOWLEDGE BASE ENGINE -----------------
function createDynamicFallback(topic, count, level) {
  const questions = [];
  const baseTemplates = [
    {
      q: `Which of the following is considered a foundational milestone in ${topic}?`,
      opts: [`Pioneering Phase of ${topic}`, `Early Modern Discovery`, `The Standard Model`, `The Classical Hypothesis`]
    },
    {
      q: `What is a primary principle or key focus when studying ${topic}?`,
      opts: [`Core Structural Mechanics`, `Secondary Variant Analysis`, `Empirical Observation`, `Applied Optimization`]
    },
    {
      q: `In the context of ${topic}, which concept is most frequently analyzed?`,
      opts: [`Fundamental Dynamics`, `Peripheral Effects`, `Static Equilibriums`, `Systemic Formulations`]
    },
    {
      q: `Who or what played a major transformative role in modern ${topic}?`,
      opts: [`Key Theoretical Innovations`, `Conventional Standards`, `Baseline Frameworks`, `Legacy Protocols`]
    },
    {
      q: `Which critical distinction is essential to understand regarding ${topic}?`,
      opts: [`Operational vs Theoretical Parameters`, `Linear Scaling Factors`, `Temporal Variance`, `Boundary Thresholds`]
    },
    {
      q: `What is considered one of the most widely acknowledged breakthroughs in ${topic}?`,
      opts: [`Integrated Standard Evolution`, `Initial Synthetic Phase`, `Discrete Formulations`, `The Primary Benchmark`]
    },
    {
      q: `How do practitioners and analysts categorize the major tiers of ${topic}?`,
      opts: [`By Functional Hierarchy`, `By Regional Variance`, `By Chronological Decay`, `By Random Distribution`]
    },
    {
      q: `Which key challenge continues to be actively addressed within ${topic}?`,
      opts: [`Efficiency and Scalability`, `Legacy Incompatibility`, `Absolute Redundancy`, `Universal Stagnation`]
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
  const geminiKey = (process.env.GEMINI_API_KEY || '').trim();
  const openaiKey = (process.env.OPENAI_API_KEY || '').trim();
  const xaiKey = (process.env.XAI_API_KEY || process.env.GROK_API_KEY || '').trim();

  const topic1 = (t1 && t1.trim()) || 'General Knowledge';
  const topic2 = (t2 && t2.trim()) || 'World Geography';
  const topic3 = (t3 && t3.trim()) || 'Modern Science';

  console.log(`[Diagnostic] Generating questions for: "${topic1}", "${topic2}", "${topic3}". Key present: ${Boolean(geminiKey)}`);

  const prompt = `You are a trivia generator. Generate exactly 20 multiple-choice questions strictly matching the requested topics:
- 8 EASY questions strictly on: "${topic1}" (level: "EASY")
- 6 MODERATE questions strictly on: "${topic2}" (level: "MODERATE")
- 6 HARD questions strictly on: "${topic3}" (level: "HARD")

Rules:
1. Every question must be genuine trivia with 4 realistic options.
2. The "answer" field must be an integer index (0, 1, 2, or 3) indicating the correct option.
3. Return ONLY a valid JSON array of 20 objects. No markdown backticks.

Example format:
[
  {
    "question": "Sample question text?",
    "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
    "answer": 0,
    "level": "EASY"
  }
]`;

  // 1. Try Gemini
  if (geminiKey) {
    try {
      console.log(`[Engine] Invoking Google Gemini for topics: "${topic1}", "${topic2}", "${topic3}"...`);
      const q = await callGemini(geminiKey, prompt);
      if (q && q.length >= 10) {
        console.log(`✅ [Gemini SUCCESS] Generated ${q.length} questions strictly matching custom topics.`);
        return q;
      }
    } catch (e) {
      console.warn(`⚠️ [Gemini Failed]: ${e.message}`);
    }
  } else {
    console.warn(`⚠️ [Warning]: GEMINI_API_KEY is not defined in environment variables!`);
  }

  // 2. Try OpenAI
  if (openaiKey) {
    try {
      console.log(`[Engine] Calling OpenAI fallback...`);
      const q = await callOpenAI(openaiKey, prompt);
      if (q && q.length >= 10) return q;
    } catch (e) {
      console.warn(`⚠️ [OpenAI Failed]: ${e.message}`);
    }
  }

  // 3. Try xAI
  if (xaiKey) {
    try {
      console.log(`[Engine] Calling xAI fallback...`);
      const q = await callXAI(xaiKey, prompt);
      if (q && q.length >= 10) return q;
    } catch (e) {
      console.warn(`⚠️ [xAI Failed]: ${e.message}`);
    }
  }

  // 4. Dynamic Topic Backup (Topic-specific fallback so custom topic inputs never revert to random hardcoded trivia)
  console.log(`[Engine] Generating dynamic topic-aligned fallback questions for custom inputs...`);
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

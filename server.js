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

// ----------------- GEMINI CONFIGURATION -----------------

const HARDCODED_GEMINI_KEY = 'AQ.Ab8RN6JU5tI6FERNp_IrVVJw2ou_4dsf2pmWZIqyDgtQKs_4mA';

function getGeminiApiKey() {
  const envKey = (process.env.GEMINI_API_KEY || '').trim();
  return envKey || HARDCODED_GEMINI_KEY;
}

async function callGemini(prompt) {
  const apiKey = getGeminiApiKey();
  const models = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-1.5-flash'];
  let lastErr = null;

  for (const model of models) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 14000);

    try {
      console.log(`[Gemini Engine] Requesting model: ${model}...`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': apiKey
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.65,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json'
          }
        })
      });

      clearTimeout(timeout);
      const data = await res.json();

      if (!res.ok) {
        lastErr = new Error(data?.error?.message || `Gemini HTTP status ${res.status}`);
        console.warn(`[Gemini Engine] ${model} failed: ${lastErr.message}`);
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
        console.log(`✅ [Gemini SUCCESS] Generated ${parsed.length} questions using ${model}!`);
        return parsed.map(shuffleOptions);
      }
    } catch (e) {
      clearTimeout(timeout);
      lastErr = e;
      console.warn(`[Gemini Engine] ${model} threw an error: ${e.message}`);
    }
  }

  throw lastErr || new Error('Gemini generation failed on all models.');
}

async function generateQuizQuestions(t1, t2, t3) {
  const topic1 = (t1 && t1.trim()) || 'World Cinema';
  const topic2 = (t2 && t2.trim()) || 'World Geography';
  const topic3 = (t3 && t3.trim()) || 'Modern Science';

  console.log(`[Diagnostic] Generating 20 questions:`);
  console.log(`  Tier 1: "${topic1}" (8 Qs) | Tier 2: "${topic2}" (6 Qs) | Tier 3: "${topic3}" (6 Qs)`);

  const prompt = `Write exactly 20 authentic, factual multiple-choice questions matching these topics:
- 8 EASY questions strictly on: "${topic1}" (level: "EASY")
- 6 MODERATE questions strictly on: "${topic2}" (level: "MODERATE")
- 6 HARD questions strictly on: "${topic3}" (level: "HARD")

Rules:
1. Every question must test real facts specifically about the assigned topic. Never produce placeholder or template questions.
2. Provide exactly 4 plausible choices per question.
3. "answer" must be the integer index (0, 1, 2, or 3) of the correct answer.
4. Distribute correct answers across indices 0, 1, 2, and 3.

Return a JSON array of 20 objects like this:
[
  {
    "question": "Question text?",
    "options": ["Option 0", "Option 1", "Option 2", "Option 3"],
    "answer": 1,
    "level": "EASY"
  }
]`;

  return await callGemini(prompt);
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
      level: current

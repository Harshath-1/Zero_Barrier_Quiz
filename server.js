require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '2mb' }));

// CORS and Dynamic Cache-Buster headers
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

// Robust HTML file resolver targeting the public/ directory
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

// Static Direct Page Routes
app.get(['/', '/host', '/host.html'], (req, res) => {
  serveHtml('host.html', res);
});

app.get(['/player', '/player.html'], (req, res) => {
  serveHtml('player.html', res);
});

// Static assets (images, stylesheets, icons)
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '0' }));
app.use(express.static(__dirname, { maxAge: '0' }));

// In-Memory Room Registry
const rooms = new Map();

function shuffleOptions(item) {
  const indices = [0, 1, 2, 3];
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const newOptions = indices.map(idx => item.options[idx]);
  const newAnswer = indices.indexOf(item.answer);
  return { ...item, options: newOptions, answer: newAnswer };
}

// Fallback question generator strictly using the supplied topic names
function generateDynamicTopicFallback(topic1, topic2, topic3) {
  const generateQuestionsForTopic = (topic, count, level) => {
    const questions = [];
    const templates = [
      {
        q: (t) => `Which of the following is considered a core, fundamental concept of ${t}?`,
        opts: (t) => [`Core Element of ${t}`, `Secondary aspect of ${t}`, `Unrelated concept`, `General alternative`]
      },
      {
        q: (t) => `What major breakthrough or milestone is traditionally associated with ${t}?`,
        opts: (t) => [`Foundational achievement in ${t}`, `Recent minor development`, `Obsolete technique`, `Irrelevant milestone`]
      },
      {
        q: (t) => `Who among the following is historically recognized as an influential pioneer in ${t}?`,
        opts: (t) => [`Key historical pioneer of ${t}`, `Modern commentator`, `Independent observer`, `Unrelated historical figure`]
      },
      {
        q: (t) => `Which standard terminology is most commonly encountered in ${t}?`,
        opts: (t) => [`Standard term in ${t}`, `Hypothetical notation`, `Common slang`, `Colloquialism`]
      },
      {
        q: (t) => `In modern practice, what is considered the primary advantage of ${t}?`,
        opts: (t) => [`Primary distinct capability`, `Lower overall relevance`, `High complexity overhead`, `Limited applicability`]
      },
      {
        q: (t) => `What distinguishes standard approaches in ${t} from traditional methods?`,
        opts: (t) => [`Specialized principles of ${t}`, `Identical implementation`, `Strict randomness`, `Universal omission`]
      },
      {
        q: (t) => `Which of the following problems or challenges is most directly tackled by ${t}?`,
        opts: (t) => [`Critical domain challenges`, `Superficial styling issues`, `Unrelated network latency`, `Generic maintenance`]
      },
      {
        q: (t) => `What is universally recognized as the central objective in ${t}?`,
        opts: (t) => [`Optimization of core goals`, `Temporary experimentation`, `Random trial-and-error`, `Arbitrary variation`]
      }
    ];

    for (let i = 0; i < count; i++) {
      const template = templates[i % templates.length];
      questions.push({
        question: template.q(topic),
        options: template.opts(topic),
        answer: 0,
        level: level
      });
    }
    return questions;
  };

  const q1 = generateQuestionsForTopic(topic1, 8, 'EASY');
  const q2 = generateQuestionsForTopic(topic2, 6, 'MODERATE');
  const q3 = generateQuestionsForTopic(topic3, 6, 'HARD');

  return [...q1, ...q2, ...q3].map(shuffleOptions);
}

// 1. Primary Engine: xAI (Grok)
async function callXAI(apiKey, prompt) {
  const models = ['grok-2', 'grok-2-latest', 'grok-beta'];
  let lastError = null;

  for (const model of models) {
    try {
      console.log(`[xAI] Attempting model: ${model}...`);
      const res = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: 'You are an expert trivia quiz generator. Output ONLY a valid JSON array of question objects without markdown backticks.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7
        })
      });

      const data = await res.json();
      if (!res.ok) {
        lastError = new Error(data?.error?.message || `HTTP ${res.status}`);
        continue;
      }

      let text = data.choices?.[0]?.message?.content || '';
      text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
      const start = text.indexOf('[');
      const end = text.lastIndexOf(']');
      if (start !== -1 && end !== -1) text = text.substring(start, end + 1);

      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.length >= 10) {
        return parsed.map(shuffleOptions);
      }
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Invalid JSON structure returned by xAI');
}

// 2. Secondary Engine: OpenAI (ChatGPT gpt-4o-mini)
async function callOpenAI(apiKey, prompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey.trim()}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are an expert trivia quiz generator. Return only a raw JSON array of objects without markdown backticks.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);

  let text = data.choices?.[0]?.message?.content || '';
  text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end !== -1) text = text.substring(start, end + 1);

  const parsed = JSON.parse(text);
  if (Array.isArray(parsed) && parsed.length >= 10) {
    return parsed.map(shuffleOptions);
  }
  throw new Error('Invalid JSON structure returned by OpenAI');
}

// 3. Tertiary Engine: Google Gemini (gemini-2.0-flash / gemini-1.5-flash)
async function callGemini(apiKey, prompt) {
  // Try 2.0-flash, fallback to 1.5-flash
  const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
  let lastError = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey.trim()}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 8192
          }
        })
      });

      const data = await res.json();
      if (!res.ok) {
        lastError = new Error(data?.error?.message || `HTTP ${res.status}`);
        continue;
      }

      let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
      const start = rawText.indexOf('[');
      const end = rawText.lastIndexOf(']');
      if (start !== -1 && end !== -1) {
        rawText = rawText.substring(start, end + 1);
      }

      const parsed = JSON.parse(rawText);
      if (Array.isArray(parsed) && parsed.length >= 10) {
        return parsed.map(shuffleOptions);
      }
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Invalid JSON structure returned by Gemini');
}

// Complete Failover Chain: xAI -> OpenAI -> Gemini -> Dynamic Topic Engine
async function generateQuizQuestions(t1, t2, t3) {
  const xaiKey = (process.env.XAI_API_KEY || process.env.XAI_PRIMARY_KEY || process.env.API_KEY || process.env.GROK_API_KEY || '').trim();
  const openaiKey = (process.env.OPENAI_API_KEY || '').trim();
  const geminiKey = (process.env.GEMINI_API_KEY || '').trim();

  const topic1 = (t1 && t1.trim()) || 'Cinema';
  const topic2 = (t2 && t2.trim()) || 'History';
  const topic3 = (t3 && t3.trim()) || 'Geography';

  console.log(`[Config Check] Active Keys Found -> Gemini: ${Boolean(geminiKey)}, OpenAI: ${Boolean(openaiKey)}, xAI: ${Boolean(xaiKey)}`);

  const prompt = `Generate exactly 20 trivia questions strictly about the following three topics. Do NOT generate generic or unrelated questions.

Topic Distribution:
- 8 EASY questions strictly about: "${topic1}" (mark level as "EASY")
- 6 MODERATE questions strictly about: "${topic2}" (mark level as "MODERATE")
- 6 HARD questions strictly about: "${topic3}" (mark level as "HARD")

Return ONLY a raw JSON array of 20 objects. Every object must follow this structure:
[
  {
    "question": "question text strictly about the topic",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "answer": 0,
    "level": "EASY"
  }
]
Ensure "answer" is the 0-based integer index (0, 1, 2, or 3) corresponding to the correct option. Output ONLY the JSON array without any markdown formatting.`;

  // 1. Try xAI (Primary)
  if (xaiKey) {
    try {
      console.log(`[xAI Primary] Generating 20 questions for: ${topic1}, ${topic2}, ${topic3}...`);
      const questions = await callXAI(xaiKey, prompt);
      console.log(`✅ [xAI SUCCESS] Generated ${questions.length} questions.`);
      return questions;
    } catch (err) {
      console.warn(`⚠️ [xAI Failed]: ${err.message}. Passing to OpenAI...`);
    }
  }

  // 2. Try OpenAI (Second)
  if (openaiKey) {
    try {
      console.log(`[OpenAI Backup] Generating 20 questions for: ${topic1}, ${topic2}, ${topic3}...`);
      const questions = await callOpenAI(openaiKey, prompt);
      console.log(`✅ [OpenAI SUCCESS] Generated ${questions.length} questions.`);
      return questions;
    } catch (err) {
      console.warn(`⚠️ [OpenAI Failed]: ${err.message}. Passing to Gemini...`);
    }
  }

  // 3. Try Gemini (Third)
  if (geminiKey) {
    try {
      console.log(`[Gemini Backup] Generating 20 questions for: ${topic1}, ${topic2}, ${topic3}...`);
      const questions = await callGemini(geminiKey, prompt);
      console.log(`✅ [Gemini SUCCESS] Generated ${questions.length} questions.`);
      return questions;
    } catch (err) {
      console.warn(`⚠️ [Gemini Failed]: ${err.message}. Falling back to topic engine...`);
    }
  }

  // 4. Topic-Aware Dynamic Fallback
  console.log(`[Dynamic Engine] Generating 20 fallback questions specifically for: [${topic1}], [${topic2}], [${topic3}]`);
  return generateDynamicTopicFallback(topic1, topic2, topic3);
}

// ----------------- REST API ROUTES -----------------

// 1. Create Room (Supports both Manual & Topic modes)
app.post(['/api/create-room', '/create-room'], async (req, res) => {
  try {
    const { customPin, mode, manualQuestions, topic1, topic2, topic3 } = req.body || {};
    const pin = (customPin && String(customPin).trim()) || Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`[Session Setup] Resetting PIN: ${pin} | Mode: ${mode || 'topic'}`);

    if (rooms.has(pin)) {
      rooms.delete(pin);
    }

    let questions = [];

    if (mode === 'manual' && Array.isArray(manualQuestions) && manualQuestions.length > 0) {
      console.log(`[Manual Mode] Initialized with ${manualQuestions.length} host-defined questions.`);
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

    console.log(`✅ Room ${pin} initialized with ${questions.length} total questions.`);
    return res.status(200).json({ success: true, pin, count: questions.length });
  } catch (err) {
    console.error('[Create Room Error]:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Poll Room State (Host & Player)
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

// 3. Host Actions: Next, Reveal, End
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

// 4. Player Join
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

// 5. Player Answer Submit
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

// Catch-all 404 for unhandled API calls to always return JSON (never HTML doctype)
app.use((req, res) => {
  if (req.path.startsWith('/api/') || req.method === 'POST') {
    return res.status(404).json({ success: false, error: `Endpoint not found: ${req.method} ${req.path}` });
  }
  return res.status(404).send('Page not found');
});

// Server listener
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Quiz server running on port ${PORT}`);
  });
}

module.exports = app;

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '2mb' }));

// Prevent caching on dynamic state
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
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

// Direct Page Routes
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

// Built-in Categorized Trivia Library
const triviaLibrary = {
  cinema: [
    { question: "Which movie won the first-ever Academy Award for Best Picture in 1929?", options: ["Wings", "Sunrise", "The Jazz Singer", "Metropolis"], answer: 0 },
    { question: "Who directed the 2010 sci-fi mind-bender 'Inception'?", options: ["Christopher Nolan", "Steven Spielberg", "James Cameron", "Ridley Scott"], answer: 0 },
    { question: "What was the first feature-length animated movie ever released?", options: ["Snow White and the Seven Dwarfs", "Pinocchio", "Fantasia", "Bambi"], answer: 0 },
    { question: "Who portrayed Tony Stark in the Marvel Cinematic Universe?", options: ["Robert Downey Jr.", "Chris Evans", "Mark Ruffalo", "Tom Hiddleston"], answer: 0 },
    { question: "Which song from the movie RRR won the Oscar for Best Original Song?", options: ["Naatu Naatu", "Dosti", "Jai Ho", "Chhaiya Chhaiya"], answer: 0 },
    { question: "Which filmmaker directed the legendary 1972 crime film 'The Godfather'?", options: ["Francis Ford Coppola", "Martin Scorsese", "Stanley Kubrick", "Alfred Hitchcock"], answer: 0 },
    { question: "Who played Jack Dawson in the 1997 blockbuster movie 'Titanic'?", options: ["Leonardo DiCaprio", "Brad Pitt", "Johnny Depp", "Matt Damon"], answer: 0 },
    { question: "Which movie franchise features the fictional universe of 'Tatooine' and 'Endor'?", options: ["Star Wars", "Star Trek", "Dune", "Avatar"], answer: 0 }
  ],
  history: [
    { question: "In which year did World War II officially conclude?", options: ["1945", "1939", "1918", "1950"], answer: 0 },
    { question: "Who was the first President of the United States?", options: ["George Washington", "Thomas Jefferson", "Abraham Lincoln", "John Adams"], answer: 0 },
    { question: "Which ancient civilization constructed the Pyramids of Giza?", options: ["Ancient Egyptians", "Mesopotamians", "Mayans", "Romans"], answer: 0 },
    { question: "In which year did India declare independence from British rule?", options: ["1947", "1950", "1942", "1935"], answer: 0 },
    { question: "Who was the legendary Mauryan emperor who embraced Buddhism after Kalinga?", options: ["Ashoka", "Chandragupta Maurya", "Bindusara", "Samudragupta"], answer: 0 },
    { question: "Which treaty officially brought an end to World War I in 1919?", options: ["Treaty of Versailles", "Treaty of Paris", "Treaty of Utrecht", "Treaty of Ghent"], answer: 0 },
    { question: "In what year did the French Revolution break out?", options: ["1789", "1776", "1799", "1804"], answer: 0 },
    { question: "Who founded the Mongol Empire in the early 13th century?", options: ["Genghis Khan", "Kublai Khan", "Babur", "Timur"], answer: 0 }
  ],
  geography: [
    { question: "Which is the largest ocean on Earth by surface area?", options: ["Pacific Ocean", "Atlantic Ocean", "Indian Ocean", "Arctic Ocean"], answer: 0 },
    { question: "What is the capital city of Australia?", options: ["Canberra", "Sydney", "Melbourne", "Brisbane"], answer: 0 },
    { question: "Which is universally recognized as the longest river in the world?", options: ["Nile", "Amazon", "Yangtze", "Mississippi"], answer: 0 },
    { question: "Which desert is the largest hot desert on planet Earth?", options: ["Sahara Desert", "Gobi Desert", "Kalahari Desert", "Thar Desert"], answer: 0 },
    { question: "Which country contains the largest number of natural freshwater lakes?", options: ["Canada", "Russia", "Finland", "Sweden"], answer: 0 },
    { question: "What is the tallest mountain peak in the world above sea level?", options: ["Mount Everest", "K2", "Kangchenjunga", "Makalu"], answer: 0 },
    { question: "Through which European capital city does the River Seine flow?", options: ["Paris", "London", "Rome", "Madrid"], answer: 0 },
    { question: "Which country has the longest coastline in the world?", options: ["Canada", "Indonesia", "Norway", "Australia"], answer: 0 }
  ],
  technology: [
    { question: "Who co-founded Microsoft alongside Paul Allen in 1975?", options: ["Bill Gates", "Steve Jobs", "Larry Page", "Michael Dell"], answer: 0 },
    { question: "In web development, what does the acronym 'HTML' stand for?", options: ["HyperText Markup Language", "HyperTech Main Language", "HighText Machine Link", "HyperTool Multi Layer"], answer: 0 },
    { question: "What open-source operating system kernel was authored by Linus Torvalds?", options: ["Linux", "Unix", "FreeBSD", "Solaris"], answer: 0 },
    { question: "What does the 'S' represent in the secure network protocol 'HTTPS'?", options: ["Secure", "Standard", "System", "Server"], answer: 0 },
    { question: "Who created the World Wide Web while working at CERN in 1989?", options: ["Tim Berners-Lee", "Alan Turing", "Vint Cerf", "Marc Andreessen"], answer: 0 },
    { question: "Which programming language was developed by James Gosling at Sun Microsystems?", options: ["Java", "Python", "C#", "Ruby"], answer: 0 },
    { question: "What is the primary volatile memory used by computers for active tasks?", options: ["RAM", "ROM", "SSD", "Hard Disk"], answer: 0 },
    { question: "What was the name of the earliest packet-switching network predecessor to the Internet?", options: ["ARPANET", "ETHERNET", "USENET", "CYCLADES"], answer: 0 }
  ],
  sports: [
    { question: "Which country won the inaugural FIFA Men's World Cup in 1930?", options: ["Uruguay", "Argentina", "Brazil", "Italy"], answer: 0 },
    { question: "In tennis, what term represents a score of zero points?", options: ["Love", "Deuce", "Fault", "Nil"], answer: 0 },
    { question: "How many players are on the field for one team in a standard cricket match?", options: ["11", "10", "12", "9"], answer: 0 },
    { question: "Which athlete holds the world record for the 100m sprint at 9.58 seconds?", options: ["Usain Bolt", "Tyson Gay", "Yohan Blake", "Carl Lewis"], answer: 0 },
    { question: "In basketball, how many points is a successful basket made from beyond the arc worth?", options: ["3", "2", "4", "1"], answer: 0 },
    { question: "Which country has won the most Olympic gold medals in men's field hockey?", options: ["India", "Germany", "Australia", "Netherlands"], answer: 0 },
    { question: "What is the standard length of an Olympic swimming pool?", options: ["50 meters", "25 meters", "100 meters", "75 meters"], answer: 0 },
    { question: "In golf, what is the term for scoring one stroke under par on a hole?", options: ["Birdie", "Eagle", "Bogey", "Albatross"], answer: 0 }
  ],
  science: [
    { question: "What is the chemical formula for ordinary water?", options: ["H2O", "CO2", "NaCl", "CH4"], answer: 0 },
    { question: "Which planet in the solar system is situated closest to the Sun?", options: ["Mercury", "Venus", "Mars", "Earth"], answer: 0 },
    { question: "Which human organ is primarily responsible for pumping blood through the circulatory system?", options: ["Heart", "Lungs", "Liver", "Kidneys"], answer: 0 },
    { question: "What force keeps astronomical bodies orbiting around the Sun?", options: ["Gravity", "Magnetism", "Centrifugal force", "Electromagnetism"], answer: 0 },
    { question: "What is the hardest naturally occurring mineral substance on Earth?", options: ["Diamond", "Corundum", "Quartz", "Topaz"], answer: 0 },
    { question: "What gas do plants release into the atmosphere during photosynthesis?", options: ["Oxygen", "Carbon Dioxide", "Nitrogen", "Argon"], answer: 0 },
    { question: "What is the SI unit used for measuring electrical resistance?", options: ["Ohm", "Volt", "Ampere", "Joule"], answer: 0 },
    { question: "Which subatomic particle was discovered by J.J. Thomson in 1897?", options: ["Electron", "Neutron", "Proton", "Positron"], answer: 0 }
  ]
};

function getTopicQuestions(topicName, count, level) {
  const clean = (topicName || '').toLowerCase().trim();
  let matchedKey = Object.keys(triviaLibrary).find(k => clean.includes(k) || k.includes(clean));

  if (!matchedKey) {
    if (clean.includes('movie') || clean.includes('film') || clean.includes('bollywood') || clean.includes('hollywood')) matchedKey = 'cinema';
    else if (clean.includes('computer') || clean.includes('code') || clean.includes('software') || clean.includes('tech') || clean.includes('ai')) matchedKey = 'technology';
    else if (clean.includes('cricket') || clean.includes('football') || clean.includes('tennis') || clean.includes('sport')) matchedKey = 'sports';
    else if (clean.includes('earth') || clean.includes('country') || clean.includes('world') || clean.includes('map')) matchedKey = 'geography';
    else if (clean.includes('war') || clean.includes('ancient') || clean.includes('king') || clean.includes('history')) matchedKey = 'history';
    else matchedKey = 'science';
  }

  const pool = triviaLibrary[matchedKey] || triviaLibrary.science;
  const list = [];
  for (let i = 0; i < count; i++) {
    const item = pool[i % pool.length];
    list.push({
      question: `[${topicName}] ${item.question}`,
      options: [...item.options],
      answer: item.answer,
      level: level
    });
  }
  return list;
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
            { role: 'system', content: 'You are a quiz generator. Output ONLY a valid JSON array of question objects without markdown backticks.' },
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
      if (Array.isArray(parsed) && parsed.length >= 6) {
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
        { role: 'system', content: 'You are a quiz generator. Return only a raw JSON array of objects without markdown backticks.' },
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
  if (Array.isArray(parsed) && parsed.length >= 6) {
    return parsed.map(shuffleOptions);
  }
  throw new Error('Invalid JSON structure returned by OpenAI');
}

// 3. Tertiary Engine: Google Gemini (gemini-2.0-flash)
async function callGemini(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey.trim()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.7
      }
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);

  let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = rawText.indexOf('[');
  const end = rawText.lastIndexOf(']');
  if (start !== -1 && end !== -1) rawText = rawText.substring(start, end + 1);

  const parsed = JSON.parse(rawText);
  if (Array.isArray(parsed) && parsed.length >= 6) {
    return parsed.map(shuffleOptions);
  }
  throw new Error('Invalid JSON structure returned by Gemini');
}

// Complete Failover Chain: xAI -> OpenAI -> Gemini -> Local Library
async function generateQuizQuestions(t1, t2, t3) {
  const xaiKey = (process.env.XAI_API_KEY || process.env.XAI_PRIMARY_KEY || process.env.API_KEY || process.env.GROK_API_KEY || '').trim();
  const openaiKey = (process.env.OPENAI_API_KEY || '').trim();
  const geminiKey = (process.env.GEMINI_API_KEY || '').trim();

  const topic1 = (t1 && t1.trim()) || 'Cinema';
  const topic2 = (t2 && t2.trim()) || 'History';
  const topic3 = (t3 && t3.trim()) || 'Geography';

  const prompt = `Generate exactly 10 multiple-choice trivia questions as a JSON array of objects:
- 4 EASY questions on "${topic1}" with level "EASY"
- 3 MODERATE questions on "${topic2}" with level "MODERATE"
- 3 HARD questions on "${topic3}" with level "HARD"

Each object must follow this structure:
{
  "question": "string text of the question",
  "options": ["Option A", "Option B", "Option C", "Option D"],
  "answer": 0,
  "level": "EASY"
}
Ensure "answer" is the 0-based integer index (0, 1, 2, or 3) of the correct choice. Return ONLY the JSON array.`;

  // 1. Try xAI (Primary)
  if (xaiKey) {
    try {
      console.log(`[xAI Primary] Generating questions for: ${topic1}, ${topic2}, ${topic3}...`);
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
      console.log(`[OpenAI Backup] Generating questions for: ${topic1}, ${topic2}, ${topic3}...`);
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
      console.log(`[Gemini Backup] Generating questions for: ${topic1}, ${topic2}, ${topic3}...`);
      const questions = await callGemini(geminiKey, prompt);
      console.log(`✅ [Gemini SUCCESS] Generated ${questions.length} questions.`);
      return questions;
    } catch (err) {
      console.warn(`⚠️ [Gemini Failed]: ${err.message}. Falling back to internal engine...`);
    }
  }

  // 4. Final Local Fallback
  console.log(`[Topic Engine] Assembling fallback questions for: [${topic1}], [${topic2}], [${topic3}]`);
  const q1 = getTopicQuestions(topic1, 4, 'EASY');
  const q2 = getTopicQuestions(topic2, 3, 'MODERATE');
  const q3 = getTopicQuestions(topic3, 3, 'HARD');

  return [...q1, ...q2, ...q3].map(shuffleOptions);
}

// ----------------- REST API ROUTES -----------------

// 1. Create Room (Supports both Manual & Topic modes)
app.post('/api/create-room', async (req, res) => {
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
app.get('/api/room-status', (req, res) => {
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
app.post('/api/host-action', (req, res) => {
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
app.post('/api/join-room', (req, res) => {
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
app.post('/api/submit-answer', (req, res) => {
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

// Server listener
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Quiz server running on port ${PORT}`);
  });
}

module.exports = app;

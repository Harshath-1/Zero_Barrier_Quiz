require('dotenv').config();

async function testGemini() {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  console.log('Testing with key:', apiKey ? `${apiKey.substring(0, 8)}...` : 'MISSING');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Write 2 trivia questions about IPL Cricket in JSON format: [{\"question\": \"...\", \"options\": [\"A\",\"B\",\"C\",\"D\"], \"answer\": 0, \"level\": \"EASY\"}]" }] }]
      })
    });

    const data = await res.json();
    console.log('\n--- STATUS CODE ---:', res.status);
    console.log('\n--- FULL RESPONSE ---:\n', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
}

testGemini();
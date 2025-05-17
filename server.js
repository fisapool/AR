// server.js
// Express.js API for agentic research
// To start: run `npm install express` then `node server.js`

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { agenticResearch } = require('./agentic_research');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// POST /ask endpoint
app.post('/ask', async (req, res) => {
  const { question, summarizer } = req.body;
  if (!question) {
    return res.status(400).json({ error: 'Missing question' });
  }
  try {
    const result = await agenticResearch(question, summarizer || 'Local Python');
    res.json(result);
  } catch (err) {
    console.error('Error in /ask:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`)); 
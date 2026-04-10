/**
 * POST /api/ai
 *
 * Proxy to Anthropic Claude API.
 * Keeps the API key server-side — never exposed to the browser.
 *
 * Body: { messages: [{role, content}], system: string }
 * Returns: Claude's response
 */

const express = require('express');
const router  = express.Router();
const axios   = require('axios');

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

router.post('/', async (req, res) => {
  if (!ANTHROPIC_KEY) {
    return res.status(503).json({
      error: 'AI assistant not configured — add ANTHROPIC_API_KEY to Render environment variables'
    });
  }

  const { messages, system } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model:      'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system,
        messages,
      },
      {
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        timeout: 30_000,
      }
    );

    return res.json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    const msg    = err.response?.data?.error?.message || err.message;
    return res.status(status).json({ error: msg });
  }
});

module.exports = router;

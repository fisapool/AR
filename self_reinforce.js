const { agenticResearch } = require('./agentic_research');
const fs = require('fs');
const path = require('path');

// Helper: Generate a new research question using the local Python LLM or Gemini
async function generateResearchQuestion() {
  // Try Python LLM first, no Gemini fallback
  const prompt = 'Generate a novel, interesting research question in science or technology.';
  try {
    const summary = await summarizeWithPythonAPI(prompt);
    return summary.trim();
  } catch (e) {
    throw new Error('Python LLM failed to generate research question and Gemini fallback is disabled.');
  }
}

// Helper: Validate report using Ollama if available, else just return 'Not validated'
async function validateReport(question, report) {
  try {
    const { ollamaValidateReport } = require('./agentic_research');
    return await ollamaValidateReport(question, report);
  } catch (e) {
    return 'Not validated (Ollama not available)';
  }
}

// Helper: Log results to a file
function logResult(entry) {
  const logPath = path.join(__dirname, 'self_reinforce_log.json');
  let log = [];
  if (fs.existsSync(logPath)) {
    log = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
  }
  log.push(entry);
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf-8');
}

// Main self-reinforcement loop
async function selfReinforceLoop() {
  while (true) {
    try {
      const question = await generateResearchQuestion();
      console.log(`\n[Self-Reinforce] New research question: ${question}`);
      const result = await agenticResearch(question, 'Local Python');
      const validation = await validateReport(question, result.report);
      const entry = {
        timestamp: new Date().toISOString(),
        question,
        report: result.report,
        validation,
        nlpAnalysis: result.nlpAnalysis,
        steps: result.steps
      };
      logResult(entry);
      console.log('[Self-Reinforce] Research and validation complete. Sleeping 60 seconds...');
      await new Promise(res => setTimeout(res, 60000)); // Sleep 60 seconds between runs
    } catch (err) {
      console.error('[Self-Reinforce] Error in loop:', err);
      await new Promise(res => setTimeout(res, 30000)); // Sleep 30 seconds on error
    }
  }
}

// Import summarizeWithPythonAPI from agentic_research
const { summarizeWithPythonAPI } = require('./agentic_research');

// Start the loop
selfReinforceLoop(); 
const { agenticResearch } = require('./agentic_research');
const fs = require('fs');

const questions = [
  "What is AI?",
  "What are the benefits of renewable energy?",
  "Explain quantum computing in simple terms."
  // Add more questions here
];

(async () => {
  for (const question of questions) {
    console.log(`Processing: ${question}`);
    const result = await agenticResearch(question, "Local Python"); // or "Gemini"
    fs.writeFileSync(
      `result_${question.replace(/\W+/g, '_')}.json`,
      JSON.stringify(result, null, 2)
    );
    console.log(`Done: ${question}`);
  }
})(); 
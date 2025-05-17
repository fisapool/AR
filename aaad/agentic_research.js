async function ollamaAsk(prompt) {
  console.log("[Debug] Sending prompt to Python LLM first:\n", prompt);
  // 1. Try Python LLM first
  try {
    const pythonResult = await summarizeWithPythonAPI(prompt);
    if (pythonResult && pythonResult.trim() !== "") {
      return pythonResult;
    } else {
      console.warn("[Fallback] Python LLM returned empty. Trying Ollama.");
    }
  } catch (pyErr) {
    console.warn(`[Fallback] Python LLM failed (${pyErr.message}). Trying Ollama.`);
  }
  // 2. Try Ollama next
  try {
    const ollama = spawnSync('ollama', ['run', 'mistral'], { input: prompt, encoding: 'utf-8' });
    if (ollama.error || ollama.status !== 0 || !ollama.stdout || ollama.stdout.trim() === "") {
      throw new Error("Ollama not running or failed.");
    } else {
      const response = ollama.stdout;
      console.log("[Debug] Ollama response:\n", response);
      return response;
    }
  } catch (ollamaErr) {
    throw new Error(`[Error] Both Python LLM and Ollama failed: ${ollamaErr.message}`);
  }
}

async function getSubtopics(question) {
  try {
    const response = await axios.post('http://localhost:5000/subtopics', { question }, { timeout: 10000 });
    if (response.data.subtopics && response.data.subtopics.length > 0) {
      return response.data.subtopics;
    } else {
      throw new Error('No subtopics returned from Python API');
    }
  } catch (e) {
    throw new Error(`[Error] Python subtopics API failed and Gemini fallback is disabled: ${e.message}`);
  }
} 
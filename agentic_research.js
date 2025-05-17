require('dotenv').config();
const axios = require('axios');
const { execSync } = require('child_process');
const { spawnSync } = require('child_process');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const natural = require('natural');
const nlp = require('compromise');
const winkNLP = require('wink-nlp');
const model = require('wink-eng-lite-web-model');
const simpleStats = require('simple-statistics');
const wink = winkNLP(model);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY is not set in environment variables. Please add it to your .env file.');
}
const LOG_FILE = path.join(__dirname, 'research_log.json');

// === Cost Tracking ===
let geminiApiCalls = 0;
let geminiTokensPerCall = 2000; // estimate
let geminiInputCostPerM = 0.50;
let geminiOutputCostPerM = 1.50;
function estimateGeminiCost(calls) {
  const tokens = calls * geminiTokensPerCall;
  const inputCost = (tokens / 1_000_000) * geminiInputCostPerM;
  const outputCost = (tokens / 1_000_000) * geminiOutputCostPerM;
  return {
    calls,
    tokens,
    inputCost: inputCost.toFixed(4),
    outputCost: outputCost.toFixed(4),
    total: (inputCost + outputCost).toFixed(4)
  };
}

// === Local Summarizer Cost Tracking (Industry Standard) ===
let localSummarizerCalls = 0;
let localSummarizerTotalTime = 0; // in seconds
let localSummarizerCostPerSecond = 0.0002; // e.g., $0.0002/sec (configurable, based on cloud GPU pricing)
function estimateLocalSummarizerCost(calls, totalTime) {
  return {
    calls,
    totalTime: totalTime.toFixed(2),
    total: (totalTime * localSummarizerCostPerSecond).toFixed(4)
  };
}

async function ollamaAsk(prompt) {
  console.log("[Debug] Sending prompt to Ollama:\n", prompt);
  const ollama = spawnSync('ollama', ['run', 'mistral'], { input: prompt, encoding: 'utf-8' });
  const response = ollama.stdout;
  console.log("[Debug] Ollama response:\n", response);
  return response;
}

// New: Get subtopics from Ollama
async function ollamaSubtopics(question) {
  const prompt = `Given the research question: "${question}", list 5-7 key subtopics or aspects that should be covered to answer it comprehensively. Only return the subtopics, one per line.`;
  const response = await ollamaAsk(prompt);
  // Split by lines, filter empty
  return response.split('\n').map(s => s.trim()).filter(Boolean);
}

// New: For each subtopic, get relevant info from Gemini
async function getLinksFromGemini(query) {
  geminiApiCalls++;
  const prompt = `List 10 recent and relevant web links about: ${query}. Only provide direct URLs, one per line.`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
  const data = {
    contents: [{ parts: [{ text: prompt }] }]
  };
  const response = await axios.post(url, data, {
    headers: { 'Content-Type': 'application/json' }
  });
  const text = response.data.candidates[0].content.parts[0].text;
  // Extract URLs
  let urls = Array.from(text.matchAll(/https?:\/\/[^\s)]+/g), m => m[0]);
  urls = Array.from(new Set(urls)).filter(u => u.startsWith('http'));
  return urls.slice(0, 10); // Use top 10 links per subtopic
}

// New: Readability-based scraping
async function scrapePage(url) {
  try {
    const response = await axios.get(url, { timeout: 20000 });
    const dom = new JSDOM(response.data, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    return (article && article.textContent)
      ? article.textContent.slice(0, 3000)
      : dom.window.document.body.textContent.slice(0, 3000);
  } catch (e) {
    console.warn(`[Scrape] Failed to scrape: ${url} (${e.message})`);
    return '';
  }
}

async function geminiSummarizeContent(content, question, subtopic) {
  geminiApiCalls++;
  const prompt = `Summarize the following content for the subtopic: "${subtopic}" (related to the question: "${question}"). Only use information from the text.\n\n${content}`;
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
  const data = {
    contents: [{ parts: [{ text: prompt }] }]
  };
  const response = await axios.post(apiUrl, data, {
    headers: { 'Content-Type': 'application/json' }
  });
  return response.data.candidates[0].content.parts[0].text;
}

// Helper: Ask Ollama if the summary is sufficient for the subtopic
async function ollamaSubtopicSufficiency(question, subtopic, summary) {
  const prompt = `Given the research question: "${question}", the subtopic: "${subtopic}", and the following summary:\n${summary}\nIs this information sufficient to cover the subtopic? Answer "yes" or "no" and explain.`;
  return await ollamaAsk(prompt);
}

// New: Ollama validates the final report
async function ollamaValidateReport(question, report) {
  const prompt = `Given the research question: "${question}", validate the following report for completeness, accuracy, and structure. If it is lacking, suggest improvements.\n\nReport:\n${report}`;
  return await ollamaAsk(prompt);
}

function printProcessDiagram() {
  console.log(`\n=== Agentic Research Process (Subtopic Flow) ===\n\n1. User provides research question\n2. Ollama: Generate subtopics\n3. For each subtopic:\n   ├─ Gemini: Find & summarize info\n   ├─ Add summary to research log\n   └─ Ollama: Is info sufficient? (if yes, next subtopic)\n4. Gemini: Generate final report\n5. NLP/ML analysis of final report\n6. Output: Final Gemini Report (+ feedback)\n==============================================\n`);
}

// Clean and validate URLs before scraping
function cleanUrl(url) {
  // Remove markdown artifacts and trailing/leading whitespace
  return url.replace(/\]\(.*\)/, '').replace(/[)\]]+$/, '').replace(/^\[?/, '').trim();
}

// Try scraping a list of URLs, return the first successful {url, content}
async function tryScrapeUrls(urls) {
  let validCount = 0;
  for (const rawUrl of urls) {
    const url = cleanUrl(rawUrl);
    if (!url || url.includes('/error.htm?URL=')) continue; // skip known error pages
    try {
      const content = await scrapePage(url);
      if (content && content.length > 100) {
        validCount++;
        return { url, content, validCount, total: urls.length };
      }
    } catch (e) {
      console.warn(`[Scrape] Error scraping ${url}: ${e.message}`);
    }
  }
  return { url: null, content: null, validCount, total: urls.length };
}

// Helper: Load and save log
function loadLog() {
  if (fs.existsSync(LOG_FILE)) {
    return JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
  }
  return { runs: [], domainScores: {} };
}
function saveLog(log) {
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2), 'utf-8');
}

// Helper: Extract domain from URL
function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// Helper: Sentiment analysis (using natural)
const Analyzer = natural.SentimentAnalyzer;
const stemmer = natural.PorterStemmer;
const analyzer = new Analyzer('English', stemmer, 'afinn');

// Helper: Text similarity (cosine similarity of TF-IDF vectors)
function textSimilarity(a, b) {
  const tfidf = new natural.TfIdf();
  tfidf.addDocument(a);
  tfidf.addDocument(b);
  return tfidf.tfidf(tfidf.documents[0], 1); // similarity of doc0 to doc1
}

// Helper: Keyword extraction (top nouns)
function extractKeywords(text) {
  const doc = nlp(text);
  return doc.nouns().out('array');
}

// Helper: Named entity extraction (compromise)
function extractEntities(text) {
  const doc = nlp(text);
  return {
    people: doc.people().out('array'),
    organizations: doc.organizations().out('array'),
    places: doc.places().out('array')
  };
}

// Sort URLs by domain score (highest first)
function sortUrlsByDomainScore(urls, domainScores) {
  return urls.sort((a, b) => {
    const domainA = getDomain(a);
    const domainB = getDomain(b);
    return (domainScores[domainB] || 0) - (domainScores[domainA] || 0);
  });
}

// Main agentic research function (subtopic flow)
async function agenticResearch(question, summarizer = 'Local Python') {
  const researchStart = Date.now();
  let stepLogs = [];
  function logStep(msg) {
    stepLogs.push(msg);
    console.log(msg);
  }
  printProcessDiagram();
  logStep(`[Step 1] User provides research question: "${question}"`);
  // 1. Ask Ollama for subtopics
  const subtopics = await ollamaSubtopics(question);
  logStep(`[Step 2] Ollama subtopics: ${JSON.stringify(subtopics)}`);
  let researchLog = '';
  let runLog = { question, subtopics: [], finalReport: '', validation: '', timestamp: new Date().toISOString() };
  let logData = loadLog();
  for (const subtopic of subtopics) {
    logStep(`  [Step 3] Subtopic: ${subtopic}`);
    // 2. Use Gemini to get URLs for subtopic
    let urls = await getLinksFromGemini(subtopic);
    // Filter out blacklisted domains
    urls = urls.filter(u => {
      try {
        const d = getDomain(u);
        return !domainBlacklist.has(d);
      } catch {
        return false;
      }
    });
    // Adaptation: sort URLs by domain score before trying
    const sortedUrls = sortUrlsByDomainScore(urls, logData.domainScores);
    logStep(`    [Step 3] Sorted URLs by domain score: ${JSON.stringify(sortedUrls)}`);
    let summary = '';
    let usedUrl = null;
    let sufficiency = '';
    let attempt = 0;
    let maxAttempts = 3;
    let triedUrls = [];
    let insufficient = false;
    let lastContent = null;
    let lastUrl = null;
    // Helper to check if summary is low quality
    function isLowQualitySummary(text) {
      if (!text || text.length < 60) return true;
      const badPhrases = [
        'irrelevant', 'unhelpful', 'not found', 'cannot summarize',
        'no information', 'insufficient', 'missing', 'error', 'sorry', 'does not contribute'
      ];
      const lower = text.toLowerCase();
      return badPhrases.some(p => lower.includes(p));
    }
    // Retry loop for summarization
    while (attempt < maxAttempts) {
      let url = null, content = null, validCount = 0, total = 0;
      if (attempt === 0) {
        // First attempt: try scraping URLs
        ({ url, content, validCount, total } = await tryScrapeUrls(sortedUrls));
        lastContent = content;
        lastUrl = url;
        logStep(`    [Step 3] Tried ${total} URLs, ${validCount} valid for subtopic.`);
        if (content) {
          let sum;
          if (summarizer === 'Local Python') {
            sum = await summarizeWithPythonAPI(content);
          } else {
            sum = await geminiSummarizeContent(content, question, subtopic);
          }
          summary = `Source: ${url}\nSummary: ${sum}\n\n`;
          usedUrl = url;
          logStep(`    [Step 3] Successfully summarized content from: ${url}`);
        } else {
          // Penalize all domains for failed scraping
          sortedUrls.forEach(u => {
            const d = getDomain(u);
            logData.domainScores[d] = (logData.domainScores[d] || 0) - 2;
            blacklistDomain(d, logData);
          });
          // Fallback: Ask Gemini to summarize the subtopic directly
          geminiApiCalls++;
          logStep(`    [Step 3] All URLs failed for subtopic. Using Gemini direct fallback.`);
          const fallbackPrompt = `Provide a concise summary for the subtopic: "${subtopic}" (related to the research question: "${question}").`;
          const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
          const data = {
            contents: [{ parts: [{ text: fallbackPrompt }] }]
          };
          const response = await axios.post(apiUrl, data, {
            headers: { 'Content-Type': 'application/json' }
          });
          const fallbackSummary = response.data.candidates[0].content.parts[0].text;
          summary = `Source: Gemini Direct\nSummary: ${fallbackSummary}\n\n`;
          usedUrl = 'Gemini Direct';
          logStep(`    [Step 3] Used Gemini direct fallback for subtopic.`);
        }
      } else {
        // Retry: try next best URL (if any left)
        const remainingUrls = sortedUrls.filter(u => !triedUrls.includes(u));
        if (remainingUrls.length > 0) {
          ({ url, content, validCount, total } = await tryScrapeUrls(remainingUrls));
          lastContent = content;
          lastUrl = url;
          if (content) {
            let sum;
            if (summarizer === 'Local Python') {
              sum = await summarizeWithPythonAPI(content);
            } else {
              sum = await geminiSummarizeContent(content, question, subtopic);
            }
            summary = `Source: ${url}\nSummary: ${sum}\n\n`;
            usedUrl = url;
            logStep(`    [Step 3] Retry: Successfully summarized content from: ${url}`);
          } else {
            // Penalize all remaining domains for failed scraping
            remainingUrls.forEach(u => {
              const d = getDomain(u);
              logData.domainScores[d] = (logData.domainScores[d] || 0) - 2;
              blacklistDomain(d, logData);
            });
            // Fallback: Ask Gemini again with a more focused prompt
            geminiApiCalls++;
            logStep(`    [Step 3] Retry: All URLs failed again. Using Gemini direct fallback.`);
            const fallbackPrompt = `Try again: Provide a concise, relevant summary for the subtopic: "${subtopic}" (related to the research question: "${question}"). Focus on key facts and avoid irrelevant information.`;
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
            const data = {
              contents: [{ parts: [{ text: fallbackPrompt }] }]
            };
            const response = await axios.post(apiUrl, data, {
              headers: { 'Content-Type': 'application/json' }
            });
            const fallbackSummary = response.data.candidates[0].content.parts[0].text;
            summary = `Source: Gemini Direct\nSummary: ${fallbackSummary}\n\n`;
            usedUrl = 'Gemini Direct';
            logStep(`    [Step 3] Retry: Used Gemini direct fallback for subtopic.`);
          }
        } else {
          // No more URLs to try, break
          break;
        }
      }
      triedUrls.push(usedUrl);
      // 3. Ollama: Is info sufficient for this subtopic?
      sufficiency = await ollamaSubtopicSufficiency(question, subtopic, summary);
      logStep(`    [Step 3] Ollama sufficiency check: ${sufficiency}`);
      // If summary is low quality or insufficient, retry
      if (
        sufficiency.toLowerCase().includes('no') ||
        isLowQualitySummary(summary)
      ) {
        attempt++;
        logStep(`    [Step 3] Attempt ${attempt}: Info insufficient or summary low quality, retrying...`);
        insufficient = true;
        continue;
      } else {
        insufficient = false;
        break;
      }
    }
    if (insufficient) {
      summary += '\n[Warning: All attempts to get a sufficient summary for this subtopic failed. Please review or supplement manually.]\n';
    }
    researchLog += `Subtopic: ${subtopic}\n${summary}\n`;
    // Log this subtopic
    runLog.subtopics.push({ subtopic, urls, usedUrl, sufficiency, summary });
    // Update domain score
    if (usedUrl && usedUrl !== 'Gemini Direct') {
      const domain = getDomain(usedUrl);
      if (!logData.domainScores[domain]) logData.domainScores[domain] = 0;
      if (sufficiency.toLowerCase().includes('yes')) logData.domainScores[domain] += 1;
      else logData.domainScores[domain] -= 1;
    }
    if (sufficiency.toLowerCase().includes('yes')) {
      logStep(`    [Step 3] Ollama says info is sufficient for subtopic.`);
    } else {
      logStep(`    [Step 3] Ollama says more info may be needed for subtopic.`);
    }
  }
  // 4. Gemini: Generate the final report
  // Build a full prompt for Gemini with all subtopic summaries
  let missingNotes = '';
  runLog.subtopics.forEach(sub => {
    if (
      sub.sufficiency.toLowerCase().includes('no') ||
      sub.summary.includes('[Warning: All attempts to get a sufficient summary')
    ) {
      missingNotes += `- Subtopic "${sub.subtopic}" is missing or insufficient. Please try to infer or supplement this section.\n`;
    }
  });
  const finalReportPrompt = `Given the research question: "${question}"
  and the following subtopic summaries:
  ${researchLog}
  ${missingNotes ? 'Note: Some subtopics are missing or insufficient. ' + missingNotes : ''}
  Please write a 300-word report addressing the research question, synthesizing the information from the subtopic summaries above. Structure the report clearly and concisely. If any subtopic is missing, try to infer or supplement the information as best as possible.`;
  logStep(`[Step 4] Gemini final report prompt:\n${finalReportPrompt}`);

  let finalReport;
  if (summarizer === 'Local Python') {
    // Use local Python LLM for final report synthesis
    finalReport = await summarizeWithPythonAPI(finalReportPrompt);
  } else {
    // Use Gemini for final report synthesis
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
    const data = {
      contents: [{ parts: [{ text: finalReportPrompt }] }]
    };
    const response = await axios.post(apiUrl, data, {
      headers: { 'Content-Type': 'application/json' }
    });
    finalReport = response.data.candidates[0].content.parts[0].text;
  }
  logStep(`\n[Step 5] [Agent] Final Report:\n${finalReport}\n`);
  runLog.finalReport = finalReport;

  // 5. NLP/ML Analysis instead of Ollama validation
  // Prepare summaries for analysis
  const summaries = runLog.subtopics.map(s => s.summary.replace(/^Source:.*?\nSummary: /, '').trim());
  // Text similarity (each summary vs. final report)
  const similarities = summaries.map(s => textSimilarity(s, finalReport));
  // Sentiment analysis
  const sentiments = summaries.map(s => analyzer.getSentiment(s.split(' ')));
  const reportSentiment = analyzer.getSentiment(finalReport.split(' '));
  // Keyword extraction
  const summaryKeywords = summaries.map(s => extractKeywords(s));
  const reportKeywords = extractKeywords(finalReport);

  const nlpAnalysis = {
    textSimilarity: similarities,
    sentiment: { summaries: sentiments, report: reportSentiment },
    keywords: { summaries: summaryKeywords, report: reportKeywords },
    readability: 0,
    entities: extractEntities(finalReport)
  };

  // Self-learning: adjust domain scores based on similarity
  const SIMILARITY_THRESHOLD = 0.2;
  runLog.subtopics.forEach((sub, i) => {
    if (sub.usedUrl && sub.usedUrl !== 'Gemini Direct') {
      const domain = getDomain(sub.usedUrl);
      if (!logData.domainScores[domain]) logData.domainScores[domain] = 0;
      if (similarities[i] >= SIMILARITY_THRESHOLD) {
        logData.domainScores[domain] += 1;
        stepLogs.push(`[Self-Learning] Increased domain score for ${domain} (similarity ${similarities[i].toFixed(2)})`);
      } else {
        logData.domainScores[domain] -= 1;
        stepLogs.push(`[Self-Learning] Decreased domain score for ${domain} (similarity ${similarities[i].toFixed(2)})`);
      }
    }
  });

  // Save log
  logData.runs.push(runLog);
  saveLog(logData);
  // Print domain scores for review
  logStep('\n[Self-Learning] Domain scores so far: ' + JSON.stringify(logData.domainScores));
  logStep("==============================================\nProcess complete.\n");
  // Build citations/resources section
  let citations = '\n\n### Citations and Resources\n';
  runLog.subtopics.forEach((sub, i) => {
    citations += `- ${sub.subtopic}: `;
    if (sub.usedUrl && sub.usedUrl !== 'Gemini Direct') {
      citations += `[${sub.usedUrl}](${sub.usedUrl})\n`;
    } else {
      citations += 'Gemini Direct summary\n';
    }
  });
  // At the end, estimate and log cost
  const geminiCost = estimateGeminiCost(geminiApiCalls);
  logStep(`\n[Cost Tracking] Gemini API calls: ${geminiApiCalls}, Estimated tokens: ${geminiCost.tokens}, Estimated cost: $${geminiCost.total}`);
  // Estimate and log local summarizer cost (industry standard)
  const localSummarizerCost = estimateLocalSummarizerCost(localSummarizerCalls, localSummarizerTotalTime);
  logStep(`[Cost Tracking] Local Python Summarizer calls: ${localSummarizerCalls}, Total time: ${localSummarizerTotalTime.toFixed(2)}s, Estimated cost: $${localSummarizerCost.total}`);
  // Track total research run time
  const researchTotalTime = (Date.now() - researchStart) / 1000;
  logStep(`[Cost Tracking] Total research run time: ${researchTotalTime.toFixed(2)}s`);
  // Return all details for API or further analysis
  return {
    report: finalReport + citations,
    nlpAnalysis,
    log: runLog.subtopics,
    steps: stepLogs,
    domainScores: logData.domainScores,
    geminiCost,
    localSummarizerCost,
    researchTotalTime: researchTotalTime.toFixed(2)
  };
}

// Example usage:
// (async () => {
//   const rl = readline.createInterface({
//     input: process.stdin,
//     output: process.stdout
//   });
//   rl.question('Enter your research question: ', async (researchQuestion) => {
//     await agenticResearch(researchQuestion);
//     rl.close();
//   });
// })();

module.exports = { agenticResearch };

// === Python ML Integration (Summarization & Q&A) ===

/**
 * Summarize text using local Python API (summarize_api.py)
 * @param {string} text
 * @returns {Promise<string>} summary
 */
async function summarizeWithPythonAPI(text) {
  localSummarizerCalls++;
  const start = Date.now();
  const response = await axios.post('http://localhost:5000/summarize', { text });
  localSummarizerTotalTime += (Date.now() - start) / 1000;
  return response.data.summary;
}

/**
 * Question Answering using local Python API (summarize_api.py with /qa endpoint)
 * @param {string} context - The context or passage to answer from
 * @param {string} question - The question to answer
 * @returns {Promise<string>} answer
 */
async function qaWithPythonAPI(context, question) {
  const response = await axios.post('http://localhost:5000/qa', { context, question });
  return response.data.answer;
}

// Usage examples:
// summarizeWithPythonAPI("Your long text here...").then(summary => console.log("Summary from Python API:", summary));
// qaWithPythonAPI("Context passage here...", "What is the main idea?").then(answer => console.log("Answer from Python API:", answer));
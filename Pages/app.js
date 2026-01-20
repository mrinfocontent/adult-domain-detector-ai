// ===============================
// Elements
// ===============================
const analyzeBtn = document.getElementById("analyzeBtn");
const resultDiv = document.getElementById("result");
const apiKeyInput = document.getElementById("apiKey");
const saveKeyBtn = document.getElementById("saveKey");
const providerSelect = document.getElementById("aiProvider");

let adultDomains = [];

// ===============================
// Load adult domains
// ===============================
fetch(chrome.runtime.getURL("../data/adult-domains.json"))
  .then(res => res.json())
  .then(data => adultDomains = data)
  .catch(() => adultDomains = []);

// ===============================
// Load saved settings
// ===============================
chrome.storage.sync.get(
  ["aiProvider", "openaiKey", "groqKey", "geminiKey"],
  res => {
    providerSelect.value = res.aiProvider || "openai";
    apiKeyInput.value =
      res[providerSelect.value + "Key"] || "";
  }
);

// ===============================
// Provider change
// ===============================
providerSelect.addEventListener("change", () => {
  chrome.storage.sync.get(
    ["openaiKey", "groqKey", "geminiKey"],
    res => {
      apiKeyInput.value =
        res[providerSelect.value + "Key"] || "";
    }
  );
});

// ===============================
// Save settings
// ===============================
saveKeyBtn.addEventListener("click", () => {
  const provider = providerSelect.value;
  const key = apiKeyInput.value.trim();

  chrome.storage.sync.set({
    aiProvider: provider,
    [`${provider}Key`]: key
  }, () => alert("Settings saved"));
});

// ===============================
// Analyze
// ===============================
analyzeBtn.addEventListener("click", async () => {
  const text = document.getElementById("description").value.trim();
  resultDiv.innerHTML = "";

  if (!text) {
    resultDiv.textContent = "Please paste a description.";
    return;
  }

  const domains = extractDomains(text);
  const localMatches = localDetection(domains, text);

  const { aiProvider, openaiKey, groqKey, geminiKey } =
    await chrome.storage.sync.get(
      ["aiProvider", "openaiKey", "groqKey", "geminiKey"]
    );

  let aiResult = null;

  if (aiProvider === "openai" && openaiKey)
    aiResult = await detectOpenAI(text, openaiKey);

  if (aiProvider === "groq" && groqKey)
    aiResult = await detectGroq(text, groqKey);

  if (aiProvider === "gemini" && geminiKey)
    aiResult = await detectGemini(text, geminiKey);

  render(localMatches, aiResult, domains);
});

// ===============================
// Local detection
// ===============================
function extractDomains(text) {
  const regex = /\b(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})\b/gi;
  const set = new Set();
  let m;
  while ((m = regex.exec(text)) !== null) {
    set.add(m[1].toLowerCase());
  }
  return [...set];
}

function localDetection(domains, text) {
  const keywords = ["porn", "xxx", "sex", "adult", "nsfw", "cam", "18+", "explicit"];
  const found = [];

  domains.forEach(d => {
    if (adultDomains.includes(d)) found.push(d);
    keywords.forEach(k => d.includes(k) && found.push(d));
  });

  keywords.forEach(k =>
    text.toLowerCase().includes(k) && found.push(`keyword: ${k}`)
  );

  return [...new Set(found)];
}

// ===============================
// Shared prompt
// ===============================
const STRICT_PROMPT = `
You are a STRICT adult-content classifier.
Treat creator-based premium video, exclusive creator content,
private subscription video platforms as ADULT.
You MUST decide. Output ONLY JSON.
`;

function prompt(text) {
  return `
{
  "adult_content": true | false,
  "adult_domains": [],
  "indicators": [],
  "confidence": 0-100,
  "explanation": "short"
}

TEXT:
"""${text}"""
`;
}

// ===============================
// OpenAI
// ===============================
async function detectOpenAI(text, key) {
  return aiFetch(
    "https://api.openai.com/v1/chat/completions",
    key,
    {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: STRICT_PROMPT },
        { role: "user", content: prompt(text) }
      ]
    }
  );
}

// ===============================
// Groq
// ===============================
async function detectGroq(text, key) {
  return aiFetch(
    "https://api.groq.com/openai/v1/chat/completions",
    key,
    {
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: STRICT_PROMPT },
        { role: "user", content: prompt(text) }
      ]
    }
  );
}

// ===============================
// Gemini
// ===============================
async function detectGemini(text, key) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: STRICT_PROMPT + prompt(text) }]
        }]
      })
    }
  );

  const data = await res.json();
  return JSON.parse(data.candidates[0].content.parts[0].text);
}

// ===============================
// Shared fetch
// ===============================
async function aiFetch(url, key, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`
    },
    body: JSON.stringify({ ...body, temperature: 0 })
  });

  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

// ===============================
// Render
// ===============================
function render(local, ai, domains) {
  const adult = local.length || ai?.adult_content;

  resultDiv.innerHTML = adult
    ? `<div class="warning">⚠️ <b>Adult content detected</b>
       <ul>
        ${local.map(item).join("")}
        ${ai?.adult_domains?.map(item).join("")}
       </ul>
       ${ai ? `<div class="ai">${ai.explanation} (${ai.confidence}%)</div>` : ""}
      </div>`
    : `<div class="safe">✅ <b>No adult content found</b>
       <ul>${domains.map(item).join("")}</ul></div>`;
}

function item(v) {
  return `<li>${
    v.startsWith("keyword")
      ? v
      : `<a href="https://${v}" target="_blank">${v}</a>`
  }</li>`;
}

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
// Platform name → domain aliases
// ===============================
const platformAliases = {
  fansly: "fansly.com",
  missav: "missav.ws",
  chaturbate: "chaturbate.com",
  onlyfans: "onlyfans.com",
  xvideos: "xvideos.com",
  pornhub: "pornhub.com",
  xnxx: "xnxx.com",
  xhamster: "xhamster.com",
  spankbang: "spankbang.com",
  beeg: "beeg.com",
  redtube: "redtube.com",
  youporn: "youporn.com",
  javlibrary: "javlibrary.com"
};

// ===============================
// Fast keyword regex
// ===============================
const FAST_KEYWORD_REGEX =
  /\b(porn|xxx|sex|adult|nsfw|cam|explicit|hentai)\b/i;

// ===============================
// UI helpers
// ===============================
function showAnalyzing(msg = "🔍 Analyzing description…") {
  resultDiv.innerHTML = `<p><strong>${msg}</strong></p>`;
}

function showAnalyzeFailed() {
  resultDiv.innerHTML = `
    <p style="color:#b00020;">
      ❌ Failed to analyze. Please try again.
    </p>
  `;
}

// ===============================
// Load adult domains
// ===============================
fetch(chrome.runtime.getURL("data/adult-domains.json"))
  .then(res => res.json())
  .then(data => {
    adultDomains = data.map(d =>
      d.replace(/^www\./, "").toLowerCase()
    );
  })
  .catch(() => {
    adultDomains = [];
  });

// ===============================
// Load saved settings
// ===============================
chrome.storage.sync.get(
  ["aiProvider", "openaiKey", "groqKey", "geminiKey"],
  res => {
    providerSelect.value = res.aiProvider || "groq";
    apiKeyInput.value = res[providerSelect.value + "Key"] || "";
  }
);

// ===============================
// Provider change
// ===============================
providerSelect.addEventListener("change", () => {
  chrome.storage.sync.get(
    ["openaiKey", "groqKey", "geminiKey"],
    res => {
      apiKeyInput.value = res[providerSelect.value + "Key"] || "";
    }
  );
});

// ===============================
// Save settings
// ===============================
saveKeyBtn.addEventListener("click", () => {
  const provider = providerSelect.value;
  const key = apiKeyInput.value.trim();

  chrome.storage.sync.set(
    {
      aiProvider: provider,
      [`${provider}Key`]: key
    },
    () => alert("Settings saved")
  );
});

// ===============================
// Normalize text (FIX 2)
// ===============================
function normalizeText(text) {
  return text
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// ===============================
// Chunk splitter (FIX 1)
// ===============================
function splitIntoChunks(text, chunkSize = 800) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

// ===============================
// Analyze
// ===============================
analyzeBtn.addEventListener("click", async () => {
  const rawText = document.getElementById("description").value;
  const text = rawText.trim();

  if (!text) {
    resultDiv.innerHTML = "<p>Please paste a description.</p>";
    return;
  }

  showAnalyzing();

  try {
    const normalizedText = normalizeText(text);
    const chunks = splitIntoChunks(text);

    let localMatches = [];

    // 🔹 Chunk-based LOCAL detection
    for (const chunk of chunks) {
      const chunkNorm = normalizeText(chunk);
      const chunkDomains = extractDomains(chunk);
      const matches = localDetection(chunkDomains, chunkNorm);

      if (matches.length > 0) {
        localMatches = [...new Set([...localMatches, ...matches])];
      }
    }

    // If local detection found something → stop
    if (localMatches.length > 0) {
      const allDomains = extractDomains(text);
      render(localMatches, null, allDomains);
      return;
    }

    // ===============================
    // FIX 3: Smart AI fallback
    // ===============================
    const { aiProvider, openaiKey, groqKey, geminiKey } =
      await chrome.storage.sync.get(
        ["aiProvider", "openaiKey", "groqKey", "geminiKey"]
      );

    let aiResult = null;

    try {
      if (aiProvider === "openai" && openaiKey)
        aiResult = await detectOpenAI(normalizedText, openaiKey);

      if (aiProvider === "groq" && groqKey)
        aiResult = await detectGroq(normalizedText, groqKey);

      if (aiProvider === "gemini" && geminiKey)
        aiResult = await detectGemini(normalizedText, geminiKey);
    } catch (e) {
      console.error("AI error:", e);
      showAnalyzeFailed();
      return;
    }

    const allDomains = extractDomains(text);
    render(localMatches, aiResult, allDomains);

  } catch (err) {
    console.error("Analyze failed:", err);
    showAnalyzeFailed();
  }
});

// ===============================
// Domain extraction
// ===============================
function extractDomains(text) {
  const regex = /\b(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})\b/gi;
  const found = new Set();
  let m;

  while ((m = regex.exec(text)) !== null) {
    found.add(
      m[1].replace(/^www\./, "").toLowerCase()
    );
  }
  return [...found];
}

// ===============================
// Local detection (same logic, faster)
// ===============================
function localDetection(domains, lowerText) {
  const found = [];

  // Domain-based detection
  domains.forEach(d => {
    if (adultDomains.includes(d)) {
      found.push(d);
    }
  });

  // Platform-name detection
  Object.keys(platformAliases).forEach(name => {
    if (lowerText.includes(name)) {
      found.push(platformAliases[name]);
    }
  });

  // Fast keyword detection
  const keywordMatch = lowerText.match(FAST_KEYWORD_REGEX);
  if (keywordMatch) {
    found.push(`keyword: ${keywordMatch[1]}`);
  }

  return [...new Set(found)];
}

// ===============================
// STRICT AI PROMPT
// ===============================
const STRICT_PROMPT = `
You are a STRICT adult-content classifier.
Return ONLY valid JSON:
{
  "adult_content": true | false,
  "adult_domains": [],
  "confidence": 0-100,
  "explanation": "short"
}
`;

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
        { role: "user", content: text }
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
        { role: "user", content: text }
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
        contents: [{ parts: [{ text: STRICT_PROMPT + text }] }]
      })
    }
  );

  const data = await res.json();
  return JSON.parse(data.candidates[0].content.parts[0].text);
}

// ===============================
// Shared AI fetch
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
  const adultDetected = local.length > 0 || (ai && ai.adult_content);

  if (adultDetected) {
    resultDiv.innerHTML = `
      <div class="warning">
        ⚠️ <strong>Adult content detected</strong>
        <ul>
          ${local.map(v => `<li>${v}</li>`).join("")}
          ${ai?.adult_domains?.map(v => `<li>${v}</li>`).join("") || ""}
        </ul>
        ${
          ai
            ? `<div class="ai">
                ${ai.explanation || "Detected by AI"}
                (${ai.confidence || "?"}%)
              </div>`
            : ""
        }
      </div>
    `;
  } else {
    resultDiv.innerHTML = `
      <div class="safe">
        ✅ <strong>No adult content found</strong>
        ${
          domains.length
            ? `<p>Domains mentioned:</p>
               <ul>${domains.map(d => `<li>${d}</li>`).join("")}</ul>`
            : "<p>No domains detected.</p>"
        }
      </div>
    `;
  }
}

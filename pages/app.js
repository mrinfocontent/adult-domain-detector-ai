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
  "fansly": "fansly.com",
  "chaturbate": "chaturbate.com",
  "onlyfans": "onlyfans.com",
  "xvideos": "xvideos.com",
  "pornhub": "pornhub.com",
  "xnxx": "xnxx.com",
  "xhamster": "xhamster.com",
  "spankbang": "spankbang.com",
  "beeg": "beeg.com",
  "redtube": "redtube.com",
  "youporn": "youporn.com"
};

// ===============================
// Load adult domains (ROOT SAFE)
// ===============================
fetch(chrome.runtime.getURL("data/adult-domains.json"))
  .then(res => {
    if (!res.ok) throw new Error("Failed to load adult-domains.json");
    return res.json();
  })
  .then(data => {
    adultDomains = data.map(d =>
      d.replace(/^www\./, "").toLowerCase()
    );
    console.log("Adult domains loaded:", adultDomains.length);
  })
  .catch(err => {
    console.error("Adult domain list error:", err);
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
// Analyze
// ===============================
analyzeBtn.addEventListener("click", async () => {
  const text = document.getElementById("description").value.trim();
  resultDiv.innerHTML = "";

  if (!text) {
    resultDiv.innerHTML = "<p>Please paste a description.</p>";
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
// Domain extraction (.com etc)
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
// Local detection (domains + names)
// ===============================
function localDetection(domains, text) {
  const keywords = ["porn", "xxx", "sex", "adult", "nsfw", "cam", "18+", "explicit"];
  const found = [];
  const lowerText = text.toLowerCase();

  // 1️⃣ Domain-based detection
  domains.forEach(d => {
    if (adultDomains.includes(d)) found.push(d);
    keywords.forEach(k => d.includes(k) && found.push(d));
  });

  // 2️⃣ Platform-name alias detection
  Object.keys(platformAliases).forEach(name => {
    if (lowerText.includes(name)) {
      found.push(platformAliases[name]);
    }
  });

  // 3️⃣ Keyword detection
  keywords.forEach(k => {
    if (lowerText.includes(k)) {
      found.push(`keyword: ${k}`);
    }
  });

  return [...new Set(found)];
}

// ===============================
// STRICT AI PROMPT
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
        contents: [
          { parts: [{ text: STRICT_PROMPT + prompt(text) }] }
        ]
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
// Render (ALWAYS shows output)
// ===============================
function render(local, ai, domains) {
  const adultDetected =
    local.length > 0 || (ai && ai.adult_content);

  if (adultDetected) {
    resultDiv.innerHTML = `
      <div class="warning">
        ⚠️ <strong>Adult content detected</strong>
        <ul>
          ${local.map(item).join("")}
          ${ai?.adult_domains?.map(item).join("")}
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
               <ul>${domains.map(item).join("")}</ul>`
            : "<p>No domains detected.</p>"
        }
      </div>
    `;
  }
}

function item(v) {
  return `<li>${
    v.startsWith("keyword")
      ? v
      : `<a href="https://${v}" target="_blank">${v}</a>`
  }</li>`;
}

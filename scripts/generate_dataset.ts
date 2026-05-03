/**
 * generate_dataset.ts
 *
 * Generates an OpenAI fine-tuning JSONL dataset for V7 inference.
 *
 * Usage:
 *   npx ts-node -P tsconfig.scripts.json scripts/generate_dataset.ts
 *
 * Environment variables (optional overrides):
 *   GEMINI_API_KEY   – Gemini Flash API key
 *   OUTPUT_FILE      – path for the output JSONL (default: dataset.jsonl)
 *   TARGET_SAMPLES   – minimum number of JSONL lines to produce (default: 1200)
 */

import * as fs from "fs";
import * as https from "https";
import * as path from "path";
import { V7DatasetGenerator, getInference } from "../getInference";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("Error: GEMINI_API_KEY environment variable is required.");
  process.exit(1);
}
const OUTPUT_FILE = process.env.OUTPUT_FILE ?? path.join(__dirname, "..", "dataset.jsonl");
const TARGET_SAMPLES = parseInt(process.env.TARGET_SAMPLES ?? "10000", 10);

// ---------------------------------------------------------------------------
// Gemini Flash helpers
// ---------------------------------------------------------------------------

function httpsPost(url: string, body: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (d: Buffer) => chunks.push(d));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function geminiGenerate(prompt: string, retries = 3): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
  const payload = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 1.0, maxOutputTokens: 2048 },
  });

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const raw = await httpsPost(url, payload, {});
      const parsed = JSON.parse(raw);
      const text: string =
        parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      if (text.trim()) return text.trim();
      console.error("Empty Gemini response, retrying…");
    } catch (e) {
      console.error(`Gemini error (attempt ${attempt + 1}):`, e);
    }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  return "";
}

// ---------------------------------------------------------------------------
// Prompt bank – diverse Vietnamese text generation prompts
// ---------------------------------------------------------------------------

const PROMPTS: string[] = [
  // --- Daily life & nature ---
  "Viết 10 câu văn tiếng Việt ngắn về cuộc sống hàng ngày ở thành phố. Chỉ trả lời bằng các câu văn, không giải thích.",
  "Viết 10 câu văn tiếng Việt ngắn về nông thôn và đồng quê Việt Nam. Chỉ trả lời bằng các câu văn, không giải thích.",
  "Viết 10 câu mô tả cảnh thiên nhiên Việt Nam: rừng núi, sông suối, biển cả. Chỉ trả lời bằng các câu văn, không giải thích.",
  "Viết 10 câu về thời tiết bốn mùa ở Việt Nam. Chỉ trả lời bằng các câu văn, không giải thích.",
  "Viết 10 câu về ẩm thực Việt Nam: các món ăn truyền thống và hiện đại. Chỉ trả lời bằng các câu văn, không giải thích.",
  // --- Emotions & relationships ---
  "Viết 10 câu văn tiếng Việt thể hiện cảm xúc vui, buồn, nhớ nhung, yêu thương. Chỉ trả lời bằng các câu văn, không giải thích.",
  "Viết 10 câu về tình bạn và những kỷ niệm đẹp tuổi học trò. Chỉ trả lời bằng các câu văn, không giải thích.",
  "Viết 10 câu về tình yêu đôi lứa theo phong cách văn học lãng mạn. Chỉ trả lời bằng các câu văn, không giải thích.",
  "Viết 10 câu về gia đình, ông bà, cha mẹ và anh chị em. Chỉ trả lời bằng các câu văn, không giải thích.",
  // --- History, culture, society ---
  "Viết 10 câu về lịch sử dựng nước và giữ nước của người Việt. Chỉ trả lời bằng các câu văn, không giải thích.",
  "Viết 10 câu về văn hóa truyền thống: lễ hội, phong tục, tập quán người Việt. Chỉ trả lời bằng các câu văn, không giải thích.",
  "Viết 10 câu về các địa danh nổi tiếng ở Việt Nam. Chỉ trả lời bằng các câu văn, không giải thích.",
  "Viết 10 câu về sự phát triển kinh tế và xã hội của Việt Nam hiện đại. Chỉ trả lời bằng các câu văn, không giải thích.",
  // --- Knowledge & science ---
  "Viết 10 câu về công nghệ thông tin và chuyển đổi số tại Việt Nam. Chỉ trả lời bằng các câu văn, không giải thích.",
  "Viết 10 câu về giáo dục, học tập và nghiên cứu khoa học. Chỉ trả lời bằng các câu văn, không giải thích.",
  "Viết 10 câu về y tế, sức khỏe và lối sống lành mạnh. Chỉ trả lời bằng các câu văn, không giải thích.",
  "Viết 10 câu về môi trường, biến đổi khí hậu và bảo vệ thiên nhiên. Chỉ trả lời bằng các câu văn, không giải thích.",
  // --- Arts, literature, philosophy ---
  "Viết 10 câu về thơ ca và văn học dân gian Việt Nam. Chỉ trả lời bằng các câu văn, không giải thích.",
  "Viết 10 câu theo phong cách văn xuôi trữ tình về quê hương đất nước. Chỉ trả lời bằng các câu văn, không giải thích.",
  "Viết 5 đoạn văn ngắn (mỗi đoạn 3 câu) về triết lý sống của người Việt. Chỉ trả lời bằng các đoạn văn, không giải thích.",
  "Viết 10 tục ngữ hoặc thành ngữ tiếng Việt và giải thích ngắn (1 câu mỗi câu). Chỉ trả lời các câu tục ngữ/thành ngữ và giải thích ngắn.",
  // --- News & formal writing ---
  "Viết 10 câu theo phong cách bản tin báo chí về các sự kiện trong nước. Chỉ trả lời bằng các câu văn, không giải thích.",
  "Viết 10 câu theo phong cách hành chính về pháp luật và quy định xã hội. Chỉ trả lời bằng các câu văn, không giải thích.",
  // --- Dialogue & casual speech ---
  "Viết 10 câu hội thoại thông thường bằng tiếng Việt giữa hai người bạn. Chỉ trả lời bằng các câu hội thoại, không giải thích.",
  "Viết 10 câu hỏi và trả lời ngắn về chủ đề du lịch trong nước. Chỉ trả lời bằng các câu hỏi và trả lời, không giải thích.",
  "Viết 10 câu văn về thể thao, bóng đá và các hoạt động vui chơi giải trí. Chỉ trả lời bằng các câu văn, không giải thích.",
  // --- More variety ---
  "Viết 10 câu mô tả công việc và nghề nghiệp phổ biến ở Việt Nam. Chỉ trả lời bằng các câu văn, không giải thích.",
  "Viết 10 câu về các loại trái cây, rau củ và nông sản Việt Nam. Chỉ trả lời bằng các câu văn, không giải thích.",
  "Viết 10 câu về giao thông và phương tiện đi lại ở đô thị Việt Nam. Chỉ trả lời bằng các câu văn, không giải thích.",
  "Viết 10 câu về âm nhạc, điện ảnh và nghệ thuật biểu diễn Việt Nam. Chỉ trả lời bằng các câu văn, không giải thích.",
  "Viết 3 đoạn văn mô tả một ngày thường tại Hà Nội, mỗi đoạn 4–5 câu. Chỉ trả lời bằng các đoạn văn, không giải thích.",
  "Viết 3 đoạn văn mô tả một ngày thường tại thành phố Hồ Chí Minh, mỗi đoạn 4–5 câu. Chỉ trả lời bằng các đoạn văn, không giải thích.",
  "Viết 3 đoạn văn về miền Tây sông nước Nam Bộ. Chỉ trả lời bằng các đoạn văn, không giải thích.",
  "Viết 10 câu tiếng Việt với nhiều âm tiết khép (kết thúc bằng c, ch, t, p, nh, ng). Chỉ trả lời bằng các câu văn, không giải thích.",
  "Viết 10 câu tiếng Việt với nhiều thanh sắc và hỏi. Chỉ trả lời bằng các câu văn, không giải thích.",
  "Viết 10 câu tiếng Việt với nhiều từ có thanh nặng và ngã. Chỉ trả lời bằng các câu văn, không giải thích.",
  "Viết 10 câu tiếng Việt dùng nhiều phụ âm đầu như: tr, ch, ph, kh, gh, ngh, gi. Chỉ trả lời bằng các câu văn, không giải thích.",
  "Viết 10 câu tiếng Việt với các từ có nguyên âm đôi: ươ, iê, uô. Chỉ trả lời bằng các câu văn, không giải thích.",
  "Viết 10 câu văn ngắn về mùa hè và biển Việt Nam. Chỉ trả lời bằng các câu văn.",
  "Viết 10 câu tiếng Việt bắt đầu bằng các từ như: Mỗi, Những, Hầu hết, Đôi khi, Luôn luôn. Chỉ trả lời bằng các câu văn.",
  "Viết 10 câu văn về lòng yêu nước và truyền thống hào hùng của dân tộc Việt. Chỉ trả lời bằng các câu văn.",
  "Viết 5 đoạn văn ngắn (3-4 câu mỗi đoạn) về các nhân vật lịch sử Việt Nam. Chỉ trả lời bằng các đoạn văn.",
  "Viết 10 câu về cuộc sống của người dân vùng cao Tây Bắc. Chỉ trả lời bằng các câu văn.",
  "Viết 10 câu tiếng Việt với nhiều từ bắt đầu bằng 'đ' (đ). Chỉ trả lời bằng các câu văn.",
  "Viết 10 câu về chợ truyền thống và không khí mua bán ở Việt Nam. Chỉ trả lời bằng các câu văn.",
  "Viết 10 câu về sự thay đổi của Việt Nam qua các thập kỷ. Chỉ trả lời bằng các câu văn.",
  "Viết 10 câu về Tết Nguyên Đán và các hoạt động đón xuân. Chỉ trả lời bằng các câu văn.",
  "Viết 10 câu về trường học và cuộc sống học sinh sinh viên ở Việt Nam. Chỉ trả lời bằng các câu văn.",
  "Viết 10 câu về làng nghề truyền thống Việt Nam. Chỉ trả lời bằng các câu văn.",
  "Viết 10 câu về tôn giáo và tín ngưỡng dân gian người Việt. Chỉ trả lời bằng các câu văn.",
  "Viết 10 câu mô tả khu phố cổ Hội An. Chỉ trả lời bằng các câu văn.",
];

// ---------------------------------------------------------------------------
// Line-extraction helpers
// ---------------------------------------------------------------------------

function extractSentences(raw: string): string[] {
  const lines = raw
    .split(/\n+/)
    .map((l) => l.replace(/^\s*\d+[\.\)]\s*/, "").trim())
    .filter((l) => l.length > 5);
  return lines;
}

// ---------------------------------------------------------------------------
// OpenAI JSONL formatting
// ---------------------------------------------------------------------------

const SYSTEM_MSG =
  "Bạn là công cụ chuyển đổi mã v7 sang tiếng Việt. Hãy trả về kết quả dưới dạng mảng JSON.";

function buildOpenAILine(
  input: string[],
  output: string[]
): string | null {
  if (input.length === 0) return null;

  // Reconstruct the expected full-resolution array
  // input is: [fixed0, v7_1, fixed2, v7_3, ...] (alternating)
  // output is the resolved text for each v7 island [resolved_1, resolved_3, ...]
  const resolved: string[] = output;

  const userContent =
    "Perform the following v7 inference request: " + JSON.stringify(input);
  const assistantContent = JSON.stringify(resolved);

  const record = {
    messages: [
      { role: "system", content: SYSTEM_MSG },
      { role: "user", content: userContent },
      { role: "assistant", content: assistantContent },
    ],
  };
  return JSON.stringify(record);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const generator = new V7DatasetGenerator();

  const outStream = fs.createWriteStream(OUTPUT_FILE, { encoding: "utf8", flags: "w" });

  let totalLines = 0;
  let promptIndex = 0;

  // Coverage tracking sets
  const coveredV7Codes = new Set<string>();
  const coveredSyllables = new Set<string>();

  const writeLineIfValid = (input: string[], output: string[]) => {
    const line = buildOpenAILine(input, output);
    if (!line) return;
    outStream.write(line + "\n");
    totalLines++;

    // Track coverage
    for (let i = 1; i < input.length; i += 2) {
      // Parse v7 codes from the v7 island
      const v7 = input[i];
      // simple 2-char + rest pattern for consonant+vowel+tone
      // Each syllable code is consonant + vowel_letter + tone_digit
      // Just record the whole v7 string as a covered code for now
      coveredV7Codes.add(v7);
    }
    for (let i = 1; i < input.length; i += 2) {
      const resolved = output[(i - 1) / 2];
      if (resolved) {
        // record each whitespace-separated syllable
        for (const syl of resolved.split(/\s+/)) {
          if (syl) coveredSyllables.add(syl.toLowerCase());
        }
      }
    }
  };

  console.log(`Generating dataset… target: ${TARGET_SAMPLES} samples`);
  console.log(`Output: ${OUTPUT_FILE}`);

  while (totalLines < TARGET_SAMPLES && promptIndex < PROMPTS.length * 20) {
    const prompt = PROMPTS[promptIndex % PROMPTS.length];
    promptIndex++;

    process.stdout.write(
      `[${totalLines}/${TARGET_SAMPLES}] Prompt ${promptIndex}/${PROMPTS.length * 3}… `
    );

    const raw = await geminiGenerate(prompt);
    if (!raw) {
      console.log("skipped (no response)");
      continue;
    }

    const sentences = extractSentences(raw);
    console.log(`got ${sentences.length} lines`);

    for (const sentence of sentences) {
      // Generate multiple samples per sentence with varying v7Probability
      for (const v7Prob of [0.3, 0.5, 0.7, 0.9]) {
        try {
          const sample = generator.generateSample(sentence, v7Prob);
          if (sample.input.length === 0 || sample.output.length === 0) continue;
          // Only include samples that have at least one v7 island
          const hasV7Island = sample.input.some((_, i) => i % 2 === 1);
          if (!hasV7Island) continue;
          writeLineIfValid(sample.input, sample.output);
        } catch {
          // skip unparseable
        }
      }
    }

    // Small delay to be kind to the API
    await new Promise((r) => setTimeout(r, 300));
  }

  outStream.end();

  // Coverage summary
  console.log("\n=== Coverage Summary ===");
  console.log(`Total JSONL lines: ${totalLines}`);
  console.log(`Unique v7 island strings covered: ${coveredV7Codes.size}`);
  console.log(`Unique Vietnamese syllables covered: ${coveredSyllables.size}`);

  // Write a coverage JSON for the tracking script
  const coverageFile = path.join(__dirname, "..", "dataset_coverage.json");
  fs.writeFileSync(
    coverageFile,
    JSON.stringify(
      {
        totalSamples: totalLines,
        coveredV7IslandStrings: coveredV7Codes.size,
        coveredVietnameseSyllables: coveredSyllables.size,
        sampleV7Codes: [...coveredV7Codes].slice(0, 50),
        sampleSyllables: [...coveredSyllables].slice(0, 100),
      },
      null,
      2
    )
  );
  console.log(`Coverage report written to ${coverageFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

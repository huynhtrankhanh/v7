/**
 * generate_dataset.ts
 *
 * Generates an OpenAI fine-tuning JSONL dataset for V7 inference.
 *
 * Usage:
 *   npx ts-node -P tsconfig.scripts.json evaluator/generate_dataset.ts
 *
 * Environment variables (optional overrides):
 *   GEMINI_API_KEY   – Gemini Flash API key
 *   OUTPUT_FILE      – path for the output JSONL (default: evaluator/dataset.jsonl)
 *   TARGET_SAMPLES   – minimum number of JSONL lines to produce (default: 1200)
 */

import * as fs from "fs";
import * as https from "https";
import * as path from "path";
import { V7DatasetGenerator } from "./getInference";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("Error: GEMINI_API_KEY environment variable is required.");
  process.exit(1);
}
const OUTPUT_FILE =
  process.env.OUTPUT_FILE ?? path.join(__dirname, "dataset.jsonl");
const COVERAGE_FILE =
  process.env.COVERAGE_FILE ?? path.join(__dirname, "dataset_coverage.json");
const TARGET_SAMPLES = parseInt(process.env.TARGET_SAMPLES ?? "50000", 10);
const PARALLELISM = parseInt(process.env.PARALLELISM ?? "10", 10);

// ---------------------------------------------------------------------------
// Gemini Flash helpers
// ---------------------------------------------------------------------------

function httpsPost(
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<string> {
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
      },
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
  // --- Questions ---
  "Viết 10 câu hỏi tiếng Việt về cuộc sống thường ngày. Chỉ trả lời bằng các câu hỏi, không giải thích.",
  "Viết 10 câu hỏi tiếng Việt thể hiện sự tò mò, ngạc nhiên về thiên nhiên và vũ trụ. Chỉ trả lời bằng các câu hỏi.",
  "Viết 10 câu hỏi tu từ tiếng Việt trong phong cách văn học. Chỉ trả lời bằng các câu hỏi.",
  "Viết 10 câu hỏi tiếng Việt dùng trong hội thoại giữa bạn bè, gia đình. Chỉ trả lời bằng các câu hỏi.",
  "Viết 10 câu hỏi tiếng Việt về lịch sử, văn hóa và phong tục tập quán. Chỉ trả lời bằng các câu hỏi.",
  "Viết 10 câu hỏi tiếng Việt thể hiện sự băn khoăn, suy nghĩ về cuộc đời. Chỉ trả lời bằng các câu hỏi.",
  "Viết 10 câu hỏi tiếng Việt về ẩm thực, du lịch và lối sống. Chỉ trả lời bằng các câu hỏi.",
  "Viết 10 câu hỏi tiếng Việt bắt đầu bằng: Tại sao, Làm thế nào, Khi nào, Ở đâu, Ai. Chỉ trả lời bằng các câu hỏi.",
  // --- Exclamations ---
  "Viết 10 câu cảm thán tiếng Việt thể hiện sự vui mừng, ngạc nhiên, xúc động. Chỉ trả lời bằng các câu cảm thán.",
  "Viết 10 câu cảm thán tiếng Việt thể hiện tình yêu quê hương đất nước. Chỉ trả lời bằng các câu cảm thán.",
  "Viết 10 câu cảm thán tiếng Việt bắt đầu bằng: Ôi, Ồ, Chao ôi, Trời ơi, Thật là. Chỉ trả lời bằng các câu cảm thán.",
  "Viết 10 câu cảm thán tiếng Việt về vẻ đẹp thiên nhiên và phong cảnh. Chỉ trả lời bằng các câu cảm thán.",
  "Viết 10 câu cảm thán tiếng Việt thể hiện lòng biết ơn và trân trọng. Chỉ trả lời bằng các câu cảm thán.",
  "Viết 10 câu cảm thán tiếng Việt dùng trong sinh hoạt hàng ngày và giao tiếp. Chỉ trả lời bằng các câu cảm thán.",
  // --- Poems ---
  "Viết một bài thơ lục bát tiếng Việt 8 câu về mùa xuân và hy vọng. Chỉ trả lời bằng bài thơ, không giải thích.",
  "Viết một bài thơ lục bát tiếng Việt 8 câu về tình mẹ và lòng hiếu thảo. Chỉ trả lời bằng bài thơ, không giải thích.",
  "Viết một bài thơ tứ tuyệt tiếng Việt 4 câu về cảnh đêm trăng. Chỉ trả lời bằng bài thơ.",
  "Viết 3 khổ thơ tiếng Việt theo thể thơ 7 chữ về quê hương. Chỉ trả lời bằng bài thơ.",
  "Viết một bài thơ tiếng Việt 8 câu theo thể thơ 5 chữ về tuổi thơ và kỷ niệm. Chỉ trả lời bằng bài thơ.",
  "Viết 3 khổ thơ tiếng Việt theo thể thơ 8 chữ về tình yêu đôi lứa. Chỉ trả lời bằng bài thơ.",
  "Viết một bài thơ lục bát tiếng Việt 10 câu về biển và sóng gió. Chỉ trả lời bằng bài thơ.",
  "Viết một bài thơ tiếng Việt 4 khổ về mùa thu lá rụng và nỗi nhớ. Chỉ trả lời bằng bài thơ.",
  "Viết 10 câu thơ tiếng Việt về nỗi nhớ quê hương khi xa xứ. Chỉ trả lời bằng câu thơ.",
  "Viết một bài thơ vui tiếng Việt 8 câu về cuộc sống đô thị hiện đại. Chỉ trả lời bằng bài thơ.",
  "Viết 3 khổ thơ tiếng Việt ca ngợi người nông dân và đồng lúa. Chỉ trả lời bằng bài thơ.",
  "Viết một bài thơ tiếng Việt 4 khổ về trẻ em và tuổi học trò. Chỉ trả lời bằng bài thơ.",
  // --- Hymns & songs ---
  "Viết lời một bài ca ngợi tiếng Việt về Tổ quốc và anh hùng dân tộc, gồm 2 đoạn mỗi đoạn 4 câu. Chỉ trả lời bằng lời bài ca.",
  "Viết lời một bài hát ru tiếng Việt 8 câu về mẹ và con. Chỉ trả lời bằng lời bài hát.",
  "Viết lời một bài dân ca tiếng Việt về mùa gặt và niềm vui lao động, 8 câu. Chỉ trả lời bằng lời bài ca.",
  "Viết lời một bài thánh ca tiếng Việt về lòng biết ơn và hy vọng, 2 đoạn mỗi đoạn 4 câu. Chỉ trả lời bằng lời bài ca.",
  "Viết lời một bài ca ngợi tiếng Việt về biển đảo và ngư dân, gồm 2 đoạn. Chỉ trả lời bằng lời bài ca.",
  "Viết lời một bài hát thiếu nhi tiếng Việt vui tươi về mùa hè, 8 câu. Chỉ trả lời bằng lời bài hát.",
  "Viết lời một bài ca ngợi tiếng Việt về Hà Nội ngàn năm văn hiến, 2 đoạn. Chỉ trả lời bằng lời bài ca.",
  "Viết lời một bài hát ru tiếng Việt của người miền Trung về biển và mưa, 8 câu. Chỉ trả lời bằng lời bài hát.",
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

function buildOpenAILine(input: string[], output: string[]): string | null {
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

  const outStream = fs.createWriteStream(OUTPUT_FILE, {
    encoding: "utf8",
    flags: "w",
  });

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

  console.log(
    `Generating dataset… target: ${TARGET_SAMPLES} samples, parallelism: ${PARALLELISM}`,
  );
  console.log(`Output: ${OUTPUT_FILE}`);

  while (totalLines < TARGET_SAMPLES && promptIndex < PROMPTS.length * 60) {
    // Fire up to PARALLELISM prompts in parallel
    const batchPromises: Promise<string>[] = [];
    for (
      let p = 0;
      p < PARALLELISM &&
      promptIndex < PROMPTS.length * 60 &&
      totalLines + batchPromises.length * 4 * 10 <
        TARGET_SAMPLES + PARALLELISM * 40;
      p++
    ) {
      const prompt = PROMPTS[promptIndex % PROMPTS.length];
      promptIndex++;
      batchPromises.push(geminiGenerate(prompt));
    }

    process.stdout.write(
      `[${totalLines}/${TARGET_SAMPLES}] Fetching batch of ${batchPromises.length} prompts… `,
    );

    const raws = await Promise.all(batchPromises);
    let batchLines = 0;

    for (const raw of raws) {
      if (!raw) continue;
      const sentences = extractSentences(raw);
      for (const sentence of sentences) {
        // Generate multiple samples per sentence with varying v7Probability
        for (const v7Prob of [0.3, 0.5, 0.7, 0.9]) {
          try {
            const sample = generator.generateSample(sentence, v7Prob);
            if (sample.input.length === 0 || sample.output.length === 0)
              continue;
            // Only include samples that have at least one v7 island
            const hasV7Island = sample.input.some((_, i) => i % 2 === 1);
            if (!hasV7Island) continue;
            writeLineIfValid(sample.input, sample.output);
            batchLines++;
          } catch {
            // skip unparseable
          }
        }
      }
    }

    console.log(`got ${batchLines} lines`);

    // Small delay between batches to be kind to the API
    await new Promise((r) => setTimeout(r, 300));
  }

  outStream.end();

  // Coverage summary
  console.log("\n=== Coverage Summary ===");
  console.log(`Total JSONL lines: ${totalLines}`);
  console.log(`Unique v7 island strings covered: ${coveredV7Codes.size}`);
  console.log(`Unique Vietnamese syllables covered: ${coveredSyllables.size}`);

  // Write a coverage JSON for the tracking script
  fs.writeFileSync(
    COVERAGE_FILE,
    JSON.stringify(
      {
        totalSamples: totalLines,
        coveredV7IslandStrings: coveredV7Codes.size,
        coveredVietnameseSyllables: coveredSyllables.size,
        sampleV7Codes: [...coveredV7Codes].slice(0, 50),
        sampleSyllables: [...coveredSyllables].slice(0, 100),
      },
      null,
      2,
    ),
  );
  console.log(`Coverage report written to ${COVERAGE_FILE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

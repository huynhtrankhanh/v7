import { strokeForV7Pair } from "./v7-stroke.mjs";

const toneCharacters = {
  áắấéếíóốớúứý: 1,
  àằầèềìòồờùừỳ: 2,
  ảẳẩẻểỉỏổởủửỷ: 3,
  ãẵẫẽễĩõỗỡũữỹ: 4,
  ạặậẹệịọộợụựỵ: 5,
};
const toneOf = new Map(
  Object.entries(toneCharacters).flatMap(([characters, tone]) =>
    [...characters].map((character) => [character, tone]),
  ),
);
const onsets = [
  ["qu", "w"],
  ["gi", "z"],
  ["ngh", "ng"],
  ["gh", "g"],
  ["tr", "tr"],
  ["th", "th"],
  ["ch", "ch"],
  ["nh", "nh"],
  ["ng", "ng"],
  ["kh", "kh"],
  ["ph", "ph"],
  ["đ", "dd"],
  ["d", "d"],
  ["x", "x"],
  ["v", "v"],
  ["t", "t"],
  ["s", "s"],
  ["r", "r"],
  ["p", "p"],
  ["n", "n"],
  ["m", "m"],
  ["l", "l"],
  ["h", "h"],
  ["g", "g"],
  ["k", "k"],
  ["c", "k"],
  ["b", "b"],
];

const wordsIn = (text) =>
  text.toLocaleLowerCase("vi").match(/[\p{L}\p{M}]+/gu) ?? [];

function wordCode(word) {
  const onset = onsets.find(([prefix]) => word.startsWith(prefix));
  const onsetCode = onset?.[1] ?? "0";
  const rime = word.slice(onset?.[0].length ?? 0) || word;
  const first = rime[0] === "y" ? "i" : rime[0];
  const decomposed = first
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace("đ", "d");
  const vowel = /^[aeiou]$/.test(decomposed) ? decomposed : "a";
  let tone =
    [...word].map((character) => toneOf.get(character)).find(Boolean) ?? 0;
  if (
    word.endsWith("c") ||
    word.endsWith("ch") ||
    word.endsWith("p") ||
    word.endsWith("t")
  ) {
    if (tone === 1) tone = 6;
    if (tone === 5) tone = 7;
  }
  return `${onsetCode}${vowel}${tone}`;
}

function makeSentence(id, text, category) {
  const words = wordsIn(text);
  const pairs = [];
  for (let index = 0; index + 1 < words.length; index += 2) {
    const code = wordCode(words[index]) + wordCode(words[index + 1]);
    pairs.push({
      words: `${words[index]} ${words[index + 1]}`,
      code,
      ...strokeForV7Pair(code),
    });
  }
  return {
    id: `sentence-${id}`,
    concept: "context",
    target: text,
    category,
    strokes: [],
    keys: [],
    note: "Hãy viết theo cách bạn thấy nhanh: từng tiếng hoặc hai tiếng một lượt. Nếu chữ hiện ra chưa đúng, chọn cách viết phù hợp hoặc chỉ sửa chỗ sai.",
    kind: "sentence",
    pairs,
  };
}

export const sentenceCards = [
  makeSentence(
    "morning",
    "Sáng nay trời dịu mát, tôi đi bộ quanh hồ.",
    "Đời sống hằng ngày",
  ),
  makeSentence(
    "conversation",
    "Bạn có muốn uống cà phê với tôi không?",
    "Hội thoại và câu hỏi",
  ),
  makeSentence(
    "instruction",
    "Hãy lưu tài liệu trước khi tắt máy.",
    "Hướng dẫn thao tác",
  ),
  makeSentence(
    "narrative",
    "Con mèo nhỏ nằm ngủ yên bên cửa sổ.",
    "Miêu tả và tự sự",
  ),
  makeSentence(
    "formal",
    "Dữ liệu được bảo vệ bằng một quy trình rõ ràng.",
    "Văn phong trang trọng",
  ),
  makeSentence(
    "travel",
    "Ngày mai chúng tôi sẽ đi tàu ra Huế.",
    "Du lịch và địa danh",
  ),
  makeSentence("food", "Bữa cơm chiều có cá kho và rau luộc.", "Ẩm thực"),
  makeSentence(
    "technical",
    "Nhóm kỹ sư đang kiểm tra hệ thống mới.",
    "Kỹ thuật",
  ),
  makeSentence(
    "reason",
    "Vì sao bầu trời đổi màu khi hoàng hôn?",
    "Câu hỏi nguyên nhân",
  ),
  makeSentence(
    "community",
    "Mọi người cùng chia sẻ sách trong thư viện nhỏ.",
    "Cộng đồng",
  ),
];

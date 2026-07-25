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
  makeSentence(
    "rain",
    "Chiều nay mưa lớn nên đường phố vắng hơn thường lệ.",
    "Thời tiết và nhịp sống",
  ),
  makeSentence(
    "home",
    "Mẹ tôi trồng thêm vài chậu hoa trước hiên nhà.",
    "Gia đình và nhà cửa",
  ),
  makeSentence(
    "office",
    "Cuộc họp bắt đầu lúc chín giờ sáng thứ hai.",
    "Công việc",
  ),
  makeSentence(
    "request",
    "Bạn gửi giúp tôi bản đồ của khu phố này nhé.",
    "Hội thoại và nhờ vả",
  ),
  makeSentence(
    "negative",
    "Tôi chưa nhận được thư dù đã kiểm tra hộp thư.",
    "Hội thoại và phủ định",
  ),
  makeSentence(
    "condition",
    "Nếu trời quang, chúng ta sẽ ngắm sao ngoài sân.",
    "Điều kiện và kế hoạch",
  ),
  makeSentence(
    "education",
    "Cô giáo giải thích bài học bằng một ví dụ gần gũi.",
    "Học tập",
  ),
  makeSentence(
    "health",
    "Uống đủ nước và ngủ sớm giúp cơ thể khỏe hơn.",
    "Sức khỏe",
  ),
  makeSentence(
    "nature",
    "Dòng sông uốn quanh cánh đồng xanh ngát phía xa.",
    "Thiên nhiên",
  ),
  makeSentence(
    "market",
    "Người bán chọn những quả cam chín và cân thật nhanh.",
    "Mua bán",
  ),
  makeSentence(
    "bus",
    "Chuyến xe buýt đông khách nhưng vẫn đến đúng giờ.",
    "Giao thông",
  ),
  makeSentence(
    "book",
    "Tôi thường đọc vài trang sách trước khi đi ngủ.",
    "Thói quen",
  ),
  makeSentence(
    "music",
    "Quán nhỏ bên đường mở một bản nhạc rất dịu dàng.",
    "Nghệ thuật",
  ),
  makeSentence(
    "technology",
    "Điện thoại mới có pin lâu và màn hình sáng rõ.",
    "Công nghệ đời sống",
  ),
  makeSentence(
    "reasoning",
    "Chúng tôi đổi lịch vì chuyến bay bị hoãn đến tối.",
    "Giải thích và nguyên nhân",
  ),
  makeSentence(
    "polite",
    "Xin hãy đóng cửa nhẹ để em bé không thức giấc.",
    "Lời nhờ lịch sự",
  ),
  makeSentence(
    "memory",
    "Ông kể lại câu chuyện cũ bằng giọng nói đầy ấm áp.",
    "Ký ức và gia đình",
  ),
  makeSentence(
    "meeting",
    "Mỗi người nêu một ý kiến trước khi cả nhóm quyết định.",
    "Trao đổi và quyết định",
  ),
  makeSentence(
    "environment",
    "Khu phố đặt thêm thùng rác để giữ vỉa hè sạch sẽ.",
    "Môi trường và cộng đồng",
  ),
  makeSentence(
    "future",
    "Năm sau tôi muốn học thêm một ngôn ngữ mới.",
    "Mục tiêu cá nhân",
  ),
];

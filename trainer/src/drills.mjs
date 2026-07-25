import { sentenceCards } from "./sentences.mjs";

/**
 * Practice material is intentionally data-only. The UI presents one target at
 * a time and captures the learner's real chord; there are no quiz questions.
 */
export const concepts = {
  chord: {
    title: "Một lần bấm",
    instruction:
      "Đặt ngón tay lên các phím đang sáng, nhấn chúng cùng lúc, rồi thả hết để viết.",
  },
  vowel: {
    title: "Bắt đầu với nguyên âm",
    instruction:
      "Các phím giữa bàn phím viết a, o, e, u và i. Nhấn các phím đang sáng cùng lúc, rồi thả.",
  },
  onset: {
    title: "Thêm chữ đầu",
    instruction:
      "Bấm các phím bên trái cùng với phím giữa để viết trọn một tiếng.",
  },
  tone: {
    title: "Thêm dấu",
    instruction:
      "Bấm thêm phím dấu trong cùng lần bấm. Hãy nhìn chữ cần viết và bấm cả cụm một lượt.",
  },
  coda: {
    title: "Thêm chữ cuối",
    instruction:
      "Bấm thêm các phím bên phải trong cùng lần bấm. V7 sẽ sắp chữ và đặt dấu đúng chỗ.",
  },
  context: {
    title: "Viết câu tự nhiên",
    instruction:
      "Bạn có thể viết từng tiếng hoặc viết hai tiếng trong một lần bấm. Hãy chọn cách nhanh và thoải mái nhất.",
  },
  repair: {
    title: "Chọn cách viết rồi sửa chỗ sai",
    instruction:
      "Đây là bài tập thao tác: viết hai tiếng trong một lần bấm, chọn cách viết được yêu cầu, rồi sửa riêng phần đang sáng.",
  },
};

const card = (id, concept, target, stroke, keys, note = "") => ({
  id,
  concept,
  target,
  strokes: [stroke],
  keys,
  note,
  kind: "deterministic",
});

export const cards = [
  card("v-a", "vowel", "a", "A", ["KeyC"]),
  card("v-o", "vowel", "o", "O", ["KeyV"]),
  card("v-e", "vowel", "e", "E", ["KeyN"]),
  card("v-u", "vowel", "u", "U", ["KeyM"]),
  card("v-i", "vowel", "i", "EU", ["KeyN", "KeyM"]),
  card("v-aw", "vowel", "ă", "AE", ["KeyC", "KeyN"]),
  card("v-aa", "vowel", "â", "AO", ["KeyC", "KeyV"]),
  card("v-ee", "vowel", "ê", "AU", ["KeyC", "KeyM"]),
  card("v-oo", "vowel", "ô", "OE", ["KeyV", "KeyN"]),
  card("v-ow", "vowel", "ơ", "OU", ["KeyV", "KeyM"]),
  card("v-uw", "vowel", "ư", "AOU", ["KeyC", "KeyV", "KeyM"]),
  card("o-ma", "onset", "ma", "PHA", ["KeyE", "KeyR", "KeyC"]),
  card("o-ba", "onset", "ba", "PWA", ["KeyE", "KeyD", "KeyC"]),
  card("o-ta", "onset", "ta", "TA", ["KeyW", "KeyC"]),
  card("o-la", "onset", "la", "HRA", ["KeyR", "KeyF", "KeyC"]),
  card("o-nha", "onset", "nha", "TPRA", ["KeyW", "KeyE", "KeyF", "KeyC"]),
  card("o-cho", "onset", "cho", "KHO", ["KeyS", "KeyR", "KeyV"]),
  card("t-ma", "tone", "má", "PHAL", ["KeyE", "KeyR", "KeyC", "KeyO"]),
  card("t-ma2", "tone", "mà", "PHAG", ["KeyE", "KeyR", "KeyC", "KeyL"]),
  card("t-ma3", "tone", "mả", "PHAB", ["KeyE", "KeyR", "KeyC", "KeyK"]),
  card("t-ma4", "tone", "mã", "PHALG", [
    "KeyE",
    "KeyR",
    "KeyC",
    "KeyO",
    "KeyL",
  ]),
  card("t-ma5", "tone", "mạ", "PHABG", [
    "KeyE",
    "KeyR",
    "KeyC",
    "KeyK",
    "KeyL",
  ]),
  card("c-ban", "coda", "ban", "PWAR", ["KeyE", "KeyD", "KeyC", "KeyJ"]),
  card("c-bang", "coda", "bang", "PWAFR", [
    "KeyE",
    "KeyD",
    "KeyC",
    "KeyU",
    "KeyJ",
  ]),
  card("c-banh", "coda", "banh", "PWARP", [
    "KeyE",
    "KeyD",
    "KeyC",
    "KeyJ",
    "KeyI",
  ]),
  card("c-lam", "coda", "làm", "HRAPG", [
    "KeyR",
    "KeyF",
    "KeyC",
    "KeyI",
    "KeyL",
  ]),
  card(
    "c-mat",
    "coda",
    "mát",
    "PHARBL",
    ["KeyE", "KeyR", "KeyC", "KeyJ", "KeyK", "KeyO"],
    "Để viết “mát”, bấm cả cụm BL bên phải trong cùng một lần.",
  ),
  {
    id: "x-nay-troi",
    concept: "repair",
    target: "nay trời",
    strokes: ["TPHA*EFBLT"],
    keys: [
      "KeyW",
      "KeyE",
      "KeyR",
      "KeyC",
      "Space",
      "KeyN",
      "KeyU",
      "KeyK",
      "KeyO",
      "KeyP",
    ],
    note: "Bấm Space cùng các phím còn lại để viết hai tiếng trong một lần.",
    kind: "inference",
    islands: ["", "na0tro2"],
    selectionIndex: 0,
    piecemeal: {
      targetFromRight: 1,
      entryStroke: "T",
      entryLabel: "T-",
      entryKeys: ["KeyW"],
      replacementTarget: "mà",
      replacementStroke: "PHAG",
      replacementKeys: ["KeyE", "KeyR", "KeyC", "KeyL"],
    },
  },
  {
    id: "x-dep-lam",
    concept: "repair",
    target: "đẹp lắm",
    strokes: ["#STKWR*UFGTS"],
    keys: [
      "KeyQ",
      "KeyA",
      "KeyW",
      "KeyS",
      "KeyD",
      "KeyF",
      "Space",
      "KeyM",
      "KeyU",
      "KeyL",
      "KeyP",
      "Semicolon",
    ],
    note: "Sau lần bấm đầu, hệ thống sẽ đưa ra vài cách viết để bạn chọn.",
    kind: "inference",
    islands: ["", "dde7la1"],
    selectionIndex: 1,
    piecemeal: {
      targetFromRight: 2,
      entryStroke: "P",
      entryLabel: "P-",
      entryKeys: ["KeyE"],
      replacementTarget: "ba",
      replacementStroke: "PWA",
      replacementKeys: ["KeyE", "KeyD", "KeyC"],
    },
  },
  ...sentenceCards,
];

const byId = new Map(cards.map((item) => [item.id, item]));

export function getCard(id) {
  return byId.get(id) ?? null;
}

export function publicCard(item) {
  return {
    id: item.id,
    concept: item.concept,
    target: item.target,
    strokes: item.strokes,
    keys: item.keys,
    note: item.note,
    kind: item.kind,
    instruction: concepts[item.concept],
    selectionIndex: item.selectionIndex,
    piecemeal: item.piecemeal,
    category: item.category,
    pairs: item.pairs,
  };
}

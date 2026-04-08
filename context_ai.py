import os
import json
import numpy as np
import tensorflow as tf

# ============================================================================
# 1. PHONETIC CONSTRAINT & CANDIDATE GENERATION
# ============================================================================

def structured_onset(c, v):
    if c == "0": return ""
    if c == "w": return "qu"
    if c == "g" and v in ["e", "i"]: return "gh"
    if c == "ng" and v in ["e", "i"]: return "ngh"
    if c == "k" and v in ["e", "i"]: return "k"
    if c == "k": return "c"
    return c

def enumerate_regex(regex_str):
    chars = list(regex_str)
    idx = 0

    def append_cartesian(base, values):
        return [b + v for b in base for v in values]

    def append_optional(base, values):
        next_vals = []
        for b in base:
            for v in values:
                next_vals.append(b + v)
            next_vals.append(b)
        return next_vals

    def expand_expr():
        nonlocal idx
        alternatives = []
        current = [""]

        while idx < len(chars):
            c = chars[idx]
            if c == ")": break

            if c == "(":
                idx += 1
                if idx < len(chars) and chars[idx] == "?":
                    idx += 1
                    if idx < len(chars) and chars[idx] == ":": idx += 1
                nested = expand_expr()
                if idx < len(chars) and chars[idx] == ")": idx += 1

                if idx < len(chars) and chars[idx] == "?":
                    idx += 1
                    current = append_optional(current, nested)
                else:
                    current = append_cartesian(current, nested)
                continue

            if c == "[":
                idx += 1
                class_chars = []
                while idx < len(chars) and chars[idx] != "]":
                    class_chars.append(chars[idx])
                    idx += 1
                if idx < len(chars) and chars[idx] == "]": idx += 1

                if idx < len(chars) and chars[idx] == "?":
                    idx += 1
                    current = append_optional(current, class_chars)
                else:
                    current = append_cartesian(current, class_chars)
                continue

            if c == "|":
                alternatives.append(current)
                current = [""]
                idx += 1
                continue

            idx += 1
            if idx < len(chars) and chars[idx] == "?":
                idx += 1
                current = append_optional(current, [c])
            else:
                current = [s + c for s in current]

        alternatives.append(current)
        return [item for sublist in alternatives for item in sublist]

    return expand_expr()

def generate_structured_regex_map():
    mapping = {}
    structured_consonants = ["0", "b", "ch", "d", "g", "h", "k", "kh", "l", "m", "n", "ng", "nh", "p", "ph", "r", "s", "t", "th", "tr", "v", "w", "x", "z", "đ"]
    hard_consonants = {"b", "ch", "d", "g", "kh", "ng", "p", "ph", "r", "tr", "x", "đ"}

    a = ["(?:ă(?:m|ng?)|â(?:ng?|[muy])|a(?:(?:[imouy]|n(?:[gh])?))?)","(?:ắ(?:m|ng?)|ấ(?:ng?|[muy])|á(?:(?:[imouy]|n(?:[gh])?))?)","(?:ằ(?:m|ng?)|ầ(?:ng?|[muy])|à(?:(?:[imouy]|n(?:[gh])?))?)","(?:ẳ(?:m|ng?)|ẩ(?:ng?|[muy])|ả(?:(?:[imouy]|n(?:[gh])?))?)","(?:ẵ(?:m|ng?)|ẫ(?:ng?|[muy])|ã(?:(?:[imouy]|n(?:[gh])?))?)","(?:ặ(?:m|ng?)|ậ(?:ng?|[muy])|ạ(?:(?:[imouy]|n(?:[gh])?))?)","(?:[ấắ][cpt]|á(?:ch?|[pt]))","(?:[ậặ][cpt]|ạ(?:ch?|[pt]))"]
    e = ["(?:e(?:(?:ng?|[mo]))?|ê(?:(?:nh?|[mu]))?)","(?:é(?:(?:ng?|[mo]))?|ế(?:(?:nh?|[mu]))?)","(?:è(?:(?:ng?|[mo]))?|ề(?:(?:nh?|[mu]))?)","(?:ẻ(?:(?:ng?|[mo]))?|ể(?:(?:nh?|[mu]))?)","(?:ẽ(?:(?:ng?|[mo]))?|ễ(?:(?:nh?|[mu]))?)","(?:ẹ(?:(?:ng?|[mo]))?|ệ(?:(?:nh?|[mu]))?)","(?:é[cpt]|ế(?:ch|[pt]))","(?:ẹ[cpt]|ệ(?:ch|[pt]))"]
    o = ["(?:ơ(?:[imn])?|ô(?:(?:ng?|[im]))?|o(?:(?:ng?|ong|[im]|ă(?:m|ng?)|e(?:[no])?|a(?:(?:[imouy]|n(?:[gh])?))?))?)","(?:ớ(?:[imn])?|ố(?:(?:ng?|[im]))?|ó(?:(?:ng?|[aeim]))?|o(?:óng|é[no]|ắ(?:m|ng?)|á(?:[imouy]|n(?:[gh])?)))","(?:ờ(?:[imn])?|ồ(?:(?:ng?|[im]))?|ò(?:(?:ng?|[aeim]))?|o(?:òng|è[no]|ằ(?:m|ng?)|à(?:[imouy]|n(?:[gh])?)))","(?:ở(?:[imn])?|ổ(?:(?:ng?|[im]))?|ỏ(?:(?:ng?|[aeim]))?|o(?:ỏng|ẻ[no]|ẳ(?:m|ng?)|ả(?:[imouy]|n(?:[gh])?)))","(?:ỡ(?:[imn])?|ỗ(?:(?:ng?|[im]))?|õ(?:(?:ng?|[aeim]))?|o(?:õng|ẽ[no]|ẵ(?:m|ng?)|ã(?:[imouy]|n(?:[gh])?)))","(?:ợ(?:[imn])?|ộ(?:(?:ng?|[im]))?|ọ(?:(?:ng?|[aeim]))?|o(?:ọng|ẹ[no]|ặ(?:m|ng?)|ạ(?:[imouy]|n(?:[gh])?)))","(?:ớ[pt]|[óố][cpt]|o(?:ét|óc|ắ[cpt]|á(?:ch?|[pt])))","(?:ợ[pt]|[ọộ][cpt]|o(?:ẹt|ọc|ặ[cpt]|ạ(?:ch?|[pt])))"]
    u = ["(?:ư(?:(?:ng?|[aimu]|ơ(?:ng?|[imu])))?|u(?:(?:ng?|[aim]|ê(?:nh?)?|â(?:y|ng?)|ơ(?:[in])?|ô(?:ng?|[im])|y(?:(?:ên|nh?|[amu]))?))?)","(?:ướ(?:ng?|[imu])|ú(?:(?:ng?|[aimy]))?|ứ(?:(?:ng?|[aimu]))?|u(?:yến|ế(?:nh?)?|ấ(?:y|ng?)|ớ(?:[in])?|ố(?:ng?|[im])|ý(?:nh?|[amu])))","(?:ườ(?:ng?|[imu])|ù(?:(?:ng?|[aimy]))?|ừ(?:(?:ng?|[aimu]))?|u(?:yền|ề(?:nh?)?|ầ(?:y|ng?)|ờ(?:[in])?|ồ(?:ng?|[im])|ỳ(?:nh?|[amu])))","(?:ưở(?:ng?|[imu])|ủ(?:(?:ng?|[aimy]))?|ử(?:(?:ng?|[aimu]))?|u(?:yển|ể(?:nh?)?|ẩ(?:y|ng?)|ở(?:[in])?|ổ(?:ng?|[im])|ỷ(?:nh?|[amu])))","(?:ưỡ(?:ng?|[imu])|ũ(?:(?:ng?|[aimy]))?|ữ(?:(?:ng?|[aimu]))?|u(?:yễn|ễ(?:nh?)?|ẫ(?:y|ng?)|ỡ(?:[in])?|ỗ(?:ng?|[im])|ỹ(?:nh?|[amu])))","(?:ượ(?:ng?|[imu])|ụ(?:(?:ng?|[aimy]))?|ự(?:(?:ng?|[aimu]))?|u(?:yện|ệ(?:nh?)?|ậ(?:y|ng?)|ợ(?:[in])?|ộ(?:ng?|[im])|ỵ(?:nh?|[amu])))","(?:ướ[cpt]|[úứ][cpt]|u(?:ớt|yết|ấ[ct]|ố[cpt]|ế(?:t|ch)|ý(?:ch|[pt])))","(?:ượ[cpt]|[ụự][cpt]|u(?:ợt|yệt|ậ[ct]|ộ[cpt]|ệ(?:t|ch)|ỵ(?:ch|[pt])))"]
    iz = ["(?:i(?:(?:nh?|[amu]))?|y(?:ê(?:ng?|[mu]))?)","(?:ý|yế(?:ng?|[mu])|í(?:(?:nh?|[amu]))?)","(?:ỳ|yề(?:ng?|[mu])|ì(?:(?:nh?|[amu]))?)","(?:ỷ|yể(?:ng?|[mu])|ỉ(?:(?:nh?|[amu]))?)","(?:ỹ|yễ(?:ng?|[mu])|ĩ(?:(?:nh?|[amu]))?)","(?:ỵ|yệ(?:ng?|[mu])|ị(?:(?:nh?|[amu]))?)","(?:yế[cpt]|í(?:ch|[pt]))","(?:yệ[cpt]|ị(?:ch|[pt]))"]
    isz = ["(?:y|i(?:(?:nh?|[amu]|ê(?:ng?|[mu])))?)","(?:ý|iế(?:ng?|[mu])|í(?:(?:nh?|[amu]))?)","(?:ỳ|iề(?:ng?|[mu])|ì(?:(?:nh?|[amu]))?)","(?:ỷ|iể(?:ng?|[mu])|ỉ(?:(?:nh?|[amu]))?)","(?:ỹ|iễ(?:ng?|[mu])|ĩ(?:(?:nh?|[amu]))?)","(?:ỵ|iệ(?:ng?|[mu])|ị(?:(?:nh?|[amu]))?)","(?:iế[cpt]|í(?:ch|[pt]))","(?:iệ[cpt]|ị(?:ch|[pt]))"]
    ih = ["i(?:(?:nh?|[amu]|ê(?:ng?|[mu])))?","(?:iế(?:ng?|[mu])|í(?:(?:nh?|[amu]))?)","(?:iề(?:ng?|[mu])|ì(?:(?:nh?|[amu]))?)","(?:iể(?:ng?|[mu])|ỉ(?:(?:nh?|[amu]))?)","(?:iễ(?:ng?|[mu])|ĩ(?:(?:nh?|[amu]))?)","(?:iệ(?:ng?|[mu])|ị(?:(?:nh?|[amu]))?)","(?:iế[cpt]|í(?:ch|[pt]))","(?:iệ[cpt]|ị(?:ch|[pt]))"]
    wa = ["(?:ă(?:m|ng?)|â(?:y|ng?)|a(?:(?:[imouy]|n(?:[gh])?))?)","(?:ắ(?:m|ng?)|ấ(?:y|ng?)|á(?:(?:[imouy]|n(?:[gh])?))?)","(?:ằ(?:m|ng?)|ầ(?:y|ng?)|à(?:(?:[imouy]|n(?:[gh])?))?)","(?:ẳ(?:m|ng?)|ẩ(?:y|ng?)|ả(?:(?:[imouy]|n(?:[gh])?))?)","(?:ẵ(?:m|ng?)|ẫ(?:y|ng?)|ã(?:(?:[imouy]|n(?:[gh])?))?)","(?:ặ(?:m|ng?)|ậ(?:y|ng?)|ạ(?:(?:[imouy]|n(?:[gh])?))?)","(?:ấ[ct]|ắ[cpt]|á(?:ch?|[pt]))","(?:ậ[ct]|ặ[cpt]|ạ(?:ch?|[pt]))"]
    we = ["(?:ê(?:nh?)?|e(?:[no])?)","(?:ế(?:nh?)?|é(?:[no])?)","(?:ề(?:nh?)?|è(?:[no])?)","(?:ể(?:nh?)?|ẻ(?:[no])?)","(?:ễ(?:nh?)?|ẽ(?:[no])?)","(?:ệ(?:nh?)?|ẹ(?:[no])?)","(?:ét|ế(?:t|ch))","(?:ẹt|ệ(?:t|ch))"]
    wi = ["y(?:(?:ên|nh?|[amu]))?","(?:yến|ý(?:(?:nh?|[amu]))?)","(?:yền|ỳ(?:(?:nh?|[amu]))?)","(?:yển|ỷ(?:(?:nh?|[amu]))?)","(?:yễn|ỹ(?:(?:nh?|[amu]))?)","(?:yện|ỵ(?:(?:nh?|[amu]))?)","(?:yết|ý(?:ch|[pt]))","(?:yệt|ỵ(?:ch|[pt]))"]
    wo = ["(?:ông|ơ(?:[in])?)","(?:ống|ớ(?:[in])?)","(?:ồng|ờ(?:[in])?)","(?:ổng|ở(?:[in])?)","(?:ỗng|ỡ(?:[in])?)","(?:ộng|ợ(?:[in])?)","(?:ốc|ớt)","(?:ộc|ợt)"]
    ko = ["(?:ơ(?:[imn])?|ô(?:(?:ng?|[im]))?|o(?:(?:ng?|ong|[im]))?)","(?:oóng|ớ(?:[imn])?|[óố](?:(?:ng?|[im]))?)","(?:oòng|ờ(?:[imn])?|[òồ](?:(?:ng?|[im]))?)","(?:oỏng|ở(?:[imn])?|[ỏổ](?:(?:ng?|[im]))?)","(?:oõng|ỡ(?:[imn])?|[õỗ](?:(?:ng?|[im]))?)","(?:oọng|ợ(?:[imn])?|[ọộ](?:(?:ng?|[im]))?)","(?:oóc|ớ[pt]|[óố][cpt])","(?:oọc|ợ[pt]|[ọộ][cpt])"]
    ku = ["(?:u(?:(?:ng?|[aim]|ô(?:ng?|[im])))?|ư(?:(?:ng?|[aimu]|ơ(?:ng?|[imu])))?)","(?:uố(?:ng?|[im])|ướ(?:ng?|[imu])|ú(?:(?:ng?|[aim]))?|ứ(?:(?:ng?|[aimu]))?)","(?:uồ(?:ng?|[im])|ườ(?:ng?|[imu])|ù(?:(?:ng?|[aim]))?|ừ(?:(?:ng?|[aimu]))?)","(?:uổ(?:ng?|[im])|ưở(?:ng?|[imu])|ủ(?:(?:ng?|[aim]))?|ử(?:(?:ng?|[aimu]))?)","(?:uỗ(?:ng?|[im])|ưỡ(?:ng?|[imu])|ũ(?:(?:ng?|[aim]))?|ữ(?:(?:ng?|[aimu]))?)","(?:uộ(?:ng?|[im])|ượ(?:ng?|[imu])|ụ(?:(?:ng?|[aim]))?|ự(?:(?:ng?|[aimu]))?)","(?:uố[cpt]|ướ[cpt]|[úứ][cpt])","(?:uộ[cpt]|ượ[cpt]|[ụự][cpt])"]
    za = ["(?:ă(?:m|ng?)|â(?:ng?|[muy])|a(?:(?:[imouy]|n(?:[gh])?))?)","(?:ắ(?:m|ng?)|ấ(?:ng?|[muy])|á(?:(?:[imouy]|n(?:[gh])?))?)","(?:ằ(?:m|ng?)|ầ(?:ng?|[muy])|à(?:(?:[imouy]|n(?:[gh])?))?)","(?:ẳ(?:m|ng?)|ẩ(?:ng?|[muy])|ả(?:(?:[imouy]|n(?:[gh])?))?)","(?:ẵ(?:m|ng?)|ẫ(?:ng?|[muy])|ã(?:(?:[imouy]|n(?:[gh])?))?)","(?:ặ(?:m|ng?)|ậ(?:ng?|[muy])|ạ(?:(?:[imouy]|n(?:[gh])?))?)","(?:[ấắ][cpt]|á(?:ch?|[pt]))","(?:[ậặ][cpt]|ạ(?:ch?|[pt]))"]
    ze = ["e(?:(?:ng?|[mo]))?","é(?:(?:ng?|[mo]))?","è(?:(?:ng?|[mo]))?","ẻ(?:(?:ng?|[mo]))?","ẽ(?:(?:ng?|[mo]))?","ẹ(?:(?:ng?|[mo]))?","é[cpt]","ẹ[cpt]"]
    zo = ["(?:ơ(?:[imn])?|ô(?:(?:ng?|[im]))?|o(?:(?:ng?|ong|[im]))?)","(?:oóng|ớ(?:[imn])?|[óố](?:(?:ng?|[im]))?)","(?:oòng|ờ(?:[imn])?|[òồ](?:(?:ng?|[im]))?)","(?:oỏng|ở(?:[imn])?|[ỏổ](?:(?:ng?|[im]))?)","(?:oõng|ỡ(?:[imn])?|[õỗ](?:(?:ng?|[im]))?)","(?:oọng|ợ(?:[imn])?|[ọộ](?:(?:ng?|[im]))?)","(?:oóc|ớ[pt]|[óố][cpt])","(?:oọc|ợ[pt]|[ọộ][cpt])"]
    zu = ["(?:u(?:(?:ng?|[aim]|ô(?:i|ng)))?|ư(?:(?:ng?|[aimu]|ơ(?:ng?|[imu])))?)","(?:uố(?:i|ng)|ướ(?:ng?|[imu])|ú(?:(?:ng?|[aim]))?|ứ(?:(?:ng?|[aimu]))?)","(?:uồ(?:i|ng)|ườ(?:ng?|[imu])|ù(?:(?:ng?|[aim]))?|ừ(?:(?:ng?|[aimu]))?)","(?:uổ(?:i|ng)|ưở(?:ng?|[imu])|ủ(?:(?:ng?|[aim]))?|ử(?:(?:ng?|[aimu]))?)","(?:uỗ(?:i|ng)|ưỡ(?:ng?|[imu])|ũ(?:(?:ng?|[aim]))?|ữ(?:(?:ng?|[aimu]))?)","(?:uộ(?:i|ng)|ượ(?:ng?|[imu])|ụ(?:(?:ng?|[aim]))?|ự(?:(?:ng?|[aimu]))?)","(?:uốc|ướ[cpt]|[úứ][cpt])","(?:uộc|ượ[cpt]|[ụự][cpt])"]
    zi = ["g(?:i(?:[mn])?|iê(?:[mnu]|ng|nh)?)","g(?:í(?:[mn])?|iế(?:[mnu]|ng|nh)?)","g(?:ì(?:[mn])?|iề(?:[mnu]|ng|nh)?)","g(?:ỉ(?:[mn])?|iể(?:[mnu]|ng|nh)?)","g(?:ĩ(?:[mn])?|iễ(?:[mnu]|ng|nh)?)","g(?:ị(?:[mn])?|iệ(?:[mnu]|ng|nh)?)","g(?:í[pt]|iế(?:[cpt]|ch))","g(?:ị[pt]|iệ(?:[cpt]|ch))"]

    for c in structured_consonants:
        for v in ["a", "e", "i", "o", "u"]:
            if c == "w" and v == "u": continue
            for i in range(8):
                k = f"{c}_{v}_{i}"
                if c == "w":
                    vowels_map = {"a": wa, "e": we, "i": wi, "o": wo, "u": wo}
                    mapping[k] = f"qu{vowels_map[v][i]}"
                    continue
                if c == "z":
                    if v == "i":
                        mapping[k] = zi[i]
                    else:
                        vowels_map = {"a": za, "e": ze, "i": zi, "o": zo, "u": zu}
                        mapping[k] = f"gi{vowels_map[v][i]}"
                    continue
                if v == "i":
                    i_val = iz[i] if c == "0" else (ih[i] if c in hard_consonants else isz[i])
                    mapping[k] = f"{structured_onset(c, v)}{i_val}"
                    continue

                s = ""
                if v == "a": s = a[i]
                elif v == "e": s = e[i]
                elif v == "o": s = o[i]
                elif v == "u": s = u[i]
                
                if c == "k" and v == "o": s = ko[i]
                if c == "k" and v == "u": s = ku[i]
                
                mapping[k] = f"{structured_onset(c, v)}{s}"
    return mapping

class Tokenizer:
    def __init__(self):
        regex_map = generate_structured_regex_map()
        self.valid_consonants = {}
        self.candidates_index = {}
        
        for k, regex in regex_map.items():
            c = k.split("_")[0]
            self.valid_consonants[c] = c
            self.candidates_index[k] = enumerate_regex(regex)
            
        self.valid_consonants["dd"] = "đ"
        self.sorted_keys = sorted(self.valid_consonants.keys(), key=len, reverse=True)

TOKENIZER = Tokenizer()

def parse_v7_string(v7_str, tokenizer):
    templates = []
    current_slice = v7_str
    while current_slice:
        matched_key = next((k for k in tokenizer.sorted_keys if current_slice.startswith(k)), None)
        if not matched_key: raise ValueError(f"Parse error at: {current_slice}")
        
        consonant = tokenizer.valid_consonants[matched_key]
        current_slice = current_slice[len(matched_key):]
        
        rime, tone_char = current_slice[0], current_slice[1]
        tone = int(tone_char)
        current_slice = current_slice[2:]
        templates.append({"consonant": consonant, "rime": rime, "tone": tone})
    return templates

def get_inference(raw_input):
    result = []
    for i, chunk in enumerate(raw_input):
        if i % 2 == 0:
            result.append({"type": "fixed", "text": chunk})
        else:
            try:
                templates = parse_v7_string(chunk, TOKENIZER)
                for t in templates:
                    key = f"{t['consonant']}_{t['rime']}_{t['tone']}"
                    cands = TOKENIZER.candidates_index.get(key, [])
                    result.append({"type": "syllable", "candidates": cands})
            except Exception:
                result.append({"type": "syllable", "candidates": []})
    return result

# ============================================================================
# 2. AI MODEL (TensorFlow Streaming Training)
# ============================================================================

VOCAB_SIZE = 500
SEQ_LEN = 20
MODEL_PATH = "syllable_model.keras"

def char_to_int(c):
    return ord(c) % VOCAB_SIZE

def build_model():
    model = tf.keras.Sequential([
        tf.keras.layers.Embedding(input_dim=VOCAB_SIZE, output_dim=64, input_length=SEQ_LEN),
        tf.keras.layers.GRU(128, return_sequences=False),
        tf.keras.layers.Dense(VOCAB_SIZE, activation='softmax')
    ])
    model.compile(optimizer='adam', loss='sparse_categorical_crossentropy')
    return model

def text_generator(file_path, chunk_size=1024*1024):
    """Yields sequence chunks from a large file without loading it all in RAM."""
    with open(file_path, 'r', encoding='utf-8') as f:
        buffer = ""
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            buffer += chunk
            # Yield full sequences
            while len(buffer) > SEQ_LEN + 1000:
                text_slice = buffer[:1000 + SEQ_LEN]
                buffer = buffer[1000:]
                
                xs, ys = [], []
                for i in range(len(text_slice) - SEQ_LEN):
                    seq = [char_to_int(c) for c in text_slice[i:i+SEQ_LEN]]
                    next_char = char_to_int(text_slice[i+SEQ_LEN])
                    xs.append(seq)
                    ys.append(next_char)
                yield (np.array(xs), np.array(ys))

def train(file_path):
    print(f"Training on {file_path} using Streaming Generator...")
    model = build_model()
    
    # Create tf.data dataset from generator to feed GPU efficiently
    dataset = tf.data.Dataset.from_generator(
        lambda: text_generator(file_path),
        output_signature=(
            tf.TensorSpec(shape=(None, SEQ_LEN), dtype=tf.int32),
            tf.TensorSpec(shape=(None,), dtype=tf.int32)
        )
    ).prefetch(tf.data.AUTOTUNE)

    for step, (x_batch, y_batch) in enumerate(dataset):
        loss = model.train_on_batch(x_batch, y_batch)
        if step % 10 == 0:
            print(f"Step {step} - Loss: {loss:.4f}")

    model.save(MODEL_PATH)
    print(f"Model saved to {MODEL_PATH}")

# ============================================================================
# 3. BEAM SEARCH INFERENCE
# ============================================================================

def run_inference(input_json_str, beam_width=3):
    if not os.path.exists(MODEL_PATH):
        print(f"Model {MODEL_PATH} not found. Please train first.")
        return
        
    model = tf.keras.models.load_model(MODEL_PATH)
    raw_array = json.loads(input_json_str)
    positions = get_inference(raw_array)

    # Beam structure: {"text": string, "log_prob": float}
    beams = [{"text": "", "log_prob": 0.0}]

    print("Running Beam Search Inference...")
    for pos in positions:
        if pos["type"] == "fixed":
            for b in beams:
                b["text"] += pos["text"]
            continue
            
        cands = pos.get("candidates", [])
        if not cands: continue

        new_beams = []
        for b in beams:
            # Prepare the context padding
            context = b["text"]
            if len(context) < SEQ_LEN:
                context = context.rjust(SEQ_LEN, ' ')
            else:
                context = context[-SEQ_LEN:]
            
            # To speed things up, we batch predict all candidates for this specific beam
            # Because char-by-char prediction in pure python loops is slow,
            # we score each candidate word by accumulating log probs.
            for cand in cands:
                score = b["log_prob"]
                temp_context = context
                
                for char in cand:
                    seq_ids = np.array([[char_to_int(c) for c in temp_context]])
                    # Use model(inputs) instead of predict() for small batch speed
                    probs = model(seq_ids, training=False)[0].numpy() 
                    
                    target_id = char_to_int(char)
                    score += np.log(probs[target_id] + 1e-10)
                    
                    # slide context
                    temp_context = temp_context[1:] + char
                    
                new_beams.append({"text": b["text"] + cand, "log_prob": score})
                
        # Sort by best score and prune to beam_width
        new_beams.sort(key=lambda x: x["log_prob"], reverse=True)
        beams = new_beams[:beam_width]

    best_result = beams[0]["text"]
    print("\n--- INFERENCE COMPLETE ---")
    print(f"Resolved Text: {best_result}")
    return best_result

# ============================================================================
# EXECUTION ROUTER
# ============================================================================
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Context AI Training & Inference")
    parser.add_argument('--train', type=str, help='Path to corpus .txt file')
    parser.add_argument('--infer', type=str, help='JSON string of alternate fixed text and V7 tokens')
    parser.add_argument('--beam', type=int, default=3, help='Beam width for search (default 3)')
    args = parser.parse_args()

    if args.train:
        train(args.train)
    elif args.infer:
        run_inference(args.infer, beam_width=args.beam)
    else:
        print("Usage:")
        print("  python context_ai.py --train corpus.txt")
        print("  python context_ai.py --infer '[\"Tôi đang \", \"h5\", \" bài.\"]' --beam 3")

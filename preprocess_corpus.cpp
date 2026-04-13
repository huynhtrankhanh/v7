// preprocess_corpus.cpp
// Memory-efficient C++ rewrite of preprocess_corpus.py.
//
// Streams input files line-by-line so only one line is in RAM at a time,
// unlike the Python version which read entire files with f.read().
//
// Build:
//   g++ -O2 -std=c++17 -o preprocess_corpus preprocess_corpus.cpp
//
// Usage (same as the Python script):
//   ./preprocess_corpus <input_file_or_dir> <output.tok> <vocab.txt>

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <dirent.h>
#include <fstream>
#include <functional>
#include <iostream>
#include <set>
#include <string>
#include <sys/stat.h>
#include <unordered_map>
#include <unordered_set>
#include <vector>

// --- Constants (mirror preprocess_corpus.py) ---
static const int    TOP_NGRAMS      = 144000;
static const size_t PRUNE_THRESHOLD = 3000000;
static const size_t PRUNE_KEEP      = 1000000;
static const size_t CHECK_INTERVAL  = 200000;

// Punctuation marks kept as individual tokens (must all be ASCII).
static const std::string SUPPORTED_PUNCT = ".!,;:";

// ============================================================
// UTF-8 helpers
// ============================================================

// Decode one UTF-8 codepoint from *p, advance *p past it.
// Returns U+FFFD on any encoding error.
static uint32_t decode_utf8(const unsigned char*& p, const unsigned char* end) {
    if (p >= end) return 0;
    uint8_t b = *p;
    if ((b & 0x80) == 0) { return *p++; }
    if ((b & 0xE0) == 0xC0) {
        if (p + 1 < end && (p[1] & 0xC0) == 0x80) {
            uint32_t cp = ((uint32_t)(b & 0x1F) << 6) | (p[1] & 0x3F);
            p += 2; return cp;
        }
        p++; return 0xFFFD;
    }
    if ((b & 0xF0) == 0xE0) {
        if (p + 2 < end && (p[1] & 0xC0) == 0x80 && (p[2] & 0xC0) == 0x80) {
            uint32_t cp = ((uint32_t)(b & 0x0F) << 12)
                        | ((uint32_t)(p[1] & 0x3F) << 6)
                        |  (uint32_t)(p[2] & 0x3F);
            p += 3; return cp;
        }
        p++; return 0xFFFD;
    }
    if ((b & 0xF8) == 0xF0) {
        if (p + 3 < end && (p[1] & 0xC0) == 0x80
                        && (p[2] & 0xC0) == 0x80
                        && (p[3] & 0xC0) == 0x80) {
            uint32_t cp = ((uint32_t)(b & 0x07) << 18)
                        | ((uint32_t)(p[1] & 0x3F) << 12)
                        | ((uint32_t)(p[2] & 0x3F) << 6)
                        |  (uint32_t)(p[3] & 0x3F);
            p += 4; return cp;
        }
        p++; return 0xFFFD;
    }
    p++; return 0xFFFD;
}

// Append the UTF-8 encoding of codepoint cp to buf.
static void encode_utf8(uint32_t cp, std::string& buf) {
    if (cp < 0x80) {
        buf += (char)cp;
    } else if (cp < 0x800) {
        buf += (char)(0xC0 | (cp >> 6));
        buf += (char)(0x80 | (cp & 0x3F));
    } else if (cp < 0x10000) {
        buf += (char)(0xE0 | (cp >> 12));
        buf += (char)(0x80 | ((cp >> 6) & 0x3F));
        buf += (char)(0x80 | (cp & 0x3F));
    } else {
        buf += (char)(0xF0 | (cp >> 18));
        buf += (char)(0x80 | ((cp >> 12) & 0x3F));
        buf += (char)(0x80 | ((cp >> 6) & 0x3F));
        buf += (char)(0x80 | (cp & 0x3F));
    }
}

// Return true if cp is a Unicode letter in the ranges relevant to Latin / Vietnamese.
static bool is_unicode_letter(uint32_t cp) {
    if (cp >= 0x0041 && cp <= 0x005A) return true; // A–Z
    if (cp >= 0x0061 && cp <= 0x007A) return true; // a–z
    if (cp >= 0x00C0 && cp <= 0x00D6) return true; // À–Ö
    if (cp >= 0x00D8 && cp <= 0x00F6) return true; // Ø–ö
    if (cp >= 0x00F8 && cp <= 0x02AF) return true; // ø–ʯ  (Latin Ext-A/B, IPA)
    if (cp >= 0x1E00 && cp <= 0x1EFF) return true; // Latin Extended Additional (Vietnamese)
    return false;
}

// Return the lowercase codepoint for cp (covers ASCII + Vietnamese-relevant ranges).
static uint32_t unicode_tolower(uint32_t cp) {
    if (cp >= 0x41 && cp <= 0x5A) return cp + 0x20;         // A–Z
    if (cp >= 0xC0 && cp <= 0xD6) return cp + 0x20;         // À–Ö
    if (cp >= 0xD8 && cp <= 0xDE) return cp + 0x20;         // Ø–Þ
    // Latin Extended-A (U+0100..U+012E): uppercase at even offsets, lowercase at odd.
    if (cp >= 0x0100 && cp <= 0x012E && (cp & 1) == 0) return cp + 1;
    // Vietnamese-specific letters not covered by the range above.
    if (cp == 0x01A0) return 0x01A1; // Ơ → ơ
    if (cp == 0x01AF) return 0x01B0; // Ư → ư
    // Latin Extended Additional (U+1E00..U+1EFE): uppercase at even, lowercase at odd.
    if (cp >= 0x1E00 && cp <= 0x1EFE && (cp & 1) == 0) return cp + 1;
    return cp;
}

// Return a lowercased copy of a UTF-8 string.
static std::string utf8_tolower(const std::string& s) {
    std::string result;
    result.reserve(s.size());
    const unsigned char* p   = (const unsigned char*)s.data();
    const unsigned char* end = p + s.size();
    while (p < end) encode_utf8(unicode_tolower(decode_utf8(p, end)), result);
    return result;
}

// Return true if every codepoint in the UTF-8 string s is a Unicode letter.
static bool is_valid_syllable(const std::string& s) {
    if (s.empty()) return false;
    const unsigned char* p   = (const unsigned char*)s.data();
    const unsigned char* end = p + s.size();
    while (p < end) {
        uint32_t cp = decode_utf8(p, end);
        if (cp == 0xFFFD || !is_unicode_letter(cp)) return false;
    }
    return true;
}

// ============================================================
// Tokenisation
// ============================================================

// Split a lowercased line into syllable tokens and supported-punct tokens.
// Non-letter, non-punct characters act as delimiters and are dropped.
static void tokenize_line(const std::string& line,
                          std::vector<std::string>& tokens) {
    tokens.clear();
    std::string current;
    const unsigned char* p   = (const unsigned char*)line.data();
    const unsigned char* end = p + line.size();
    while (p < end) {
        const unsigned char* char_start = p;
        uint32_t cp = decode_utf8(p, end);
        if (is_unicode_letter(cp)) {
            current.append((const char*)char_start, p - char_start);
        } else {
            char c = (cp < 128) ? (char)cp : '\0';
            bool is_punct = (c != '\0' && SUPPORTED_PUNCT.find(c) != std::string::npos);
            if (!current.empty()) {
                if (is_valid_syllable(current)) tokens.push_back(std::move(current));
                current.clear();
            }
            if (is_punct) tokens.push_back(std::string(1, c));
        }
    }
    if (!current.empty() && is_valid_syllable(current))
        tokens.push_back(std::move(current));
}

// ============================================================
// N-gram counter
// ============================================================

using Counter = std::unordered_map<std::string, uint32_t>;

// Prune counter in-place, keeping only the top PRUNE_KEEP entries by count.
static void prune_counter(Counter& ctr) {
    if (ctr.size() <= PRUNE_KEEP) return;
    // Collect counts, find the PRUNE_KEEP-th largest via nth_element (O(N)).
    std::vector<uint32_t> counts;
    counts.reserve(ctr.size());
    for (const auto& kv : ctr) counts.push_back(kv.second);
    std::nth_element(counts.begin(),
                     counts.begin() + (long)(PRUNE_KEEP - 1),
                     counts.end(),
                     std::greater<uint32_t>());
    uint32_t threshold = counts[PRUNE_KEEP - 1];
    Counter pruned;
    pruned.reserve(PRUNE_KEEP + 16);
    for (auto& kv : ctr)
        if (kv.second >= threshold) pruned.emplace(std::move(kv));
    ctr = std::move(pruned);
}

// ============================================================
// File reading (streaming, with UTF-16 BOM detection)
// ============================================================

// Return true if the file starts with a UTF-16 BOM (LE or BE).
static bool has_utf16_bom(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return false;
    unsigned char bom[2] = {0, 0};
    f.read((char*)bom, 2);
    return (bom[0] == 0xFF && bom[1] == 0xFE)
        || (bom[0] == 0xFE && bom[1] == 0xFF);
}

// Convert a UTF-16 byte buffer (with BOM) to a UTF-8 string.
static std::string utf16_to_utf8(const std::vector<char>& buf) {
    std::string result;
    result.reserve(buf.size());
    const unsigned char* p   = (const unsigned char*)buf.data();
    const unsigned char* end = p + buf.size();
    if (end - p < 2) return result;

    bool big_endian = (p[0] == 0xFE);
    p += 2; // skip BOM

    while (p + 1 < end) {
        uint16_t hi = big_endian
                    ? ((uint16_t)p[0] << 8 | p[1])
                    : ((uint16_t)p[1] << 8 | p[0]);
        p += 2;
        uint32_t cp;
        if (hi >= 0xD800 && hi <= 0xDBFF) {
            // surrogate pair
            if (p + 1 < end) {
                uint16_t lo = big_endian
                            ? ((uint16_t)p[0] << 8 | p[1])
                            : ((uint16_t)p[1] << 8 | p[0]);
                p += 2;
                cp = 0x10000u + (((uint32_t)(hi - 0xD800u)) << 10) + (lo - 0xDC00u);
            } else break;
        } else {
            cp = hi;
        }
        encode_utf8(cp, result);
    }
    return result;
}

// Call callback(line) for every line in the file at path.
// Handles UTF-8 (streamed, O(1) memory per line) and UTF-16 (full file read,
// then iterated line-by-line — UTF-16 corpora are rare for Vietnamese).
static void read_lines(const std::string& path,
                       const std::function<void(const std::string&)>& callback) {
    if (has_utf16_bom(path)) {
        std::ifstream f(path, std::ios::binary | std::ios::ate);
        if (!f) { std::cerr << "Warning: cannot open " << path << "\n"; return; }
        auto size = f.tellg();
        f.seekg(0);
        std::vector<char> raw((size_t)size);
        f.read(raw.data(), (std::streamsize)size);
        f.close();
        std::string utf8 = utf16_to_utf8(raw);
        raw.clear();
        raw.shrink_to_fit();
        size_t start = 0;
        for (size_t i = 0; i < utf8.size(); ++i) {
            if (utf8[i] == '\n') {
                callback(utf8.substr(start, i - start));
                start = i + 1;
            }
        }
        if (start < utf8.size()) callback(utf8.substr(start));
    } else {
        std::ifstream f(path);
        if (!f) { std::cerr << "Warning: cannot open " << path << "\n"; return; }
        std::string line;
        while (std::getline(f, line)) callback(line);
    }
}

// Recursively collect all *.txt files under dir_path (sorted).
static void collect_txt_files(const std::string& dir_path,
                               std::vector<std::string>& out) {
    DIR* dir = opendir(dir_path.c_str());
    if (!dir) return;
    std::vector<std::string> subdirs;
    struct dirent* entry;
    while ((entry = readdir(dir)) != nullptr) {
        if (entry->d_name[0] == '.') continue;
        std::string full = dir_path + "/" + entry->d_name;
        struct stat st{};
        if (stat(full.c_str(), &st) != 0) continue;
        if (S_ISDIR(st.st_mode)) {
            subdirs.push_back(full);
        } else if (S_ISREG(st.st_mode)) {
            size_t len = strlen(entry->d_name);
            if (len >= 4 && strcmp(entry->d_name + len - 4, ".txt") == 0)
                out.push_back(full);
        }
    }
    closedir(dir);
    std::sort(subdirs.begin(), subdirs.end());
    for (const auto& sub : subdirs) collect_txt_files(sub, out);
}

// Call callback(line) for every line in input_path (file or directory).
static void iter_lines(const std::string& input_path,
                       const std::function<void(const std::string&)>& callback) {
    struct stat st{};
    if (stat(input_path.c_str(), &st) != 0) {
        std::cerr << "Error: cannot stat " << input_path << "\n";
        return;
    }
    if (S_ISDIR(st.st_mode)) {
        std::vector<std::string> files;
        collect_txt_files(input_path, files);
        std::sort(files.begin(), files.end());
        size_t total = files.size(), done = 0;
        for (const auto& fp : files) {
            ++done;
            std::cerr << "\rReading files: " << done << "/" << total
                      << "  " << std::flush;
            read_lines(fp, callback);
        }
        std::cerr << "\n";
    } else {
        read_lines(input_path, callback);
    }
}

// ============================================================
// Pass 1: count bigrams and trigrams
// ============================================================

static void count_ngrams(const std::string& input_path,
                         Counter& bigrams, Counter& trigrams) {
    std::vector<std::string> tokens, syllables;
    size_t items_since_check = 0;
    size_t lines_processed   = 0;

    iter_lines(input_path, [&](const std::string& raw_line) {
        ++lines_processed;
        if (lines_processed % 1000000 == 0)
            std::cerr << "  Pass 1: " << lines_processed / 1000000 << "M lines\n";

        // Strip trailing CR/spaces and lowercase.
        std::string line = raw_line;
        while (!line.empty() && (line.back() == '\r' || line.back() == ' '
                               || line.back() == '\t'))
            line.pop_back();
        if (line.empty()) return;
        line = utf8_tolower(line);

        tokenize_line(line, tokens);

        syllables.clear();
        for (const auto& t : tokens)
            if (is_valid_syllable(t)) syllables.push_back(t);

        size_t n = syllables.size();
        for (size_t i = 0; i + 1 < n; ++i) {
            // Bigram key: "s1_s2"
            std::string bg = syllables[i] + '_' + syllables[i + 1];
            bigrams[bg]++;

            // Trigram key: "s1_s2_s3"
            if (i + 2 < n) {
                std::string tg = bg + '_' + syllables[i + 2];
                trigrams[tg]++;
            }

            if (++items_since_check >= CHECK_INTERVAL) {
                items_since_check = 0;
                if (bigrams.size()  > PRUNE_THRESHOLD) {
                    std::cerr << "  Pruning bigrams  (" << bigrams.size()
                              << " -> ~" << PRUNE_KEEP << ")...\n";
                    prune_counter(bigrams);
                }
                if (trigrams.size() > PRUNE_THRESHOLD) {
                    std::cerr << "  Pruning trigrams (" << trigrams.size()
                              << " -> ~" << PRUNE_KEEP << ")...\n";
                    prune_counter(trigrams);
                }
            }
        }
    });

    // Final prune.
    if (bigrams.size()  > PRUNE_THRESHOLD) prune_counter(bigrams);
    if (trigrams.size() > PRUNE_THRESHOLD) prune_counter(trigrams);
}

// ============================================================
// N-gram selection: top TOP_NGRAMS by frequency
// ============================================================

static void select_top_ngrams(const Counter& bigrams,
                               const Counter& trigrams,
                               std::unordered_set<std::string>& bigram_set,
                               std::unordered_set<std::string>& trigram_set) {
    // Merge bigrams and trigrams into one list for unified top-K selection.
    std::vector<std::pair<std::string, uint32_t>> combined;
    combined.reserve(bigrams.size() + trigrams.size());
    for (const auto& kv : bigrams)  combined.push_back(kv);
    for (const auto& kv : trigrams) combined.push_back(kv);

    std::sort(combined.begin(), combined.end(),
              [](const auto& a, const auto& b) { return a.second > b.second; });

    size_t top = std::min((size_t)TOP_NGRAMS, combined.size());
    for (size_t i = 0; i < top; ++i) {
        const std::string& s = combined[i].first;
        // Count underscores: 1 → bigram, 2 → trigram.
        int underscores = 0;
        for (char c : s) if (c == '_') ++underscores;
        if      (underscores == 1) bigram_set.insert(s);
        else if (underscores == 2) trigram_set.insert(s);
    }
}

// ============================================================
// Syllable grouping (greedy, trigram preferred over bigram)
// ============================================================

static void group_syllables(const std::vector<std::string>& syllables,
                             const std::unordered_set<std::string>& trigram_set,
                             const std::unordered_set<std::string>& bigram_set,
                             std::vector<std::string>& result) {
    result.clear();
    size_t i = 0;
    while (i < syllables.size()) {
        if (i + 2 < syllables.size()) {
            std::string tg = syllables[i] + '_' + syllables[i + 1] + '_' + syllables[i + 2];
            if (trigram_set.count(tg)) { result.push_back(std::move(tg)); i += 3; continue; }
        }
        if (i + 1 < syllables.size()) {
            std::string bg = syllables[i] + '_' + syllables[i + 1];
            if (bigram_set.count(bg)) { result.push_back(std::move(bg)); i += 2; continue; }
        }
        result.push_back(syllables[i]);
        ++i;
    }
}

// ============================================================
// Main
// ============================================================

int main(int argc, char* argv[]) {
    if (argc < 4) {
        std::cerr << "Usage: " << argv[0]
                  << " <input_file_or_dir> <output.tok> <vocab.txt>\n";
        return 1;
    }
    const std::string input_path = argv[1];
    const std::string tok_path   = argv[2];
    const std::string vocab_path = argv[3];

    // ------- Pass 1: count n-grams -------
    std::cerr << "Pass 1: counting syllable bigrams and trigrams...\n";
    Counter bigrams, trigrams;
    count_ngrams(input_path, bigrams, trigrams);
    std::cerr << "  Found " << bigrams.size() << " unique bigrams, "
              << trigrams.size() << " unique trigrams\n";

    std::unordered_set<std::string> bigram_set, trigram_set;
    select_top_ngrams(bigrams, trigrams, bigram_set, trigram_set);
    std::cerr << "  Selected " << trigram_set.size() << " trigrams and "
              << bigram_set.size() << " bigrams (top " << TOP_NGRAMS << " total)\n";

    // Free pass-1 data before pass 2.
    { Counter tmp; bigrams.swap(tmp); }
    { Counter tmp; trigrams.swap(tmp); }

    // ------- Pass 2: write tokenised corpus -------
    std::cerr << "Pass 2: grouping syllables and writing corpus...\n";

    std::ofstream fout(tok_path);
    if (!fout) {
        std::cerr << "Error: cannot open output file " << tok_path << "\n";
        return 1;
    }
    // Use a large write buffer to reduce syscall overhead.
    static char out_buf[4 * 1024 * 1024];
    fout.rdbuf()->pubsetbuf(out_buf, sizeof(out_buf));

    std::unordered_set<std::string> vocab;
    size_t written = 0;
    std::vector<std::string> tokens, syllable_buf, grouped, result_tokens;

    iter_lines(input_path, [&](const std::string& raw_line) {
        std::string line = raw_line;
        while (!line.empty() && (line.back() == '\r' || line.back() == ' '
                               || line.back() == '\t'))
            line.pop_back();
        if (line.empty()) return;
        line = utf8_tolower(line);

        tokenize_line(line, tokens);

        result_tokens.clear();
        syllable_buf.clear();
        for (const auto& tok : tokens) {
            if (is_valid_syllable(tok)) {
                syllable_buf.push_back(tok);
            } else {
                if (!syllable_buf.empty()) {
                    group_syllables(syllable_buf, trigram_set, bigram_set, grouped);
                    for (auto& g : grouped) result_tokens.push_back(std::move(g));
                    syllable_buf.clear();
                }
                result_tokens.push_back(tok);
            }
        }
        if (!syllable_buf.empty()) {
            group_syllables(syllable_buf, trigram_set, bigram_set, grouped);
            for (auto& g : grouped) result_tokens.push_back(std::move(g));
        }

        if (!result_tokens.empty()) {
            for (const auto& t : result_tokens) vocab.insert(t);
            for (size_t i = 0; i < result_tokens.size(); ++i) {
                if (i > 0) fout << ' ';
                fout << result_tokens[i];
            }
            fout << '\n';
            ++written;
            if (written % 1000000 == 0)
                std::cerr << "  Pass 2: " << written / 1000000 << "M sentences written\n";
        }
    });

    fout.flush();
    std::cerr << "Sentences written : " << written << "\n";
    std::cerr << "Vocabulary size   : " << vocab.size() << " tokens\n";

    // Write vocabulary (sorted).
    std::set<std::string> sorted_vocab(vocab.begin(), vocab.end());
    std::ofstream fvocab(vocab_path);
    if (!fvocab) {
        std::cerr << "Error: cannot open vocab file " << vocab_path << "\n";
        return 1;
    }
    for (const auto& w : sorted_vocab) fvocab << w << '\n';
    std::cerr << "Vocabulary written : " << vocab_path << "\n";

    return 0;
}

import re
import sys
from tqdm import tqdm

def preprocess(input_path, output_path):
    # Regex to keep only letters and spaces.
    # We want to keep Vietnamese characters.
    # simpler approach: remove specific punctuation or keep only \w.
    # Python's \w matches Unicode letters.
    
    with open(input_path, 'r', encoding='utf-8') as fin, open(output_path, 'w', encoding='utf-8') as fout:
        for line in tqdm(fin, desc="Processing"):
            line = line.lower()
            # Replace non-word characters with space (excluding spaces)
            # This handles "TP.HCM" -> "tp hcm" if we replace '.' with ' '.
            # We want to preserve newlines as sentence boundaries?
            # KenLM expects one sentence per line.
            
            # Replace any character that is NOT a letter or whitespace with a space
            # This effectively splits "abc.def" into "abc def"
            line = re.sub(r'[^\w\s]', ' ', line)
            
            # Remove digits and underscores if necessary?
            # renum.json doesn't seem to have them.
            line = re.sub(r'[\d_]', ' ', line)
            
            tokens = line.split()
            if tokens:
                fout.write(' '.join(tokens) + '\n')

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python preprocess_corpus.py <input> <output>")
        sys.exit(1)
    
    preprocess(sys.argv[1], sys.argv[2])

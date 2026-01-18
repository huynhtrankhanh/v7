import json
import os
import shutil
import sys
import os

# Add repo root to path
sys.path.append(os.path.abspath(os.getcwd()))

from utils.preprocess import remove_diacritics

def migrate():
    renum_path = 'checkpoints/renum.json'
    renum_crt_path = 'checkpoints/renum_crt.json'
    
    print("Loading data...")
    with open(renum_path, 'r', encoding='utf-8') as f:
        renum = json.load(f)
    
    with open(renum_crt_path, 'r', encoding='utf-8') as f:
        renum_crt = json.load(f)
    
    print("Backing up renum_crt.json...")
    shutil.copy(renum_crt_path, renum_crt_path + '.bak')
    
    modified_count = 0
    missing_targets = []
    
    # Create a lookup map for speed
    # renum might have duplicates? Should be unique.
    renum_map = {word: idx for idx, word in enumerate(renum) if word is not None}
    
    for i, word in enumerate(renum):
        if word is None:
            continue
        
        if word.startswith("qu"):
            rest = word[2:]
            
            # Identify the target word to look up for rime info
            target = rest
            target_idx = renum_map.get(target)
            
            if target_idx is None:
                # Check if it starts with y (normalized)
                normalized_target = remove_diacritics(target)
                if normalized_target.startswith('y'):
                    # Try replacing initial 'y' (and its tone?) with 'i' (and same tone?)
                    # Wait, 'ỳnh' -> 'ình'. 'y' -> 'i'.
                    # We need to construct the 'i' version with the SAME tone.
                    # But 'i' + 'nh' + tone?
                    # The 'rest' string 'ỳnh' already contains the tone on 'y'.
                    # If we replace 'ỳ' with 'ì', we keep the tone.
                    # 'ý' -> 'í'.
                    # 'y' -> 'i'.
                    # We need a map of y-char to i-char.
                    
                    y_map = {
                        'y': 'i',
                        'ý': 'í',
                        'ỳ': 'ì',
                        'ỷ': 'ỉ',
                        'ỹ': 'ĩ',
                        'ỵ': 'ị'
                    }
                    
                    first_char = target[0]
                    if first_char in y_map:
                        alt_target = y_map[first_char] + target[1:]
                        target_idx = renum_map.get(alt_target)
            
            if target_idx is not None:
                source_crt = renum_crt[target_idx]
                if source_crt is None:
                    # Should not happen for valid words
                    print(f"Warning: CRT is null for {target} (index {target_idx})")
                    continue
                
                # source_crt is [onset, rime, tone]
                # We want new [onset="w", rime=source_crt[1], tone=source_crt[2]]
                # Actually, strictly speaking, tone matches, but rime is what we want.
                
                new_rime = source_crt[1]
                new_tone = source_crt[2]
                
                # Check consistency of tone?
                # The tone of the 'rest' syllable should match the tone of the 'qu' syllable.
                # If they matched in lookup, they match in tone.
                
                new_crt = ["w", new_rime, new_tone]
                
                # Update
                # Only update if different (though it will be different due to onset 'k' vs 'w')
                renum_crt[i] = new_crt
                modified_count += 1
                
                if modified_count < 5:
                    print(f"Example change: {word} {renum_crt[i]} -> {new_crt}")
            else:
                missing_targets.append(word)
    
    print(f"Total modified entries: {modified_count}")
    if missing_targets:
        print(f"Could not find decomposition for {len(missing_targets)} words. Examples: {missing_targets[:10]}")
    
    print("Saving renum_crt.json...")
    with open(renum_crt_path, 'w', encoding='utf-8') as f:
        json.dump(renum_crt, f, ensure_ascii=False)
    
    print("Migration complete.")

if __name__ == "__main__":
    migrate()

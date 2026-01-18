import json

def check_regexes():
    path = 'ai/generated_regexes.json'
    with open(path, 'r', encoding='utf-8') as f:
        regexes = json.load(f)
    
    keys_to_check = ["w_a_0", "w_i_2", "k_o_0", "k_u_6"]
    
    for key in keys_to_check:
        if key in regexes:
            print(f"Key {key} found. Regex: {regexes[key][:50]}...")
        else:
            print(f"Key {key} NOT found.")

if __name__ == "__main__":
    check_regexes()

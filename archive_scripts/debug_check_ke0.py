import json

def check_ke0():
    path = 'ai/generated_regexes.json'
    with open(path, 'r', encoding='utf-8') as f:
        regexes = json.load(f)
    
    key = "k_e_0"
    if key in regexes:
        print(f"Key {key} regex: {regexes[key][:50]}...")
    else:
        print(f"Key {key} NOT found.")

if __name__ == "__main__":
    check_ke0()

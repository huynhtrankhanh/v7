import json

def check_oc():
    with open('checkpoints/renum.json', 'r') as f:
        renum = json.load(f)
    with open('checkpoints/renum_crt.json', 'r') as f:
        renum_crt = json.load(f)
    
    targets = ["ốc", "uốc", "ông", "uông"]
    
    for word in targets:
        try:
            idx = renum.index(word)
            crt = renum_crt[idx]
            print(f"{word:<10} | {idx:<6} | {crt}")
        except ValueError:
            print(f"{word:<10} | {'N/A':<6} | N/A")

if __name__ == "__main__":
    check_oc()

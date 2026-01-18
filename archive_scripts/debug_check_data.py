import json

def check_entries():
    with open('checkpoints/renum.json', 'r') as f:
        renum = json.load(f)
    
    with open('checkpoints/renum_crt.json', 'r') as f:
        renum_crt = json.load(f)
    
    targets = ["qua", "quốc", "cua", "ca", "kem", "cuốc"]
    
    print(f"{'Word':<10} | {'Index':<6} | {'Renum CRT':<20}")
    print("-" * 40)
    
    for word in targets:
        try:
            idx = renum.index(word)
            crt = renum_crt[idx]
            print(f"{word:<10} | {idx:<6} | {crt}")
        except ValueError:
            print(f"{word:<10} | {'N/A':<6} | N/A")

if __name__ == "__main__":
    check_entries()

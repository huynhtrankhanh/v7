import json

def check_quynh_updated():
    with open('checkpoints/renum_crt.json', 'r') as f:
        renum_crt = json.load(f)
    
    # quỳnh is at index 6229 (from previous check)
    print(f"Index 6229: {renum_crt[6229]}")

if __name__ == "__main__":
    check_quynh_updated()

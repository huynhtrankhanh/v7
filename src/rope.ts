// Minimal Rope implementation using a Treap with SipHash-based priorities.
// Designed for efficient concatenation/substring extraction for text buffer operations.

type Node = {
  left: Node | null;
  right: Node | null;
  data: string;
  priority: number;
  size: number;
};

function nodeSize(n: Node | null): number {
  return n ? n.size : 0;
}

function recalc(n: Node): void {
  n.size = n.data.length + nodeSize(n.left) + nodeSize(n.right);
}

// SipHash-based PRNG
class SipHashRng {
  private k0: bigint;
  private k1: bigint;
  private counter = 0n;

  constructor() {
    const bytes = new Uint32Array(4);
    if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
      globalThis.crypto.getRandomValues(bytes);
    } else {
      // Fallback for environments without Web Crypto (should not happen in browser)
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Math.floor(Math.random() * 0xffffffff);
      }
    }
    this.k0 = (BigInt(bytes[0]) << 32n) | BigInt(bytes[1]);
    this.k1 = (BigInt(bytes[2]) << 32n) | BigInt(bytes[3]);
  }

  next(): number {
    const out = Number(siphash24(this.counter++, this.k0, this.k1) & 0xffffffffn);
    return out >>> 0;
  }
}

// SipHash-2-4 implementation adapted for bigint arithmetic.
function siphash24(msg: bigint, k0: bigint, k1: bigint): bigint {
  let v0 = 0x736f6d6570736575n ^ k0;
  let v1 = 0x646f72616e646f6dn ^ k1;
  let v2 = 0x6c7967656e657261n ^ k0;
  let v3 = 0x7465646279746573n ^ k1;

  const m = msg & 0xffffffffffffffffn;
  v3 ^= m;
  for (let i = 0; i < 2; i++) [v0, v1, v2, v3] = sipRound(v0, v1, v2, v3);
  v0 ^= m;

  v2 ^= 0xffn;
  for (let i = 0; i < 4; i++) [v0, v1, v2, v3] = sipRound(v0, v1, v2, v3);

  return (v0 ^ v1 ^ v2 ^ v3) & 0xffffffffffffffffn;
}

function sipRound(v0: bigint, v1: bigint, v2: bigint, v3: bigint): [bigint, bigint, bigint, bigint] {
  v0 += v1;
  v1 = rotl(v1, 13n);
  v1 ^= v0;
  v0 = rotl(v0, 32n);
  v2 += v3;
  v3 = rotl(v3, 16n);
  v3 ^= v2;
  v0 += v3;
  v3 = rotl(v3, 21n);
  v3 ^= v0;
  v2 += v1;
  v1 = rotl(v1, 17n);
  v1 ^= v2;
  v2 = rotl(v2, 32n);
  return [v0, v1, v2, v3];
}

function rotl(x: bigint, b: bigint): bigint {
  return ((x << b) & 0xffffffffffffffffn) | (x >> (64n - b));
}

export class Rope {
  private root: Node | null = null;
  private rng = new SipHashRng();

  static fromString(text: string): Rope {
    const r = new Rope();
    if (text.length > 0) {
      r.root = { left: null, right: null, data: text, priority: r.rng.next(), size: text.length };
    }
    return r;
  }

  append(text: string): void {
    if (!text) return;
    const newNode: Node = { left: null, right: null, data: text, priority: this.rng.next(), size: text.length };
    this.root = merge(this.root, newNode);
  }

  concat(other: Rope): void {
    if (!other.root) return;
    this.root = merge(this.root, cloneNode(other.root));
  }

  toString(): string {
    const chunks: string[] = [];
    inorder(this.root, chunks);
    return chunks.join("");
  }

  length(): number {
    return nodeSize(this.root);
  }
}

function merge(a: Node | null, b: Node | null): Node | null {
  if (!a) return b;
  if (!b) return a;
  if (a.priority > b.priority) {
    a.right = merge(a.right, b);
    recalc(a);
    return a;
  } else {
    b.left = merge(a, b.left);
    recalc(b);
    return b;
  }
}

function inorder(n: Node | null, out: string[]): void {
  if (!n) return;
  inorder(n.left, out);
  out.push(n.data);
  inorder(n.right, out);
}

function cloneNode(n: Node | null): Node | null {
  if (!n) return null;
  return {
    data: n.data,
    priority: n.priority,
    size: n.size,
    left: cloneNode(n.left),
    right: cloneNode(n.right)
  };
}

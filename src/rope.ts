// Minimal Rope implementation using a Treap with SipHash-based priorities.
// Designed for efficient concatenation/substring extraction for text buffer operations.

type Node<T> = {
  left: Node<T> | null;
  right: Node<T> | null;
  data: T;
  priority: number;
  size: number;
};

type Measure<T> = (value: T) => number;
type Mapper<T> = (value: T) => string;

function nodeSize<T>(n: Node<T> | null): number {
  return n ? n.size : 0;
}

function recalc<T>(n: Node<T>, measure: Measure<T>): void {
  n.size = measure(n.data) + nodeSize(n.left) + nodeSize(n.right);
}

function rebuild<T>(
  n: Node<T>,
  left: Node<T> | null,
  right: Node<T> | null,
  measure: Measure<T>
): Node<T> {
  if (n.left === left && n.right === right) {
    return n;
  }
  const next: Node<T> = { ...n, left, right };
  recalc(next, measure);
  return next;
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

  clone(): SipHashRng {
    const copy = new SipHashRng();
    copy.k0 = this.k0;
    copy.k1 = this.k1;
    copy.counter = this.counter;
    return copy;
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

export class Rope<T = string> {
  private root: Node<T> | null;
  private rng: SipHashRng;
  private readonly measure: Measure<T>;
  private readonly mapper?: Mapper<T>;

  private constructor(measure: Measure<T>, mapper?: Mapper<T>, root: Node<T> | null = null, rng?: SipHashRng) {
    this.measure = measure;
    this.mapper = mapper;
    this.root = root;
    this.rng = rng ? rng.clone() : new SipHashRng();
  }

  static fromString(text: string): Rope<string> {
    const r = new Rope<string>((s) => s.length, (s) => s);
    if (text.length > 0) {
      r.root = { left: null, right: null, data: text, priority: r.rng.next(), size: text.length };
    } else {
      r.root = null;
    }
    return r;
  }

  static fromArray<U>(values: Iterable<U>, measure: Measure<U>, mapper?: Mapper<U>): Rope<U> {
    const r = new Rope<U>(measure, mapper);
    for (const v of values) {
      r.append(v);
    }
    return r;
  }

  clone(): Rope<T> {
    return new Rope<T>(this.measure, this.mapper, this.root, this.rng);
  }

  append(value: T): void {
    const size = this.measure(value);
    if (!Number.isFinite(size) || size < 0) {
      throw new Error(`Invalid rope node size: ${size}. Size must be a finite non-negative number.`);
    }
    const newNode: Node<T> = { left: null, right: null, data: value, priority: this.rng.next(), size };
    this.root = merge(this.root, newNode, this.measure);
  }

  concat(other: Rope<T>): void {
    if (!other.root) return;
    // merge is persistent; nodes are reused without mutating either rope
    this.root = merge(this.root, other.root, this.measure);
  }

  toString(mapper?: Mapper<T>): string {
    const chunks: string[] = [];
    const toText = mapper || this.mapper || ((value: T) => String(value));
    inorderMapped(this.root, chunks, toText);
    return chunks.join("");
  }

  toArray(): T[] {
    const items: T[] = [];
    inorder(this.root, items);
    return items;
  }

  length(): number {
    return nodeSize(this.root);
  }
}

function merge<T>(a: Node<T> | null, b: Node<T> | null, measure: Measure<T>): Node<T> | null {
  if (!a) return b;
  if (!b) return a;
  if (a.priority > b.priority) {
    const right = merge(a.right, b, measure);
    return rebuild(a, a.left, right, measure);
  } else {
    const left = merge(a, b.left, measure);
    return rebuild(b, left, b.right, measure);
  }
}

function inorder<T>(n: Node<T> | null, out: T[]): void {
  if (!n) return;
  inorder(n.left, out);
  out.push(n.data);
  inorder(n.right, out);
}

function inorderMapped<T>(n: Node<T> | null, out: string[], mapper: Mapper<T>): void {
  if (!n) return;
  inorderMapped(n.left, out, mapper);
  out.push(mapper(n.data));
  inorderMapped(n.right, out, mapper);
}

import { Rope } from "../src/rope";

type RopeNode<T> = {
  left: RopeNode<T> | null;
  right: RopeNode<T> | null;
  priority: number;
};

function collectPriorities<T>(
  node: RopeNode<T> | null,
  out: number[] = [],
): number[] {
  if (!node) return out;
  collectPriorities(node.left, out);
  out.push(node.priority);
  collectPriorities(node.right, out);
  return out;
}

describe("Rope RNG state", () => {
  test("uses shared RNG state across cloned ropes", () => {
    const measure = () => 1;
    const left = Rope.fromArray<number>([], measure);
    const right = left.clone();

    for (let i = 0; i < 8; i++) {
      left.append(i);
      right.append(i + 100);
    }

    const leftRoot = (left as unknown as { root: RopeNode<number> | null })
      .root;
    const rightRoot = (right as unknown as { root: RopeNode<number> | null })
      .root;

    const leftPriorities = collectPriorities(leftRoot);
    const rightPriorities = collectPriorities(rightRoot);

    expect(leftPriorities).toHaveLength(8);
    expect(rightPriorities).toHaveLength(8);
    expect(leftPriorities).not.toEqual(rightPriorities);
  });
});

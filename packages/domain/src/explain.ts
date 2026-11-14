/**
 * Дерево объяснения (инвариант 10): любая цифра дня раскладывается до
 * интервалов, классов, коэффициентов, капов и версий политики.
 */
export interface ExplanationNode {
  op: string;
  label: string;
  value: string | null;
  children: readonly ExplanationNode[];
}

export function explain(
  op: string,
  label: string,
  value: string | null = null,
  children: readonly ExplanationNode[] = [],
): ExplanationNode {
  return { op, label, value, children };
}

/** Плоский список узлов дерева (для поиска и отображения в UI). */
export function flattenExplanation(
  node: ExplanationNode,
  depth = 0,
): { depth: number; node: ExplanationNode }[] {
  const result: { depth: number; node: ExplanationNode }[] = [{ depth, node }];
  for (const child of node.children) {
    result.push(...flattenExplanation(child, depth + 1));
  }
  return result;
}

export function findExplanation(node: ExplanationNode, op: string): ExplanationNode | null {
  if (node.op === op) return node;
  for (const child of node.children) {
    const found = findExplanation(child, op);
    if (found) return found;
  }
  return null;
}

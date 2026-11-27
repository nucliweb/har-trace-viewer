// A message for an option that no command knows, in place of the raw one of node:util.

/** The number of single-character edits that turn `a` into `b`. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row.push(Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + cost));
    }
    previous = row;
  }
  return previous[b.length]!;
}

/** The known option nearest to `name` when it is a typo of it: a few edits, or its beginning. */
function closestOption(name: string, known: readonly string[]): string | undefined {
  const limit = name.length > 4 ? 2 : 1;
  let best: { option: string; distance: number } | undefined;
  for (const option of known) {
    const distance = option.startsWith(name) && name.length >= 3 ? 0 : editDistance(name, option);
    if (distance <= limit && (!best || distance < best.distance)) best = { option, distance };
  }
  return best?.option;
}

/**
 * Runs `parse`, the strict parser of one command, and words its unknown-option error: the closest
 * of `known` (long option names without the dashes) when there is one, and the help to read.
 */
export function withOptionHints<T>(
  parse: () => T,
  known: readonly string[],
  helpCommand: string
): T {
  try {
    return parse();
  } catch (error) {
    const match = /^Unknown option '(-[^']*)'/.exec((error as Error).message);
    if (!match) throw error;
    const option = match[1]!;
    const close = option.startsWith("--") ? closestOption(option.slice(2), known) : undefined;
    const hint = close ? ` Did you mean '--${close}'?` : "";
    throw new Error(`Unknown option '${option}'.${hint} See ${helpCommand} --help.`, {
      cause: error,
    });
  }
}

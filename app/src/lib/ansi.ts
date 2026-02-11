// Parse ANSI escape codes to styled segments

export interface AnsiSegment {
  text: string;
  className?: string;
}

const ANSI_CODE_MAP: Record<string, string> = {
  "31": "ansi-red",
  "32": "ansi-green",
  "33": "ansi-yellow",
  "34": "ansi-blue",
  "36": "ansi-cyan",
  "1": "ansi-bold",
};

/**
 * Parse ANSI escape codes to an array of text segments with optional CSS class names.
 * Handles common codes: 31=red, 32=green, 33=yellow, 34=blue, 36=cyan, 0=reset, 1=bold.
 */
export function parseAnsi(text: string): AnsiSegment[] {
  // eslint-disable-next-line no-control-regex
  const ansiRegex = /\x1b\[([0-9;]*)m/g;
  const segments: AnsiSegment[] = [];
  let lastIndex = 0;
  let activeClasses: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = ansiRegex.exec(text)) !== null) {
    // Push text before this escape sequence
    if (match.index > lastIndex) {
      const chunk = text.slice(lastIndex, match.index);
      if (chunk) {
        segments.push({
          text: chunk,
          className: activeClasses.length > 0 ? activeClasses.join(" ") : undefined,
        });
      }
    }

    // Parse the codes
    const codes = match[1].split(";").filter(Boolean);
    for (const code of codes) {
      if (code === "0" || code === "") {
        // Reset
        activeClasses = [];
      } else if (ANSI_CODE_MAP[code]) {
        activeClasses.push(ANSI_CODE_MAP[code]);
      }
    }

    // If the match was just \x1b[m (no codes), treat as reset
    if (codes.length === 0) {
      activeClasses = [];
    }

    lastIndex = match.index + match[0].length;
  }

  // Push remaining text
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex);
    if (remaining) {
      segments.push({
        text: remaining,
        className: activeClasses.length > 0 ? activeClasses.join(" ") : undefined,
      });
    }
  }

  // If no ANSI codes were found, return the full text as a single segment
  if (segments.length === 0 && text.length > 0) {
    segments.push({ text });
  }

  return segments;
}

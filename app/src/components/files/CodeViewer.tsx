import React, { useMemo } from "react";
import "./CodeViewer.css";

interface CodeViewerProps {
  filePath: string;
  content: string;
}

function getLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    json: "json", md: "markdown", css: "css", html: "html",
    rs: "rust", toml: "toml", py: "python", go: "go",
    sh: "bash", yml: "yaml", yaml: "yaml", sql: "sql",
  };
  return map[ext] ?? "plaintext";
}

function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath;
}

const KEYWORDS = new Set([
  "const", "let", "var", "function", "class", "return", "import", "export",
  "if", "else", "for", "while", "do", "switch", "case", "break", "continue",
  "new", "this", "super", "extends", "implements", "interface", "type",
  "enum", "async", "await", "yield", "try", "catch", "finally", "throw",
  "typeof", "instanceof", "in", "of", "from", "as", "default", "void",
  "null", "undefined", "true", "false", "static", "readonly", "abstract",
  "public", "private", "protected", "fn", "pub", "mod", "use", "struct",
  "impl", "trait", "match", "loop", "mut", "ref", "self", "def", "elif",
  "pass", "with", "lambda", "None", "True", "False", "print",
]);

/**
 * Basic keyword-based syntax highlighting.
 * Returns an array of React nodes with CSS class names for syntax tokens.
 */
function highlightLine(line: string, _language: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < line.length) {
    // Single-line comment
    if (line[i] === "/" && line[i + 1] === "/") {
      nodes.push(
        <span key={key++} className="syntax-comment">{line.slice(i)}</span>,
      );
      return nodes;
    }

    // Block comment start (just highlight the rest of the line)
    if (line[i] === "/" && line[i + 1] === "*") {
      nodes.push(
        <span key={key++} className="syntax-comment">{line.slice(i)}</span>,
      );
      return nodes;
    }

    // Hash comment (Python, Bash, YAML, TOML)
    if (line[i] === "#" && (_language === "python" || _language === "bash" || _language === "yaml" || _language === "toml")) {
      nodes.push(
        <span key={key++} className="syntax-comment">{line.slice(i)}</span>,
      );
      return nodes;
    }

    // Strings (single quote, double quote, backtick)
    if (line[i] === '"' || line[i] === "'" || line[i] === "`") {
      const quote = line[i];
      let j = i + 1;
      while (j < line.length && line[j] !== quote) {
        if (line[j] === "\\") j++; // skip escaped chars
        j++;
      }
      if (j < line.length) j++; // include closing quote
      nodes.push(
        <span key={key++} className="syntax-string">{line.slice(i, j)}</span>,
      );
      i = j;
      continue;
    }

    // Numbers
    if (/[0-9]/.test(line[i]) && (i === 0 || /[\s([\]{},;:=+\-*/<>!&|^~]/.test(line[i - 1]))) {
      let j = i;
      // Match integer, float, hex, binary, octal
      if (line[j] === "0" && (line[j + 1] === "x" || line[j + 1] === "X")) {
        j += 2;
        while (j < line.length && /[0-9a-fA-F_]/.test(line[j])) j++;
      } else if (line[j] === "0" && (line[j + 1] === "b" || line[j + 1] === "B")) {
        j += 2;
        while (j < line.length && /[01_]/.test(line[j])) j++;
      } else {
        while (j < line.length && /[0-9_.]/.test(line[j])) j++;
        if (j < line.length && (line[j] === "e" || line[j] === "E")) {
          j++;
          if (j < line.length && (line[j] === "+" || line[j] === "-")) j++;
          while (j < line.length && /[0-9]/.test(line[j])) j++;
        }
      }
      nodes.push(
        <span key={key++} className="syntax-number">{line.slice(i, j)}</span>,
      );
      i = j;
      continue;
    }

    // Words (keywords or identifiers)
    if (/[a-zA-Z_$]/.test(line[i])) {
      let j = i;
      while (j < line.length && /[a-zA-Z0-9_$]/.test(line[j])) j++;
      const word = line.slice(i, j);
      if (KEYWORDS.has(word)) {
        nodes.push(
          <span key={key++} className="syntax-keyword">{word}</span>,
        );
      } else {
        nodes.push(word);
      }
      i = j;
      continue;
    }

    // Punctuation and other characters -- collect consecutive non-special chars
    let j = i;
    while (
      j < line.length &&
      !/[a-zA-Z0-9_$"'`#]/.test(line[j]) &&
      !(line[j] === "/" && (line[j + 1] === "/" || line[j + 1] === "*"))
    ) {
      j++;
    }
    if (j > i) {
      nodes.push(
        <span key={key++} className="syntax-punctuation">{line.slice(i, j)}</span>,
      );
      i = j;
    } else {
      // Fallback: just push the character
      nodes.push(line[i]);
      i++;
    }
  }

  return nodes;
}

export function CodeViewer({ filePath, content }: CodeViewerProps) {
  const lines = useMemo(() => content.split("\n"), [content]);
  const language = getLanguage(filePath);
  const fileName = getFileName(filePath);
  const gutterWidth = String(lines.length).length;

  return (
    <div className="code-viewer">
      <div className="code-viewer-header">
        <div className="code-viewer-tab">
          <span className="code-viewer-filename">{fileName}</span>
          <span className="code-viewer-lang">{language}</span>
        </div>
        <div className="code-viewer-info">
          <span>{lines.length} lines</span>
        </div>
      </div>
      <div className="code-viewer-content">
        <pre className="code-viewer-pre">
          <code>
            {lines.map((line, i) => (
              <div key={i} className="code-line">
                <span
                  className="code-line-number"
                  style={{ minWidth: `${gutterWidth + 1}ch` }}
                >
                  {i + 1}
                </span>
                <span className="code-line-content">
                  {line ? highlightLine(line, language) : " "}
                </span>
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

import { useMemo } from "react";
import "./DiffViewer.css";

interface DiffViewerProps {
  filePath: string;
  diff: string;
}

interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  content: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

function parseDiff(diff: string): DiffLine[] {
  const lines = diff.split("\n");
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      result.push({ type: "header", content: line, oldLineNo: null, newLineNo: null });
    } else if (line.startsWith("+++") || line.startsWith("---")) {
      result.push({ type: "header", content: line, oldLineNo: null, newLineNo: null });
    } else if (line.startsWith("diff ") || line.startsWith("index ")) {
      result.push({ type: "header", content: line, oldLineNo: null, newLineNo: null });
    } else if (line.startsWith("+")) {
      result.push({ type: "add", content: line.slice(1), oldLineNo: null, newLineNo: newLine });
      newLine++;
    } else if (line.startsWith("-")) {
      result.push({ type: "remove", content: line.slice(1), oldLineNo: oldLine, newLineNo: null });
      oldLine++;
    } else if (line.startsWith(" ")) {
      result.push({ type: "context", content: line.slice(1), oldLineNo: oldLine, newLineNo: newLine });
      oldLine++;
      newLine++;
    } else if (line === "\\ No newline at end of file") {
      result.push({ type: "header", content: line, oldLineNo: null, newLineNo: null });
    }
  }

  return result;
}

function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath;
}

export function DiffViewer({ filePath, diff }: DiffViewerProps) {
  const parsedLines = useMemo(() => parseDiff(diff), [diff]);
  const fileName = getFileName(filePath);

  const addCount = parsedLines.filter((l) => l.type === "add").length;
  const removeCount = parsedLines.filter((l) => l.type === "remove").length;

  if (!diff.trim()) {
    return (
      <div className="diff-viewer">
        <div className="diff-viewer-header">
          <div className="diff-viewer-tab">
            <span className="diff-viewer-filename">{fileName}</span>
            <span className="diff-viewer-badge">diff</span>
          </div>
        </div>
        <div className="diff-empty">No differences</div>
      </div>
    );
  }

  return (
    <div className="diff-viewer">
      <div className="diff-viewer-header">
        <div className="diff-viewer-tab">
          <span className="diff-viewer-filename">{fileName}</span>
          <span className="diff-viewer-badge">diff</span>
        </div>
        <div className="diff-viewer-stats">
          {addCount > 0 && <span className="diff-stat diff-stat--add">+{addCount}</span>}
          {removeCount > 0 && <span className="diff-stat diff-stat--remove">-{removeCount}</span>}
        </div>
      </div>
      <div className="diff-viewer-content">
        <pre className="diff-viewer-pre">
          <code>
            {parsedLines.map((line, i) => (
              <div
                key={i}
                className={`diff-line diff-line--${line.type}`}
              >
                <span className="diff-line-number diff-line-number--old">
                  {line.oldLineNo ?? ""}
                </span>
                <span className="diff-line-number diff-line-number--new">
                  {line.newLineNo ?? ""}
                </span>
                <span className="diff-line-prefix">
                  {line.type === "add" ? "+" : line.type === "remove" ? "-" : line.type === "context" ? " " : ""}
                </span>
                <span className="diff-line-content">
                  {line.content || " "}
                </span>
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

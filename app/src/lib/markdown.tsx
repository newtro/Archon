import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownProps {
  content: string;
}

const remarkPlugins = [remarkGfm];

export function Markdown({ content }: MarkdownProps) {
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins}>
      {content}
    </ReactMarkdown>
  );
}

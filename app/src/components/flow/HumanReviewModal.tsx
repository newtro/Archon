import { useState } from "react";
import { UserCheck, ThumbsUp, ThumbsDown, MessageSquare, Pencil, Eye } from "lucide-react";
import { Markdown } from "../../lib/markdown";
import "./HumanReviewModal.css";

export interface HumanReviewRequest {
  nodeId: string;
  nodeLabel: string;
  executionId: string;
  prompt: string;
  context?: string;
  contentType?: "text" | "json" | "markdown";
}

interface HumanReviewModalProps {
  review: HumanReviewRequest;
  onApprove: (feedback?: string, editedContent?: string) => void;
  onReject: (feedback: string) => void;
}

export function HumanReviewModal({ review, onApprove, onReject }: HumanReviewModalProps) {
  const [feedback, setFeedback] = useState("");
  const [mode, setMode] = useState<"review" | "reject">("review");
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(review.context ?? "");

  const hasEdits = editedContent !== (review.context ?? "");

  const handleApprove = () => {
    onApprove(
      feedback || undefined,
      hasEdits ? editedContent : undefined,
    );
  };

  // Format JSON content for display
  const displayContent = (() => {
    const raw = hasEdits ? editedContent : (review.context ?? "");
    if (review.contentType === "json" && !isEditing) {
      try {
        return JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        return raw;
      }
    }
    return raw;
  })();

  return (
    <div className="review-modal-overlay">
      <div className="review-modal">
        <div className="review-modal-header">
          <UserCheck size={20} />
          <h3 className="review-modal-title">Human Review Required</h3>
        </div>

        <div className="review-modal-body">
          <div className="review-modal-node">
            <span className="review-modal-label">Node:</span>
            <span className="review-modal-value">{review.nodeLabel}</span>
          </div>

          <div className="review-modal-prompt">
            <p>{review.prompt}</p>
          </div>

          {review.context && (
            <div className="review-modal-content">
              <div className="review-modal-content-header">
                <span className="review-modal-label">
                  Content for Review
                  {review.contentType && (
                    <span className="review-modal-content-type">
                      {review.contentType.toUpperCase()}
                    </span>
                  )}
                </span>
                <button
                  className="review-btn-edit"
                  onClick={() => setIsEditing(!isEditing)}
                >
                  {isEditing ? <Eye size={12} /> : <Pencil size={12} />}
                  {isEditing ? "Preview" : "Edit"}
                </button>
              </div>
              {isEditing ? (
                <textarea
                  className="review-modal-content-editor"
                  value={editedContent}
                  onChange={(e) => setEditedContent(e.target.value)}
                  rows={12}
                  spellCheck={false}
                />
              ) : review.contentType === "markdown" ? (
                <div className="review-modal-content-markdown">
                  <Markdown content={displayContent} />
                </div>
              ) : (
                <pre className="review-modal-content-display">{displayContent}</pre>
              )}
              {hasEdits && (
                <span className="review-modal-edited-badge">Modified</span>
              )}
            </div>
          )}

          {mode === "reject" ? (
            <div className="review-modal-feedback">
              <label className="review-modal-label">
                <MessageSquare size={14} />
                Reason for rejection:
              </label>
              <textarea
                className="review-modal-textarea"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Explain why this should be rejected..."
                rows={3}
              />
            </div>
          ) : (
            <div className="review-modal-feedback">
              <label className="review-modal-label">
                <MessageSquare size={14} />
                Optional feedback:
              </label>
              <textarea
                className="review-modal-textarea"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Add any notes or instructions..."
                rows={2}
              />
            </div>
          )}
        </div>

        <div className="review-modal-actions">
          {mode === "reject" ? (
            <>
              <button className="review-btn-cancel" onClick={() => setMode("review")}>
                Back
              </button>
              <button
                className="review-btn-reject"
                onClick={() => onReject(feedback)}
                disabled={!feedback.trim()}
              >
                <ThumbsDown size={14} />
                Confirm Rejection
              </button>
            </>
          ) : (
            <>
              <button className="review-btn-reject-start" onClick={() => setMode("reject")}>
                <ThumbsDown size={14} />
                Reject
              </button>
              <button className="review-btn-approve" onClick={handleApprove}>
                <ThumbsUp size={14} />
                {hasEdits ? "Approve with Edits" : "Approve"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

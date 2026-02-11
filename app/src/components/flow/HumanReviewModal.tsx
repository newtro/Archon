import { useState } from "react";
import { UserCheck, ThumbsUp, ThumbsDown, MessageSquare } from "lucide-react";
import "./HumanReviewModal.css";

export interface HumanReviewRequest {
  nodeId: string;
  nodeLabel: string;
  executionId: string;
  prompt: string;
  context?: string;
}

interface HumanReviewModalProps {
  review: HumanReviewRequest;
  onApprove: (feedback?: string) => void;
  onReject: (feedback: string) => void;
}

export function HumanReviewModal({ review, onApprove, onReject }: HumanReviewModalProps) {
  const [feedback, setFeedback] = useState("");
  const [mode, setMode] = useState<"review" | "reject">("review");

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
            <div className="review-modal-context">
              <span className="review-modal-label">Context:</span>
              <pre className="review-modal-context-text">{review.context}</pre>
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
              <button className="review-btn-approve" onClick={() => onApprove(feedback || undefined)}>
                <ThumbsUp size={14} />
                Approve
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

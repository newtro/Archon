interface AdoPrWriteConfigProps {
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}

const VOTE_OPTIONS = [
  { value: "approve", label: "Approve" },
  { value: "approve-with-suggestions", label: "Approve with Suggestions" },
  { value: "wait-for-author", label: "Wait for Author" },
  { value: "reject", label: "Reject" },
  { value: "from-input", label: "From Input (LLM decides)" },
] as const;

const THREAD_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending" },
  { value: "fixed", label: "Fixed" },
  { value: "closed", label: "Closed" },
] as const;

export function AdoPrWriteConfig({ config, onChange }: AdoPrWriteConfigProps) {
  return (
    <>
      <div className="config-field">
        <label className="config-label">Project Name</label>
        <input
          className="config-input"
          value={(config.projectName as string) ?? ""}
          onChange={(e) => onChange({ projectName: e.target.value })}
          placeholder="e.g. MyProject"
        />
      </div>
      <div className="config-field">
        <label className="config-label">Repository Name (optional)</label>
        <input
          className="config-input"
          value={(config.repositoryName as string) ?? ""}
          onChange={(e) => onChange({ repositoryName: e.target.value })}
          placeholder={(config.projectName as string) || "defaults to project name"}
        />
        <p className="config-hint">Defaults to the project name if left blank.</p>
      </div>

      <div className="config-field" style={{ marginTop: 12 }}>
        <label className="config-label">Actions</label>
        <label className="config-checkbox-label">
          <input
            type="checkbox"
            checked={(config.postSummaryComment as boolean) ?? true}
            onChange={(e) => onChange({ postSummaryComment: e.target.checked })}
          />
          Post overall review summary comment
        </label>
        <label className="config-checkbox-label">
          <input
            type="checkbox"
            checked={(config.postInlineComments as boolean) ?? true}
            onChange={(e) => onChange({ postInlineComments: e.target.checked })}
          />
          Post inline comments on specific lines
        </label>
        <label className="config-checkbox-label">
          <input
            type="checkbox"
            checked={(config.setVote as boolean) ?? true}
            onChange={(e) => onChange({ setVote: e.target.checked })}
          />
          Set vote status on PR
        </label>
      </div>

      {(config.setVote as boolean) !== false && (
        <div className="config-field">
          <label className="config-label">Default Vote</label>
          <select
            className="config-input"
            value={(config.defaultVote as string) ?? "approve-with-suggestions"}
            onChange={(e) => onChange({ defaultVote: e.target.value })}
          >
            {VOTE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <p className="config-hint">
            "From Input" uses the vote value from the upstream LLM node's structured output.
          </p>
        </div>
      )}

      <div className="config-field">
        <label className="config-label">Thread Status</label>
        <select
          className="config-input"
          value={(config.threadStatus as string) ?? "active"}
          onChange={(e) => onChange({ threadStatus: e.target.value })}
        >
          {THREAD_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <p className="config-hint">Status assigned to new comment threads.</p>
      </div>

      <div className="config-field" style={{ marginTop: 12 }}>
        <label className="config-label">Safety</label>
        <label className="config-checkbox-label">
          <input
            type="checkbox"
            checked={(config.requireHumanApproval as boolean) ?? true}
            onChange={(e) => onChange({ requireHumanApproval: e.target.checked })}
          />
          Require human approval before posting
        </label>
        <p className="config-hint">
          When enabled, the node pauses and shows the proposed comments for review before posting to Azure DevOps.
        </p>
      </div>
    </>
  );
}

interface AdoPrReadConfigProps {
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}

export function AdoPrReadConfig({ config, onChange }: AdoPrReadConfigProps) {
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
        <p className="config-hint">Azure DevOps project name. Org URL and PAT are set in global Settings.</p>
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
      <div className="config-field">
        <label className="config-checkbox-label">
          <input
            type="checkbox"
            checked={(config.trackIterations as boolean) ?? false}
            onChange={(e) => onChange({ trackIterations: e.target.checked })}
          />
          Track iterations for incremental reviews
        </label>
        <p className="config-hint">
          When enabled, subsequent runs only fetch changes since the last reviewed iteration.
        </p>
      </div>
      {config.lastReviewedIteration != null && (
        <div className="config-field">
          <label className="config-label">Last Reviewed Iteration</label>
          <span className="config-value-display">{String(config.lastReviewedIteration)}</span>
          <p className="config-hint">Managed automatically during execution.</p>
        </div>
      )}
      <div className="config-field">
        <p className="config-hint" style={{ marginTop: 8, opacity: 0.7 }}>
          The PR number is provided dynamically from the upstream node's output (e.g., from a chat message).
        </p>
      </div>
    </>
  );
}

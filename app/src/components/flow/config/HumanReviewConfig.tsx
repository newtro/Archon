interface HumanReviewConfigProps {
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}

export function HumanReviewConfig({ config, onChange }: HumanReviewConfigProps) {
  const timeout = Number(config.timeout ?? 0);

  return (
    <>
      <div className="config-field">
        <label className="config-label">Review Prompt</label>
        <textarea
          className="config-textarea"
          rows={3}
          value={(config.prompt as string) ?? ""}
          onChange={(e) => onChange({ prompt: e.target.value })}
          placeholder="Please review and approve this result before continuing..."
        />
        <span className="config-hint">Shown to the reviewer when the flow pauses</span>
      </div>
      <div className="config-field">
        <label className="config-label">
          Timeout ({timeout === 0 ? "No timeout" : `${timeout}s`})
        </label>
        <input
          type="number"
          className="config-input"
          min="0"
          max="86400"
          step="30"
          value={timeout}
          onChange={(e) => onChange({ timeout: parseInt(e.target.value) || 0 })}
        />
        <span className="config-hint">Seconds to wait. 0 = wait indefinitely</span>
      </div>
    </>
  );
}

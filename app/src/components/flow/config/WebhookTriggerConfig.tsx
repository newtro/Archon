interface WebhookTriggerConfigProps {
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}

export function WebhookTriggerConfig({ config, onChange }: WebhookTriggerConfigProps) {
  const pathHint = (config.pathHint as string) ?? "";
  const parseBody = (config.parseBody as boolean) ?? true;

  return (
    <>
      <div className="config-field">
        <label className="config-label">Path Hint</label>
        <input
          type="text"
          className="config-input"
          value={pathHint}
          onChange={(e) => onChange({ pathHint: e.target.value })}
          placeholder="e.g. deploy, github-push"
        />
        <span className="config-hint">
          Optional label shown in the webhook URL for readability
        </span>
      </div>

      <div className="config-field">
        <label className="config-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={parseBody}
            onChange={(e) => onChange({ parseBody: e.target.checked })}
          />
          Parse request body as JSON
        </label>
        <span className="config-hint">
          When enabled, the incoming POST body is parsed as JSON and passed as structured data.
          When disabled, the raw body string is passed through.
        </span>
      </div>

      <div className="config-field">
        <span className="config-hint" style={{ fontStyle: "italic" }}>
          This node receives incoming webhook POST requests. Create a webhook endpoint in the
          Gateway tab to connect this flow to a URL. The request body becomes the input for
          downstream nodes.
        </span>
      </div>
    </>
  );
}

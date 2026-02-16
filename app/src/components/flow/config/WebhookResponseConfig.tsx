interface WebhookResponseConfigProps {
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}

const STATUS_PRESETS = [
  { code: 200, label: "200 OK" },
  { code: 201, label: "201 Created" },
  { code: 202, label: "202 Accepted" },
  { code: 400, label: "400 Bad Request" },
  { code: 404, label: "404 Not Found" },
  { code: 500, label: "500 Server Error" },
];

export function WebhookResponseConfig({ config, onChange }: WebhookResponseConfigProps) {
  const statusCode = (config.statusCode as number) ?? 200;
  const contentType = (config.contentType as string) ?? "application/json";
  const responseTemplate = (config.responseTemplate as string) ?? '{"status":"success"}';

  return (
    <>
      <div className="config-field">
        <label className="config-label">HTTP Status Code</label>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="number"
            className="config-input"
            style={{ width: 80 }}
            value={statusCode}
            onChange={(e) => onChange({ statusCode: parseInt(e.target.value, 10) || 200 })}
            min={100}
            max={599}
          />
          <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
            {STATUS_PRESETS.map((p) => (
              <button
                key={p.code}
                className={`config-chip ${statusCode === p.code ? "active" : ""}`}
                onClick={() => onChange({ statusCode: p.code })}
              >
                {p.code}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="config-field">
        <label className="config-label">Content-Type</label>
        <select
          className="config-select"
          value={contentType}
          onChange={(e) => onChange({ contentType: e.target.value })}
        >
          <option value="application/json">application/json</option>
          <option value="text/plain">text/plain</option>
          <option value="text/html">text/html</option>
          <option value="application/xml">application/xml</option>
        </select>
      </div>

      <div className="config-field">
        <label className="config-label">Response Body Template</label>
        <textarea
          className="config-textarea"
          rows={6}
          value={responseTemplate}
          onChange={(e) => onChange({ responseTemplate: e.target.value })}
          placeholder='{"status":"success","result":"{{input}}"}'
        />
        <span className="config-hint">
          Use {"{{input}}"} to include upstream node output in the response
        </span>
      </div>
    </>
  );
}

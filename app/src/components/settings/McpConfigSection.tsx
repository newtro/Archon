import { useState, useEffect } from "react";
import { Server, Plus, Trash2, RefreshCw } from "lucide-react";
import { getSetting, setSetting } from "../../lib/store";
import "./McpConfigSection.css";

export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
}

export function McpConfigSection() {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCommand, setNewCommand] = useState("");
  const [newArgs, setNewArgs] = useState("");

  useEffect(() => {
    getSetting<McpServerConfig[]>("mcpServers", []).then(setServers);
  }, []);

  const save = async (updated: McpServerConfig[]) => {
    setServers(updated);
    await setSetting("mcpServers", updated);
  };

  const handleAdd = async () => {
    if (!newName || !newCommand) return;
    const server: McpServerConfig = {
      id: crypto.randomUUID(),
      name: newName,
      command: newCommand,
      args: newArgs.split(" ").filter(Boolean),
      env: {},
      enabled: true,
    };
    await save([...servers, server]);
    setNewName("");
    setNewCommand("");
    setNewArgs("");
    setIsAdding(false);
  };

  const handleToggle = async (id: string) => {
    await save(servers.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));
  };

  const handleDelete = async (id: string) => {
    await save(servers.filter((s) => s.id !== id));
  };

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">
        <Server size={16} />
        MCP Servers
      </h3>
      <p className="settings-description">
        Configure Model Context Protocol servers for additional tool capabilities.
      </p>

      <div className="mcp-server-list">
        {servers.length === 0 && !isAdding && (
          <div className="mcp-empty">No MCP servers configured</div>
        )}
        {servers.map((server) => (
          <div key={server.id} className={`mcp-server-item ${server.enabled ? "" : "disabled"}`}>
            <div className="mcp-server-info">
              <span className="mcp-server-name">{server.name}</span>
              <span className="mcp-server-cmd">{server.command} {server.args.join(" ")}</span>
            </div>
            <div className="mcp-server-actions">
              <button
                className="mcp-server-toggle"
                onClick={() => handleToggle(server.id)}
                title={server.enabled ? "Disable" : "Enable"}
              >
                <RefreshCw size={12} />
              </button>
              <button
                className="mcp-server-delete"
                onClick={() => handleDelete(server.id)}
                title="Remove server"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}

        {isAdding ? (
          <div className="mcp-add-form">
            <input
              className="mcp-input"
              placeholder="Server name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <input
              className="mcp-input"
              placeholder="Command (e.g., npx @modelcontextprotocol/server-fs)"
              value={newCommand}
              onChange={(e) => setNewCommand(e.target.value)}
            />
            <input
              className="mcp-input"
              placeholder="Arguments (space separated)"
              value={newArgs}
              onChange={(e) => setNewArgs(e.target.value)}
            />
            <div className="mcp-add-actions">
              <button className="settings-btn-primary" onClick={handleAdd}>Add Server</button>
              <button className="mcp-cancel-btn" onClick={() => setIsAdding(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="mcp-add-btn" onClick={() => setIsAdding(true)}>
            <Plus size={14} />
            Add MCP Server
          </button>
        )}
      </div>
    </section>
  );
}

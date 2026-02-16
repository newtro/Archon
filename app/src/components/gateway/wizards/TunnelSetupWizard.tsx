import { useState, useEffect, useRef, useCallback } from "react";
import { Globe, Cloud, Webhook, Terminal, Copy } from "lucide-react";
import { getSetting, setSetting } from "../../../lib/store";
import {
  WizardModal, WizardInfoBox, WizardProviderCard,
  WizardTokenInput, WizardStatusFeedback,
  type FeedbackStatus,
} from "./WizardModal";

interface TunnelStatus {
  provider: string;
  state: "stopped" | "starting" | "connected" | "reconnecting" | "error";
  publicUrl: string | null;
  error: string | null;
  uptimeMs: number;
}

interface TunnelSetupWizardProps {
  onClose: () => void;
  gatewaySend: (action: unknown) => void;
  tunnelStatus: TunnelStatus | undefined;
  isConnected: boolean;
}

const TOTAL_STEPS = 4;
const TIMEOUT_MS = 30_000;

export function TunnelSetupWizard({ onClose, gatewaySend, tunnelStatus, isConnected }: TunnelSetupWizardProps) {
  const [step, setStep] = useState(1);
  const [provider, setProvider] = useState<"cloudflare" | "ngrok" | "custom">("cloudflare");

  // Provider-specific config
  const [ngrokToken, setNgrokToken] = useState("");
  const [ngrokDomain, setNgrokDomain] = useState("");
  const [cfToken, setCfToken] = useState("");
  const [customCommand, setCustomCommand] = useState("");
  const [customUrlPattern, setCustomUrlPattern] = useState("");

  // Feedback
  const [feedbackStatus, setFeedbackStatus] = useState<FeedbackStatus>("connecting");
  const [progressMsg, setProgressMsg] = useState("Starting tunnel...");
  const [errorMsg, setErrorMsg] = useState("");
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const feedbackRef = useRef(feedbackStatus);
  feedbackRef.current = feedbackStatus;

  // Load saved tokens on mount
  useEffect(() => {
    getSetting<string>("ngrokAuthToken", "").then(setNgrokToken);
    getSetting<string>("ngrokDomain", "").then(setNgrokDomain);
    getSetting<string>("cfTunnelToken", "").then(setCfToken);
    getSetting<string>("tunnelProvider", "cloudflare").then((p) => {
      if (p === "ngrok" || p === "cloudflare" || p === "custom") setProvider(p);
    });
  }, []);

  // Watch tunnel status for verify step
  useEffect(() => {
    if (step !== 4) return;

    if (tunnelStatus?.state === "connected") {
      setFeedbackStatus("success");
      // Persist settings
      setSetting("tunnelProvider", provider);
      if (provider === "ngrok" && ngrokToken) setSetting("ngrokAuthToken", ngrokToken);
      if (provider === "cloudflare" && cfToken) setSetting("cfTunnelToken", cfToken);
      if (ngrokDomain) setSetting("ngrokDomain", ngrokDomain);
    } else if (tunnelStatus?.state === "starting" || tunnelStatus?.state === "reconnecting") {
      setProgressMsg(tunnelStatus.state === "starting" ? "Starting tunnel..." : "Reconnecting...");
    } else if (tunnelStatus?.state === "error") {
      setFeedbackStatus("error");
      setErrorMsg(tunnelStatus.error || "Failed to start tunnel");
    }
  }, [tunnelStatus?.state, tunnelStatus?.error, step, provider, ngrokToken, cfToken, ngrokDomain]);

  // Cleanup timeout
  useEffect(() => {
    if (feedbackStatus !== "connecting" && timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  }, [feedbackStatus]);

  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);

  const handleStartTunnel = useCallback(() => {
    setStep(4);
    setFeedbackStatus("connecting");
    setProgressMsg("Starting tunnel...");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: any = { provider, autoStart: false };
    if (provider === "ngrok") {
      config.ngrok = { authToken: ngrokToken, domain: ngrokDomain || undefined };
    } else if (provider === "cloudflare") {
      config.cloudflare = cfToken ? { token: cfToken } : {};
    } else if (provider === "custom") {
      config.custom = { startCommand: customCommand, urlPattern: customUrlPattern || undefined };
    }

    gatewaySend({ type: "tunnel_start", config });

    timeoutRef.current = setTimeout(() => {
      if (feedbackRef.current === "connecting") {
        setFeedbackStatus("error");
        setErrorMsg("Connection timed out after 30 seconds. Check your configuration and try again.");
      }
    }, TIMEOUT_MS);
  }, [provider, ngrokToken, ngrokDomain, cfToken, customCommand, customUrlPattern, gatewaySend]);

  // Step navigation logic
  const canProceed = () => {
    if (step === 2) return true; // provider always selected
    if (step === 3) {
      if (provider === "ngrok") return ngrokToken.trim().length > 0;
      if (provider === "custom") return customCommand.trim().length > 0;
      return true; // cloudflare needs nothing
    }
    return true;
  };

  const handleNext = () => {
    if (step === 1) setStep(2);
    else if (step === 2) setStep(3);
    else if (step === 3) handleStartTunnel();
    else if (step === 4 && feedbackStatus === "success") onClose();
  };

  const getNextLabel = () => {
    if (step === 1) return "Let's set it up";
    if (step === 3) return "Start Tunnel";
    if (step === 4 && feedbackStatus === "success") return "Done";
    return "Next";
  };

  return (
    <WizardModal
      title="Set Up Tunnel"
      totalSteps={TOTAL_STEPS}
      currentStep={step}
      onClose={onClose}
      onBack={() => setStep((s) => Math.max(1, s - 1))}
      onNext={handleNext}
      nextLabel={getNextLabel()}
      nextDisabled={!canProceed() || !isConnected || (step === 4 && feedbackStatus === "connecting")}
      showBack={step > 1 && step < 4}
      showNext={step < 4 || feedbackStatus === "success"}
      icon={<Globe size={18} />}
    >
      {step === 1 && (
        <WizardInfoBox
          icon={<Globe size={40} />}
          title="What is a tunnel?"
          description="A tunnel gives your computer a public web address so services like Telegram can send messages to it. Think of it like giving your computer a phone number that anyone on the internet can call."
          extra={
            <p className="wizard-hint" style={{ marginTop: 8 }}>
              <strong>Why do I need this?</strong> Telegram requires a public URL to deliver messages to your bot. Without a tunnel, only Discord (which connects outward on its own) will work.
            </p>
          }
        />
      )}

      {step === 2 && (
        <div className="wizard-provider-grid">
          <WizardProviderCard
            icon={<Cloud size={20} />}
            title="Cloudflare"
            description="Free, no account needed. Creates a temporary public URL instantly. Best for getting started."
            badge="Easiest"
            selected={provider === "cloudflare"}
            onClick={() => setProvider("cloudflare")}
          />
          <WizardProviderCard
            icon={<Webhook size={20} />}
            title="ngrok"
            description="Free tier available. Requires a free account at ngrok.com. Gives you a stable, reusable URL."
            badge="More control"
            selected={provider === "ngrok"}
            onClick={() => setProvider("ngrok")}
          />
          <WizardProviderCard
            icon={<Terminal size={20} />}
            title="Custom"
            description="Use your own tunnel tool (bore, localtunnel, etc). For advanced users who have a preferred setup."
            badge="Advanced"
            selected={provider === "custom"}
            onClick={() => setProvider("custom")}
          />
        </div>
      )}

      {step === 3 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {provider === "cloudflare" && (
            <>
              <p className="wizard-hint">
                <strong>No configuration needed!</strong> Cloudflare will create a free temporary URL for you automatically. Just click "Start Tunnel" below.
              </p>
              <WizardTokenInput
                value={cfToken}
                onChange={setCfToken}
                placeholder="Cloudflare tunnel token (optional)"
                label="Advanced: Named Tunnel Token"
                helpText="Leave this empty for a quick tunnel. Only fill in if you have a Cloudflare account and want a persistent named tunnel."
              />
            </>
          )}

          {provider === "ngrok" && (
            <>
              <p className="wizard-hint">
                To get your auth token: sign up for a free account at <strong>dashboard.ngrok.com</strong>, then copy the token from the dashboard.
              </p>
              <WizardTokenInput
                value={ngrokToken}
                onChange={setNgrokToken}
                placeholder="Paste your ngrok auth token"
                label="Auth Token"
                helpText="Find this at dashboard.ngrok.com under 'Your Authtoken'"
              />
              <div className="wizard-field">
                <label className="wizard-label">Custom Domain (optional)</label>
                <input
                  type="text"
                  className="wizard-input"
                  value={ngrokDomain}
                  onChange={(e) => setNgrokDomain(e.target.value)}
                  placeholder="e.g. my-app.ngrok.io"
                />
                <p className="wizard-help">Optional. Only works with paid ngrok plans.</p>
              </div>
            </>
          )}

          {provider === "custom" && (
            <>
              <div className="wizard-field">
                <label className="wizard-label">Tunnel Command</label>
                <input
                  type="text"
                  className="wizard-input"
                  value={customCommand}
                  onChange={(e) => setCustomCommand(e.target.value)}
                  placeholder="bore local {port} --to bore.pub"
                />
                <p className="wizard-help">
                  Use <code>{"{port}"}</code> as a placeholder for the gateway port. The command will be run as a child process.
                </p>
              </div>
              <div className="wizard-field">
                <label className="wizard-label">URL Pattern (optional)</label>
                <input
                  type="text"
                  className="wizard-input"
                  value={customUrlPattern}
                  onChange={(e) => setCustomUrlPattern(e.target.value)}
                  placeholder="https?://[\\w.-]+"
                />
                <p className="wizard-help">A regex to extract the public URL from the command output.</p>
              </div>
            </>
          )}
        </div>
      )}

      {step === 4 && (
        <WizardStatusFeedback
          status={feedbackStatus}
          progressMessage={progressMsg}
          successTitle="Tunnel is running!"
          successDetails={
            tunnelStatus?.publicUrl ? (
              <div className="wizard-success-details">
                <p className="wizard-hint">Your public URL:</p>
                <div className="wizard-success-url">
                  <code>{tunnelStatus.publicUrl}</code>
                  <button
                    className="wizard-copy-btn"
                    onClick={() => navigator.clipboard.writeText(tunnelStatus.publicUrl!)}
                    title="Copy URL"
                  >
                    <Copy size={14} />
                  </button>
                </div>
              </div>
            ) : undefined
          }
          errorMessage={errorMsg}
          errorSuggestions={[
            "Check your internet connection",
            provider === "ngrok" ? "Verify your ngrok auth token is correct" : "Check your tunnel configuration",
            "Try stopping and restarting the gateway",
          ]}
          onRetry={() => setStep(3)}
        />
      )}
    </WizardModal>
  );
}

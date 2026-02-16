import { useState, useEffect, useRef, useCallback } from "react";
import { Bot } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { getSetting, setSetting } from "../../../lib/store";
import {
  WizardModal, WizardInfoBox, WizardTokenInput,
  WizardStatusFeedback, WizardInstruction, WizardLink,
  type FeedbackStatus,
} from "./WizardModal";

interface ChannelStatus {
  type: string;
  state: "stopped" | "connecting" | "connected" | "error";
  botUsername: string | null;
  error: string | null;
}

interface DiscordSetupWizardProps {
  onClose: () => void;
  gatewaySend: (action: unknown) => void;
  channelStatus: ChannelStatus | undefined;
  isConnected: boolean;
}

const TOTAL_STEPS = 5;
const TIMEOUT_MS = 30_000;

export function DiscordSetupWizard({ onClose, gatewaySend, channelStatus, isConnected }: DiscordSetupWizardProps) {
  const [step, setStep] = useState(1);
  const [token, setToken] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");

  const [feedbackStatus, setFeedbackStatus] = useState<FeedbackStatus>("connecting");
  const [progressMsg, setProgressMsg] = useState("Configuring bot...");
  const [errorMsg, setErrorMsg] = useState("");
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const feedbackRef = useRef(feedbackStatus);
  feedbackRef.current = feedbackStatus;

  // Load saved token
  useEffect(() => {
    getSetting<string>("discordBotToken", "").then(setToken);
  }, []);

  // Watch channel status on connecting step
  useEffect(() => {
    if (step !== 4) return;

    if (channelStatus?.state === "connecting") {
      setProgressMsg("Registering slash commands with Discord...");
    } else if (channelStatus?.state === "connected") {
      setFeedbackStatus("success");
      setSetting("discordBotToken", token);
      setStep(5);
    } else if (channelStatus?.state === "error") {
      setFeedbackStatus("error");
      setErrorMsg(channelStatus.error || "Failed to connect to Discord");
      setStep(5);
    }
  }, [channelStatus?.state, channelStatus?.error, step, token]);

  useEffect(() => {
    if (feedbackStatus !== "connecting" && timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  }, [feedbackStatus]);

  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);

  const handleConnect = useCallback(() => {
    setStep(4);
    setFeedbackStatus("connecting");
    setProgressMsg("Configuring bot...");

    gatewaySend({
      type: "channel_configure",
      config: { type: "discord", enabled: true, botToken: token.trim() },
    });

    setTimeout(() => {
      setProgressMsg("Logging in to Discord...");
      gatewaySend({ type: "channel_start", channelType: "discord" });
    }, 100);

    timeoutRef.current = setTimeout(() => {
      if (feedbackRef.current === "connecting") {
        setFeedbackStatus("error");
        setErrorMsg("Connection timed out after 30 seconds. Check your token and try again.");
        setStep(5);
      }
    }, TIMEOUT_MS);
  }, [token, gatewaySend]);

  const handleNext = () => {
    if (step === 1) setStep(2);
    else if (step === 2) setStep(3);
    else if (step === 3) handleConnect();
    else if (step === 5 && feedbackStatus === "success") onClose();
  };

  const getNextLabel = () => {
    if (step === 1) return "Let's create a bot";
    if (step === 3) return "Connect Bot";
    if (step === 5 && feedbackStatus === "success") return "Done";
    return "Next";
  };

  const canProceed = () => {
    if (step === 2) return token.trim().length > 0;
    return true;
  };

  const botUsername = channelStatus?.botUsername;

  return (
    <WizardModal
      title="Set Up Discord Bot"
      totalSteps={TOTAL_STEPS}
      currentStep={step <= 3 ? step : step === 4 ? 4 : 5}
      onClose={onClose}
      onBack={() => setStep((s) => Math.max(1, s - 1))}
      onNext={handleNext}
      nextLabel={getNextLabel()}
      nextDisabled={!canProceed() || !isConnected || step === 4}
      showBack={step > 1 && step <= 3}
      showNext={step !== 4 && !(step === 5 && feedbackStatus === "error")}
      icon={<Bot size={18} />}
    >
      {step === 1 && (
        <WizardInfoBox
          icon={<Bot size={40} />}
          title="What is a Discord bot?"
          description="A Discord bot lets your team run ArchonIDE flows using slash commands in any Discord server. Anyone in the server can use /run, /list, and /status to interact with your flows."
          extra={
            <p className="wizard-hint" style={{ marginTop: 8 }}>
              <strong>No tunnel needed.</strong> Unlike Telegram, Discord bots connect outward on their own, so you don't need to set up a tunnel first.
            </p>
          }
        />
      )}

      {step === 2 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p className="wizard-section-title">Create a Discord application</p>
          <div className="wizard-instructions">
            <WizardInstruction step={1}>
              Go to the <strong>Discord Developer Portal</strong>
              <div style={{ marginTop: 4 }}>
                <WizardLink href="https://discord.com/developers/applications">Open Developer Portal</WizardLink>
              </div>
            </WizardInstruction>
            <WizardInstruction step={2}>
              Click <strong>"New Application"</strong> and give it a name (e.g. "Archon Bot")
            </WizardInstruction>
            <WizardInstruction step={3}>
              Go to the <strong>"Bot"</strong> tab on the left sidebar
            </WizardInstruction>
            <WizardInstruction step={4}>
              Click <strong>"Reset Token"</strong> to generate a new token, then copy it
            </WizardInstruction>
          </div>

          <WizardTokenInput
            value={token}
            onChange={setToken}
            placeholder="Paste your bot token here"
            label="Bot Token"
            helpText="This token is secret. Never share it publicly."
          />
        </div>
      )}

      {step === 3 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p className="wizard-section-title">Set up permissions</p>
          <p className="wizard-hint">
            Before connecting, make sure your bot has the right permissions in the Developer Portal:
          </p>
          <div className="wizard-instructions">
            <WizardInstruction step={1}>
              On the <strong>Bot</strong> page, scroll to <strong>"Privileged Gateway Intents"</strong> and enable <strong>Server Members Intent</strong> if needed
            </WizardInstruction>
            <WizardInstruction step={2}>
              Go to <strong>OAuth2</strong> &gt; <strong>URL Generator</strong>
            </WizardInstruction>
            <WizardInstruction step={3}>
              Under <strong>Scopes</strong>, select: <code>bot</code> and <code>applications.commands</code>
            </WizardInstruction>
            <WizardInstruction step={4}>
              Under <strong>Bot Permissions</strong>, select: <code>Send Messages</code> and <code>Use Slash Commands</code>
            </WizardInstruction>
            <WizardInstruction step={5}>
              Copy the generated URL at the bottom and <strong>open it in your browser</strong> to invite the bot to your server
            </WizardInstruction>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <p className="wizard-hint" style={{ margin: 0 }}>
              <strong>Optional:</strong> Paste the invite URL below to generate a QR code for easy sharing:
            </p>
            <input
              type="text"
              className="wizard-token-input"
              style={{ fontSize: 11, padding: "5px 8px", background: "var(--bg-tertiary)", border: "1px solid var(--border-primary)", borderRadius: 4, color: "var(--text-primary)", outline: "none" }}
              placeholder="https://discord.com/oauth2/authorize?client_id=..."
              value={inviteUrl}
              onChange={(e) => setInviteUrl(e.target.value)}
            />
            {inviteUrl.startsWith("https://discord.com/") && (
              <div style={{ display: "flex", justifyContent: "center", margin: "8px 0" }}>
                <QRCodeSVG
                  value={inviteUrl}
                  size={128}
                  bgColor="transparent"
                  fgColor="currentColor"
                  level="M"
                />
              </div>
            )}
          </div>

          <p className="wizard-hint">
            Once the bot is invited to your server, click "Connect Bot" below.
          </p>
        </div>
      )}

      {step === 4 && (
        <WizardStatusFeedback
          status="connecting"
          progressMessage={progressMsg}
        />
      )}

      {step === 5 && (
        <WizardStatusFeedback
          status={feedbackStatus}
          successTitle="Discord bot connected!"
          successDetails={
            <div className="wizard-success-details">
              {botUsername && <div className="wizard-success-bot">{botUsername}</div>}
              <p className="wizard-hint">
                Your bot is online! In any channel where the bot has been added, try these slash commands:
              </p>
              <div style={{ textAlign: "left", marginTop: 4 }}>
                <p className="wizard-hint">
                  <code>/list</code> -- See available flows<br />
                  <code>/run flow-name</code> -- Execute a flow<br />
                  <code>/status</code> -- Check gateway status
                </p>
              </div>
              <p className="wizard-hint" style={{ marginTop: 8 }}>
                <strong>Note:</strong> Global slash commands may take up to 1 hour to appear in Discord.
              </p>
            </div>
          }
          errorMessage={errorMsg}
          errorSuggestions={[
            "Check that your bot token is correct",
            "Make sure the bot has the Server Members Intent enabled",
            "Verify the bot has been invited to at least one server",
            "Check your internet connection",
          ]}
          onRetry={() => setStep(2)}
        />
      )}
    </WizardModal>
  );
}

import { useState, useEffect, useRef, useCallback } from "react";
import { MessageCircle } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { getSetting, setSetting } from "../../../lib/store";
import {
  WizardModal, WizardInfoBox, WizardTokenInput,
  WizardStatusFeedback, WizardInstruction, WizardLink, WizardWarning,
  type FeedbackStatus,
} from "./WizardModal";

interface TunnelStatus {
  provider: string;
  state: "stopped" | "starting" | "connected" | "reconnecting" | "error";
  publicUrl: string | null;
  error: string | null;
  uptimeMs: number;
}

interface ChannelStatus {
  type: string;
  state: "stopped" | "connecting" | "connected" | "error";
  botUsername: string | null;
  error: string | null;
}

interface TelegramSetupWizardProps {
  onClose: () => void;
  gatewaySend: (action: unknown) => void;
  tunnelStatus: TunnelStatus | undefined;
  channelStatus: ChannelStatus | undefined;
  isConnected: boolean;
  onOpenTunnelWizard: () => void;
}

const TOTAL_STEPS = 4;
const TIMEOUT_MS = 30_000;

export function TelegramSetupWizard({
  onClose, gatewaySend, tunnelStatus, channelStatus, isConnected, onOpenTunnelWizard,
}: TelegramSetupWizardProps) {
  const [step, setStep] = useState(1);
  const [token, setToken] = useState("");

  const [feedbackStatus, setFeedbackStatus] = useState<FeedbackStatus>("connecting");
  const [progressMsg, setProgressMsg] = useState("Configuring bot...");
  const [errorMsg, setErrorMsg] = useState("");
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const feedbackRef = useRef(feedbackStatus);
  feedbackRef.current = feedbackStatus;

  const tunnelReady = tunnelStatus?.state === "connected" && !!tunnelStatus.publicUrl;

  // Load saved token
  useEffect(() => {
    getSetting<string>("telegramBotToken", "").then(setToken);
  }, []);

  // Watch channel status on connecting step
  useEffect(() => {
    if (step !== 3) return;

    if (channelStatus?.state === "connecting") {
      setProgressMsg("Registering webhook with Telegram...");
    } else if (channelStatus?.state === "connected") {
      setFeedbackStatus("success");
      setSetting("telegramBotToken", token);
      setStep(4);
    } else if (channelStatus?.state === "error") {
      setFeedbackStatus("error");
      setErrorMsg(channelStatus.error || "Failed to connect to Telegram");
      setStep(4);
    }
  }, [channelStatus?.state, channelStatus?.error, step, token]);

  // Cleanup timeout
  useEffect(() => {
    if (feedbackStatus !== "connecting" && timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  }, [feedbackStatus]);

  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);

  const handleConnect = useCallback(() => {
    setStep(3);
    setFeedbackStatus("connecting");
    setProgressMsg("Configuring bot...");

    gatewaySend({
      type: "channel_configure",
      config: { type: "telegram", enabled: true, botToken: token.trim() },
    });

    setTimeout(() => {
      setProgressMsg("Connecting to Telegram...");
      gatewaySend({ type: "channel_start", channelType: "telegram" });
    }, 100);

    timeoutRef.current = setTimeout(() => {
      if (feedbackRef.current === "connecting") {
        setFeedbackStatus("error");
        setErrorMsg("Connection timed out after 30 seconds. Check your token and tunnel, then try again.");
        setStep(4);
      }
    }, TIMEOUT_MS);
  }, [token, gatewaySend]);

  const handleNext = () => {
    if (step === 1) setStep(2);
    else if (step === 2) handleConnect();
    else if (step === 4 && feedbackStatus === "success") onClose();
  };

  const getNextLabel = () => {
    if (step === 1) return "Let's create a bot";
    if (step === 2) return "Connect Bot";
    if (step === 4 && feedbackStatus === "success") return "Done";
    return "Next";
  };

  const canProceed = () => {
    if (step === 1) return tunnelReady;
    if (step === 2) return token.trim().length > 0 && tunnelReady;
    return true;
  };

  const botUsername = channelStatus?.botUsername;

  return (
    <WizardModal
      title="Set Up Telegram Bot"
      totalSteps={TOTAL_STEPS}
      currentStep={step <= 2 ? step : step === 3 ? 3 : 4}
      onClose={onClose}
      onBack={() => setStep((s) => Math.max(1, s - 1))}
      onNext={handleNext}
      nextLabel={getNextLabel()}
      nextDisabled={!canProceed() || !isConnected || step === 3}
      showBack={step > 1 && step <= 2}
      showNext={step !== 3 && !(step === 4 && feedbackStatus === "error")}
      icon={<MessageCircle size={18} />}
    >
      {step === 1 && (
        <>
          <WizardInfoBox
            icon={<MessageCircle size={40} />}
            title="What is a Telegram bot?"
            description="A Telegram bot lets you (or anyone you share it with) chat with your ArchonIDE flows directly from the Telegram app. Send commands, run flows, and get results right in your conversations."
          />

          {!tunnelReady && (
            <WizardWarning>
              <div>
                <strong>Tunnel required.</strong> Telegram needs a public URL to send messages to your bot.
                You need to set up a tunnel first.
                <div style={{ marginTop: 8 }}>
                  <button
                    className="wizard-btn-next"
                    style={{ fontSize: 11, padding: "5px 12px" }}
                    onClick={onOpenTunnelWizard}
                  >
                    <span>Set Up Tunnel First</span>
                  </button>
                </div>
              </div>
            </WizardWarning>
          )}

          {tunnelReady && (
            <p className="wizard-hint" style={{ textAlign: "center" }}>
              Tunnel is active at <strong>{tunnelStatus?.publicUrl}</strong>
            </p>
          )}
        </>
      )}

      {step === 2 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p className="wizard-section-title">Create your bot on Telegram</p>
          <div className="wizard-instructions">
            <WizardInstruction step={1}>
              Open Telegram and search for <strong>@BotFather</strong>
              <div style={{ marginTop: 4 }}>
                <WizardLink href="https://t.me/BotFather">Open @BotFather</WizardLink>
              </div>
            </WizardInstruction>
            <WizardInstruction step={2}>
              Send the command <code>/newbot</code>
            </WizardInstruction>
            <WizardInstruction step={3}>
              Follow the prompts to name your bot (e.g. "My Archon Bot")
            </WizardInstruction>
            <WizardInstruction step={4}>
              BotFather will give you a token that looks like:<br />
              <code>123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11</code>
            </WizardInstruction>
            <WizardInstruction step={5}>
              Copy that token and paste it below
            </WizardInstruction>
          </div>

          <WizardTokenInput
            value={token}
            onChange={setToken}
            placeholder="Paste your bot token here"
            label="Bot Token"
            helpText="This is a secret key that proves you own the bot. Keep it private."
          />
        </div>
      )}

      {step === 3 && (
        <WizardStatusFeedback
          status="connecting"
          progressMessage={progressMsg}
        />
      )}

      {step === 4 && (
        <WizardStatusFeedback
          status={feedbackStatus}
          successTitle="Telegram bot connected!"
          successDetails={
            <div className="wizard-success-details">
              {botUsername && <div className="wizard-success-bot">@{botUsername}</div>}
              {botUsername && (
                <div style={{ display: "flex", justifyContent: "center", margin: "12px 0" }}>
                  <QRCodeSVG
                    value={`https://t.me/${botUsername}`}
                    size={128}
                    bgColor="transparent"
                    fgColor="currentColor"
                    level="M"
                  />
                </div>
              )}
              <p className="wizard-hint" style={{ textAlign: "center" }}>
                Scan the QR code or click the link below to open the bot in Telegram.
              </p>
              <p className="wizard-hint">
                Send <code>/list</code> to see available flows,
                or <code>/run flow-name</code> to execute one.
              </p>
              {botUsername && (
                <div style={{ marginTop: 4 }}>
                  <WizardLink href={`https://t.me/${botUsername}`}>Open bot in Telegram</WizardLink>
                </div>
              )}
            </div>
          }
          errorMessage={errorMsg}
          errorSuggestions={[
            "Check that your bot token is correct (from @BotFather)",
            "Make sure the tunnel is still running",
            "Verify your internet connection",
          ]}
          onRetry={() => setStep(2)}
        />
      )}
    </WizardModal>
  );
}

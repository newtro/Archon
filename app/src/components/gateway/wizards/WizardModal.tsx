import { useState } from "react";
import {
  X, ArrowLeft, ArrowRight, Eye, EyeOff,
  CheckCircle, AlertCircle, Loader, ExternalLink,
} from "lucide-react";
import "./WizardModal.css";

// ── Shared wizard shell ─────────────────────────────────────────────────────

export interface WizardModalProps {
  title: string;
  totalSteps: number;
  currentStep: number;
  onClose: () => void;
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  showBack?: boolean;
  showNext?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

export function WizardModal({
  title, totalSteps, currentStep, onClose,
  onBack, onNext, nextLabel = "Next", nextDisabled = false,
  showBack = true, showNext = true, icon, children,
}: WizardModalProps) {
  return (
    <div className="wizard-backdrop" onClick={onClose}>
      <div className="wizard-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wizard-header">
          <div className="wizard-header-left">
            {icon}
            <h2 className="wizard-title">{title}</h2>
          </div>
          <button className="wizard-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <WizardStepIndicator total={totalSteps} current={currentStep} />

        <div className="wizard-body">
          {children}
        </div>

        <div className="wizard-footer">
          {showBack && currentStep > 1 ? (
            <button className="wizard-btn-back" onClick={onBack}>
              <ArrowLeft size={14} />
              <span>Back</span>
            </button>
          ) : <div />}
          {showNext && (
            <button
              className="wizard-btn-next"
              onClick={onNext}
              disabled={nextDisabled}
            >
              <span>{nextLabel}</span>
              <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Step indicator ──────────────────────────────────────────────────────────

function WizardStepIndicator({ total, current }: { total: number; current: number }) {
  return (
    <div className="wizard-steps">
      <div className="wizard-step-dots">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={`wizard-step-dot ${
              i + 1 < current ? "completed" : i + 1 === current ? "active" : ""
            }`}
          />
        ))}
      </div>
      <span className="wizard-step-label">Step {current} of {total}</span>
    </div>
  );
}

// ── Token input ─────────────────────────────────────────────────────────────

export interface WizardTokenInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label?: string;
  helpText?: string;
}

export function WizardTokenInput({ value, onChange, placeholder, label, helpText }: WizardTokenInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="wizard-field">
      {label && <label className="wizard-label">{label}</label>}
      <div className="wizard-token-row">
        <input
          type={visible ? "text" : "password"}
          className="wizard-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        <button className="wizard-icon-btn" onClick={() => setVisible(!visible)} type="button">
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      {helpText && <p className="wizard-help">{helpText}</p>}
    </div>
  );
}

// ── Status feedback ─────────────────────────────────────────────────────────

export type FeedbackStatus = "connecting" | "success" | "error";

export interface WizardStatusFeedbackProps {
  status: FeedbackStatus;
  progressMessage?: string;
  successTitle?: string;
  successDetails?: React.ReactNode;
  errorMessage?: string;
  errorSuggestions?: string[];
  onRetry?: () => void;
}

export function WizardStatusFeedback({
  status, progressMessage, successTitle, successDetails,
  errorMessage, errorSuggestions, onRetry,
}: WizardStatusFeedbackProps) {
  if (status === "connecting") {
    return (
      <div className="wizard-feedback connecting">
        <Loader size={28} className="wizard-spinner" />
        <p className="wizard-feedback-msg">{progressMessage || "Connecting..."}</p>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="wizard-feedback success">
        <CheckCircle size={32} />
        <h3 className="wizard-feedback-title">{successTitle || "Connected!"}</h3>
        {successDetails}
      </div>
    );
  }

  return (
    <div className="wizard-feedback error">
      <AlertCircle size={32} />
      <p className="wizard-feedback-msg">{errorMessage || "Something went wrong."}</p>
      {errorSuggestions && errorSuggestions.length > 0 && (
        <ul className="wizard-error-list">
          {errorSuggestions.map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      )}
      {onRetry && (
        <button className="wizard-btn-retry" onClick={onRetry}>Try Again</button>
      )}
    </div>
  );
}

// ── Provider card ───────────────────────────────────────────────────────────

export interface WizardProviderCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: string;
  selected: boolean;
  onClick: () => void;
}

export function WizardProviderCard({ icon, title, description, badge, selected, onClick }: WizardProviderCardProps) {
  return (
    <button
      className={`wizard-provider-card ${selected ? "selected" : ""}`}
      onClick={onClick}
      type="button"
    >
      <div className="wizard-provider-icon">{icon}</div>
      <div className="wizard-provider-text">
        <div className="wizard-provider-title">
          {title}
          {badge && <span className="wizard-provider-badge">{badge}</span>}
        </div>
        <p className="wizard-provider-desc">{description}</p>
      </div>
    </button>
  );
}

// ── Info box ────────────────────────────────────────────────────────────────

export interface WizardInfoBoxProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  extra?: React.ReactNode;
}

export function WizardInfoBox({ icon, title, description, extra }: WizardInfoBoxProps) {
  return (
    <div className="wizard-info-box">
      <div className="wizard-info-icon">{icon}</div>
      <h3 className="wizard-info-title">{title}</h3>
      <p className="wizard-info-desc">{description}</p>
      {extra}
    </div>
  );
}

// ── External link ───────────────────────────────────────────────────────────

export function WizardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <button
      className="wizard-external-link"
      onClick={() => window.open(href, "_blank")}
      type="button"
    >
      <ExternalLink size={12} />
      <span>{children}</span>
    </button>
  );
}

// ── Instruction step ────────────────────────────────────────────────────────

export function WizardInstruction({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <div className="wizard-instruction">
      <span className="wizard-instruction-num">{step}</span>
      <div className="wizard-instruction-text">{children}</div>
    </div>
  );
}

// ── Warning box ─────────────────────────────────────────────────────────────

export function WizardWarning({ children }: { children: React.ReactNode }) {
  return (
    <div className="wizard-warning">
      <AlertCircle size={16} />
      <div>{children}</div>
    </div>
  );
}

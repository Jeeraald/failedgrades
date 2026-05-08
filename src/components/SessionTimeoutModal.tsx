interface Props {
  countdown: number;
  totalSec?: number;
  onExtend: () => void;
  onLogout: () => void;
}

export default function SessionTimeoutModal({
  countdown,
  totalSec = 20,
  onExtend,
  onLogout,
}: Props) {
  const radius      = 38;
  const stroke      = 5;
  const circumference = 2 * Math.PI * radius;
  const progress    = Math.max(0, countdown / totalSec);
  const offset      = circumference * (1 - progress);
  const isUrgent    = countdown <= 5;

  return (
    <div className="session-timeout-overlay">
      {/* Backdrop */}
      <div className="session-timeout-backdrop" />

      {/* Card */}
      <div className="session-timeout-card">
        {/* Colour stripe */}
        <div className={`session-timeout-stripe ${isUrgent ? "urgent" : ""}`} />

        <div className="session-timeout-body">
          {/* Lock icon */}
          <div className={`session-timeout-icon-wrap ${isUrgent ? "urgent" : ""}`}>
            <i className="pi pi-lock" style={{ fontSize: "1.75rem" }} />
          </div>

          {/* Title */}
          <h2 className="session-timeout-title">Session Timeout</h2>

          {/* Message */}
          <p className="session-timeout-message">
            Your session is about to expire due to inactivity.
          </p>

          {/* Countdown ring */}
          <div className="session-timeout-ring-wrap">
            <svg width={100} height={100} className="session-timeout-ring-svg">
              {/* Track */}
              <circle
                cx={50} cy={50} r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth={stroke}
                className="session-timeout-ring-track"
              />
              {/* Progress arc */}
              <circle
                cx={50} cy={50} r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                className={`session-timeout-ring-arc ${isUrgent ? "urgent" : ""}`}
                style={{ transition: "stroke-dashoffset 1s linear" }}
                transform="rotate(-90 50 50)"
              />
            </svg>
            {/* Number */}
            <span className={`session-timeout-count ${isUrgent ? "urgent" : ""}`}>
              {countdown}
            </span>
          </div>

          <p className="session-timeout-sub">
            You will be logged out automatically in{" "}
            <strong>
              {countdown} second{countdown !== 1 ? "s" : ""}
            </strong>
            .
          </p>

          {/* Buttons */}
          <div className="session-timeout-actions">
            <button
              onClick={onLogout}
              className="session-timeout-btn-logout"
            >
              <i className="pi pi-sign-out" style={{ fontSize: "0.8rem" }} />
              Logout Now
            </button>
            <button
              onClick={onExtend}
              className="session-timeout-btn-extend"
            >
              <i className="pi pi-refresh" style={{ fontSize: "0.8rem" }} />
              Extend Session
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

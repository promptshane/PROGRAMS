import { useState, useRef, useEffect } from "react";

export function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M10.9 2.1h2.2l.4 2a8 8 0 0 1 1.8.8l1.8-1.1 1.6 1.6-1.1 1.8a8 8 0 0 1 .8 1.8l2 .4v2.2l-2 .4a8 8 0 0 1-.8 1.8l1.1 1.8-1.6 1.6-1.8-1.1a8 8 0 0 1-1.8.8l-.4 2h-2.2l-.4-2a8 8 0 0 1-1.8-.8l-1.8 1.1-1.6-1.6 1.1-1.8a8 8 0 0 1-.8-1.8l-2-.4V9.7l2-.4a8 8 0 0 1 .8-1.8L4 5.7l1.6-1.6 1.8 1.1a8 8 0 0 1 1.8-.8l.4-2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function TimerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9 2h6M12 8v4l2.5 2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="14" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M16.5 6.5 18 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MoreIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="5" cy="10" r="1.15" fill="currentColor" />
      <circle cx="10" cy="10" r="1.15" fill="currentColor" />
      <circle cx="15" cy="10" r="1.15" fill="currentColor" />
    </svg>
  );
}

export function ExclamationIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M10 4.25v7.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx="10" cy="14.75" r="1.1" fill="currentColor" />
    </svg>
  );
}

export function SidebarToggleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 7h14M5 12h10M5 17h14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AutomationIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 7.5h7.8a3.7 3.7 0 0 1 3.7 3.7V12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m16.5 7.5 2 3-3 2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17 16.5H9.2a3.7 3.7 0 0 1-3.7-3.7V12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m7.5 16.5-2-3 3-2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AutomationStarIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M11.5 3.1c.15-.46.8-.46.95 0l1.53 4.72c.11.34.42.57.78.57h4.97c.49 0 .69.63.29.92l-4.02 2.92a.82.82 0 0 0-.3.91l1.53 4.72c.15.46-.38.84-.78.55l-4.02-2.92a.82.82 0 0 0-.97 0l-4.02 2.92c-.4.29-.93-.09-.78-.55l1.53-4.72a.82.82 0 0 0-.3-.91L2.98 9.31c-.4-.29-.2-.92.29-.92h4.97c.36 0 .67-.23.78-.57L10.55 3.1Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="m5.5 7.5 4.5 4.5 4.5-4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 5v14M5 12h14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.5 6.75v10.5L17 12 8.5 6.75Z" fill="currentColor" />
    </svg>
  );
}

export function TypewriterText({ text, speed = 8 }: { text: string; speed?: number }) {
  const [displayed, setDisplayed] = useState("");
  const prevTextRef = useRef("");

  useEffect(() => {
    const prev = prevTextRef.current;
    if (text.startsWith(prev) && prev.length < text.length) {
      const newPortion = text.slice(prev.length);
      let i = 0;
      const interval = setInterval(() => {
        if (i < newPortion.length) {
          i++;
          setDisplayed(prev + newPortion.slice(0, i));
        } else {
          clearInterval(interval);
          prevTextRef.current = text;
        }
      }, speed);
      return () => clearInterval(interval);
    }
    setDisplayed(text);
    prevTextRef.current = text;
  }, [text, speed]);

  return <>{displayed}</>;
}

export function ArrowUpIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 19V6m0 0-5 5m5-5 5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />
    </svg>
  );
}

export function XIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 7 17 17M17 7 7 17"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="m5 10 3.1 3.1L15 6.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.342-3.369-1.342-.454-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.004.071 1.532 1.031 1.532 1.031.892 1.529 2.341 1.087 2.91.831.091-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.577 9.577 0 0 1 12 6.836a9.58 9.58 0 0 1 2.504.337c1.909-1.294 2.748-1.025 2.748-1.025.546 1.377.202 2.394.1 2.647.641.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
    </svg>
  );
}

export function RunningIndicator() {
  return (
    <span className="runningIndicator">
      <span>Running</span>
      <span className="runningDots" aria-hidden="true">
        <span>.</span>
        <span>.</span>
        <span>.</span>
      </span>
    </span>
  );
}

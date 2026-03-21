import type {
  PingLifecyclePhase,
  PingRawReportStatus,
  PingTranslationMetadata,
} from "./types.ts";

const PING_STATUS_TRANSLATIONS: Record<PingRawReportStatus, { zhResponse: string; enTranslation: string }> = {
  success: {
    zhResponse: "已完成。修改已保存。",
    enTranslation: "Done. Changes saved.",
  },
  no_changes: {
    zhResponse: "已检查。没有文件变化。",
    enTranslation: "Checked. No file change.",
  },
  blocked: {
    zhResponse: "被阻塞。需要处理问题。",
    enTranslation: "Blocked. Need fix issue.",
  },
  unexpected: {
    zhResponse: "有异常。需要后续处理。",
    enTranslation: "Unexpected. Need follow-up.",
  },
};

const PING_LIFECYCLE_TRANSLATIONS: Record<PingLifecyclePhase, { zhResponse: string }> = {
  intro: {
    zhResponse: "我来看看实现……",
  },
  outro: {
    zhResponse: "我先退出代码线程了。",
  },
};

export const getPingStatusTranslation = (
  status: PingRawReportStatus,
): { zhResponse: string; enTranslation: string } => PING_STATUS_TRANSLATIONS[status];

export const buildPingStatusTranslationMetadata = (
  status: PingRawReportStatus,
): PingTranslationMetadata => {
  const translation = getPingStatusTranslation(status);
  return {
    type: "ping-translation",
    kind: "status",
    status,
    zhResponse: translation.zhResponse,
    enTranslation: translation.enTranslation,
  };
};

export const buildPingLifecycleTranslationMetadata = (
  phase: PingLifecyclePhase,
  enTranslation: string,
): PingTranslationMetadata => {
  const translation = PING_LIFECYCLE_TRANSLATIONS[phase];
  return {
    type: "ping-translation",
    kind: "lifecycle",
    phase,
    zhResponse: translation.zhResponse,
    enTranslation,
  };
};

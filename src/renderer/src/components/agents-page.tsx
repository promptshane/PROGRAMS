import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DirectorInfoPanel, DirectorProfilePanel } from "./director-panels";
import {
  ExecutionReportPanel,
  PingTaskPanel,
  PingPlanPanel,
  PingUpdateReportPanel,
  renderPingAwareMessageContent,
} from "./execution-panels";
import { HardMemoryReportPanel, ErrorBoundaryPanel } from "./hard-memory-report";
import { ConceptOverview } from "./core-details";
import { StatusChip, Modal } from "./ui-primitives";
import { AgentChatMarkdown } from "../lib/agent-chat-markdown";
import { formatAgentChatTimestamp } from "../lib/formatting";
import { coerceAgentChatText } from "../lib/agent-chat-markdown";
import {
  getConfirmedConcept,
  getWorkingConcept,
  buildAgentProjectDescription,
  buildDisplayedUpdatePlan,
  findLivePendingApproval,
  getLivePendingApprovals,
} from "../lib/session-helpers";
import {
  AGENT_CHAT_COMPOSER_MIN_HEIGHT,
  AGENT_DETAILS_DIRECTOR_FLOW,
} from "../lib/constants";
import { type ComposerOptions, getComposerDefaults, syncComposerTextareaHeight } from "../lib/project-helpers";
import { buildAgentChatConversationRenderItems } from "../lib/agent-chat-grouping";
import {
  deriveJeffPresenceState,
  getLatestAgentChatUserTurn,
  type JeffLivePresenceWindow,
  resolveAgentChatRouteForRenderer,
  userTurnIncludesDirector,
} from "../lib/jeff-presence";
import {
  getNextPendingProgrammingUpdate,
  resolveAgentAlertState,
} from "../lib/agent-alert-state";
import {
  DIRECTOR_COLORS,
  DIRECTOR_NAMES,
  DIRECTOR_LABELS,
  type AgentSession,
  type DirectorId,
  type DirectorFocusMode,
  type HardMemoryReportMetadata,
  type JeffExecutionReport,
  type ModelCatalog,
  type PendingApproval,
  type Project,
  type Settings,
  type AgentChatMessage,
} from "@shared/types";
import { getDirectorMetadata, matchDirectRoutePattern } from "@shared/director-metadata";
import { AgentProjectDetailsModal, type DetailsView } from "./agent-project-details-modal";
import { AgentLandingCard } from "./home-tiles";
import { PendingApprovalsPanel } from "./update-stage-panel";
import { ComposerControlBar } from "./composer";

export type { DetailsView };

export type AgentDepartment = "Management" | "Creative" | "R&D" | "Programming" | "Validation";

export function AgentsPage({
  projects,
  settings,
  agentSession,
  agentSelectedProjectId,
  requestedDirectorProfileId,
  modelCatalog,
  onSelectProject,
  onSessionUpdate,
  onUpdateAgentDefaults,
  onDirectorProfileRequestHandled,
  pushToast,
}: {
  projects: Project[];
  settings: Settings;
  agentSession: AgentSession | null;
  agentSelectedProjectId: string | null;
  requestedDirectorProfileId?: DirectorId | null;
  modelCatalog: ModelCatalog;
  onSelectProject: (projectId: string | null) => void;
  onSessionUpdate: (session: AgentSession) => void;
  onUpdateAgentDefaults: (advancedDefaults: Partial<Settings["advancedDefaults"]>) => Promise<void>;
  onDirectorProfileRequestHandled?: () => void;
  pushToast: (message: string, level: "info" | "success" | "error") => void;
}) {
  const [showProjectDetails, setShowProjectDetails] = useState(false);
  const [projectDetailsInitialView, setProjectDetailsInitialView] = useState<DetailsView | undefined>(undefined);
  const [showDirectorProfile, setShowDirectorProfile] = useState<DirectorId | null>(null);
  const [activePanel, setActivePanel] = useState<
    | { type: "none" }
    | { type: "hard-memory-report"; messageId: string }
    | { type: "research"; message: AgentChatMessage }
    | { type: "update"; message: AgentChatMessage }
    | { type: "execution-report"; message: AgentChatMessage }
    | { type: "ping-task"; message: AgentChatMessage }
    | { type: "ping-plan"; message: AgentChatMessage }
    | { type: "ping-update-report"; message: AgentChatMessage }
  >({ type: "none" });
  const closePanel = () => setActivePanel({ type: "none" });
  const [messageValue, setMessageValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [alertedDirectorId, setAlertedDirectorId] = useState<DirectorId | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<AgentChatMessage[]>([]);
  const [jeffLivePresenceByProject, setJeffLivePresenceByProject] = useState<Record<string, JeffLivePresenceWindow>>({});
  const [jeffPresenceTick, setJeffPresenceTick] = useState(() => Date.now());
  const [pendingAgentAlert, setPendingAgentAlert] = useState<{
    directorId: DirectorId;
    warningTargetDirectorId: DirectorId;
  } | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const agentChatRuntimeOptions = useMemo<ComposerOptions>(
    () => ({
      ...getComposerDefaults(settings),
      planningMode: "none",
    }),
    [
      settings.advancedDefaults.provider,
      settings.advancedDefaults.model,
      settings.advancedDefaults.claudeModel,
      settings.advancedDefaults.reasoningEffort,
      settings.defaultSpeed,
      settings.autoApprovePlans,
    ],
  );

  const DIRECTOR_SECTIONS: {
    id: DirectorId;
    department: AgentDepartment;
    label: string;
    color: string;
  }[] = [
    { id: "project-manager", department: "Management", label: "Jeff — Project Manager",
      color: DIRECTOR_COLORS["project-manager"] },
    { id: "creative-director", department: "Creative", label: "Dan — Creative Director",
      color: DIRECTOR_COLORS["creative-director"] },
    { id: "rd-director", department: "R&D", label: "Todd — R&D Director",
      color: DIRECTOR_COLORS["rd-director"] },
    { id: "programming-director", department: "Programming", label: "Ping — Programming Director",
      color: DIRECTOR_COLORS["programming-director"] },
    { id: "validation-director", department: "Validation", label: "Pong — Validation Director",
      color: DIRECTOR_COLORS["validation-director"] },
  ];

  const AGENT_LANDING_SECTION_ORDER: AgentDepartment[] = ["Management", "Creative", "R&D", "Programming", "Validation"];

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === agentSelectedProjectId) ?? null,
    [agentSelectedProjectId, projects],
  );

  const agentChatMessages = agentSession?.slackMessages ?? [];
  const displayMessages = useMemo(
    () => [...agentChatMessages, ...optimisticMessages],
    [agentChatMessages, optimisticMessages],
  );
  const selectedJeffLivePresence = agentSelectedProjectId
    ? jeffLivePresenceByProject[agentSelectedProjectId] ?? null
    : null;
  const latestAgentChatUserTurn = useMemo(
    () => getLatestAgentChatUserTurn(displayMessages),
    [displayMessages],
  );
  const jeffPresenceState = useMemo(
    () => deriveJeffPresenceState({
      messages: displayMessages,
      now: new Date(jeffPresenceTick),
      liveWindow: selectedJeffLivePresence,
    }),
    [displayMessages, jeffPresenceTick, selectedJeffLivePresence],
  );
  const activeJeffTurnMessageIds = useMemo(() => {
    if (!selectedJeffLivePresence || !latestAgentChatUserTurn || !userTurnIncludesDirector(latestAgentChatUserTurn, "project-manager")) {
      return new Set<string>();
    }

    return new Set(
      latestAgentChatUserTurn.followingMessages
        .filter((message) => message.role === "assistant" && message.directorId === "project-manager")
        .map((message) => message.id),
    );
  }, [latestAgentChatUserTurn, selectedJeffLivePresence]);
  const visibleMessages = useMemo(() => displayMessages.filter((message) => {
    if (jeffPresenceState.source !== "live" || !activeJeffTurnMessageIds.has(message.id)) {
      return true;
    }
    if (!jeffPresenceState.present) {
      return false;
    }
    if (message.status === "working" && !jeffPresenceState.typingAllowed) {
      return false;
    }
    return true;
  }), [activeJeffTurnMessageIds, displayMessages, jeffPresenceState.present, jeffPresenceState.source, jeffPresenceState.typingAllowed]);
  const renderedAgentChatMessages = useMemo(
    () => buildAgentChatConversationRenderItems(visibleMessages),
    [visibleMessages],
  );
  const hardMemoryReportMessage = useMemo(
    () => activePanel.type === "hard-memory-report"
      ? displayMessages.find((message) => message.id === activePanel.messageId && message.metadata?.type === "hard-memory-report") ?? null
      : null,
    [displayMessages, activePanel],
  );
  const hardMemoryReport = hardMemoryReportMessage?.metadata?.type === "hard-memory-report"
    ? hardMemoryReportMessage.metadata
    : null;
  const livePendingApprovals = useMemo(
    () => getLivePendingApprovals(agentSession),
    [agentSession],
  );
  const hardMemoryReportApproval = hardMemoryReport && agentSession
    ? findLivePendingApproval(agentSession, hardMemoryReport.approvalId)
    : null;
  const agentChatConversationSignature = useMemo(
    () => visibleMessages
      .map((message) => [
        message.id,
        message.role,
        message.directorId ?? "",
        message.createdAt,
        message.status ?? "",
        message.content,
        message.metadata ? JSON.stringify(message.metadata) : "",
      ].join("|"))
      .join("||"),
    [visibleMessages],
  );

  const activeNonJeffDirectorId: DirectorId | null =
    agentSession?.slackActiveDirectorId && agentSession.slackActiveDirectorId !== "project-manager"
      ? agentSession.slackActiveDirectorId
      : null;
  const passiveGuestId = agentSession?.slackPresenceGuestId ?? null;
  const presentDirectorIds = useMemo(() => {
    const ids = new Set<DirectorId>();
    if (jeffPresenceState.present) {
      ids.add("project-manager");
    }
    if (activeNonJeffDirectorId) {
      ids.add(activeNonJeffDirectorId);
    }
    if (passiveGuestId && passiveGuestId !== "project-manager") {
      ids.add(passiveGuestId);
    }
    return ids;
  }, [activeNonJeffDirectorId, jeffPresenceState.present, passiveGuestId]);
  const activeDirectorId: DirectorId | null = alertedDirectorId
    ?? activeNonJeffDirectorId
    ?? (jeffPresenceState.present ? "project-manager" : null);
  const automationTargetTitle = useMemo(() => {
    const targetId = agentSession?.automation.selectedTargetUpdateId;
    if (!targetId) {
      return null;
    }
    return agentSession?.toddMemory.futureUpdatePlan.find((update) => update.id === targetId)?.title
      ?? selectedProject?.name
      ?? null;
  }, [selectedProject?.name, agentSession?.automation.selectedTargetUpdateId, agentSession?.toddMemory.futureUpdatePlan]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [agentChatConversationSignature, isLoading]);

  useEffect(() => {
    setJeffPresenceTick(Date.now());
  }, [agentSelectedProjectId, displayMessages]);

  useEffect(() => {
    if (!jeffPresenceState.nextTransitionAt) {
      return;
    }

    const timeoutId = window.setTimeout(
      () => setJeffPresenceTick(Date.now()),
      Math.max(0, jeffPresenceState.nextTransitionAt - Date.now()),
    );

    return () => window.clearTimeout(timeoutId);
  }, [jeffPresenceState.nextTransitionAt]);

  useEffect(() => {
    setOptimisticMessages([]);
  }, [agentChatMessages.length]);

  useEffect(() => {
    if (!agentSelectedProjectId) {
      setShowProjectDetails(false);
      setShowDirectorProfile(null);
    }
    closePanel();
  }, [agentSelectedProjectId]);

  useEffect(() => {
    if (activePanel.type === "hard-memory-report" && !hardMemoryReportMessage) {
      closePanel();
    }
  }, [hardMemoryReportMessage, activePanel]);

  useEffect(() => {
    if (!requestedDirectorProfileId || !agentSelectedProjectId) {
      return;
    }
    setShowDirectorProfile(requestedDirectorProfileId);
    onDirectorProfileRequestHandled?.();
  }, [agentSelectedProjectId, onDirectorProfileRequestHandled, requestedDirectorProfileId]);

  useEffect(() => {
    if (activePanel.type === "ping-task" && !displayMessages.some((message) => message.id === activePanel.message.id)) {
      closePanel();
    }
  }, [displayMessages, activePanel]);

  useLayoutEffect(() => {
    syncComposerTextareaHeight(composerInputRef.current, { minHeight: AGENT_CHAT_COMPOSER_MIN_HEIGHT });
  }, [messageValue, agentSelectedProjectId]);

  const handleSend = async () => {
    if (!messageValue.trim() || !agentSelectedProjectId) return;
    const msg = messageValue.trim();
    const sendTimestamp = Date.now();
    setMessageValue("");

    const optimisticUserMsg: AgentChatMessage = {
      id: `opt-${sendTimestamp}`,
      role: "user",
      directorId: null,
      content: msg,
      createdAt: new Date().toISOString(),
    };
    setOptimisticMessages((prev) => [...prev, optimisticUserMsg]);

    let targetDirectorId = matchDirectRoutePattern(msg);
    if (targetDirectorId === "project-manager") {
      targetDirectorId = null;
    }
    if (!targetDirectorId && alertedDirectorId && alertedDirectorId !== "project-manager") {
      targetDirectorId = alertedDirectorId === "programming-director" || alertedDirectorId === "validation-director"
        ? "rd-director"
        : alertedDirectorId;
    }
    const effectiveDirectorId = targetDirectorId
      ?? resolveAgentChatRouteForRenderer(msg, activeNonJeffDirectorId);

    setJeffPresenceTick(sendTimestamp);
    setJeffLivePresenceByProject((prev) => {
      if (!agentSelectedProjectId) {
        return prev;
      }
      if (effectiveDirectorId !== "project-manager") {
        if (!(agentSelectedProjectId in prev)) {
          return prev;
        }
        const next = { ...prev };
        delete next[agentSelectedProjectId];
        return next;
      }
      return {
        ...prev,
        [agentSelectedProjectId]: {
          triggeredAt: sendTimestamp,
          animateEntry: !jeffPresenceState.present,
        },
      };
    });

    setIsLoading(true);

    try {
      if (agentSession?.automation.status === "running") {
        const paused = await window.programs.pauseAutomationRun({
          projectId: agentSelectedProjectId,
          summary: "Automation paused because the user took manual control.",
        });
        onSessionUpdate(paused);
      }
      await window.programs.agentChat({
        projectId: agentSelectedProjectId,
        provider: settings.advancedDefaults.provider,
        model: settings.advancedDefaults.model,
        claudeModel: settings.advancedDefaults.claudeModel,
        message: msg,
        targetDirectorId,
      });
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Something went wrong.", "error");
    } finally {
      try {
        const refreshed = await window.programs.getAgentSession(agentSelectedProjectId);
        if (refreshed) onSessionUpdate(refreshed);
      } catch {
        // Keep the latest optimistic or live event-driven state if the refresh fails.
      }
      setIsLoading(false);
      setAlertedDirectorId(null);
      setSelectedMessageId(null);
    }
  };

  const handleMessageClick = (msg: AgentChatMessage) => {
    if (msg.role !== "assistant" || !msg.directorId) return;
    if (selectedMessageId === msg.id) {
      setSelectedMessageId(null);
      setAlertedDirectorId(null);
    } else {
      setSelectedMessageId(msg.id);
      setAlertedDirectorId(msg.directorId);
    }
  };

  const handleAutomationControl = async (action: "pause" | "resume" | "stop" | "recovery") => {
    if (!agentSelectedProjectId) return;
    try {
      const updated = action === "pause"
        ? await window.programs.pauseAutomationRun({
          projectId: agentSelectedProjectId,
          summary: "Automation paused.",
        })
        : action === "resume"
          ? await window.programs.resumeAutomationRun(agentSelectedProjectId)
          : action === "stop"
            ? await window.programs.stopAutomationRun({
              projectId: agentSelectedProjectId,
              summary: "Automation stopped.",
            })
            : await window.programs.requestAutomationFailureRecovery({
              projectId: agentSelectedProjectId,
            });
      onSessionUpdate(updated);
      pushToast(
        action === "pause"
          ? "Automation paused."
          : action === "resume"
            ? "Automation resumed."
            : action === "stop"
              ? "Automation stopped."
              : "Failure recovery queued for confirmation.",
        action === "stop" ? "info" : "success",
      );
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Could not update automation.", "error");
    }
  };

  const runDirectorAlertAction = useCallback(async (directorId: DirectorId) => {
    if (!agentSelectedProjectId) return;

    closePanel();

    const alertState = resolveAgentAlertState(directorId, agentSession);
    if (!alertState) {
      return;
    }

    if (alertState.action === "refresh-project") {
      setIsLoading(true);
      try {
        await window.programs.refreshProject({
          projectId: agentSelectedProjectId,
          provider: settings.advancedDefaults.provider,
          model: settings.advancedDefaults.model,
          claudeModel: settings.advancedDefaults.claudeModel,
        });
        const refreshed = await window.programs.getAgentSession(agentSelectedProjectId);
        if (refreshed) onSessionUpdate(refreshed);
        pushToast("Project refresh queued for confirmation.", "success");
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "Something went wrong.", "error");
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (alertState.action === "review-jeff-work") {
      const latestExecutionMessage = [...(agentSession?.slackMessages ?? [])]
        .reverse()
        .find((message) => message.metadata?.type === "execution-report") ?? null;
      const latestReport = agentSession?.pingMemory.latestJeffReport
        ?? (latestExecutionMessage?.metadata?.type === "execution-report"
          ? latestExecutionMessage.metadata.report
          : null)
        ?? null;
      if (!latestReport) {
        return;
      }
      const existingMessage = [...(agentSession?.slackMessages ?? [])]
        .reverse()
        .find((message) => message.metadata?.type === "execution-report" && message.metadata.report.id === latestReport.id)
        ?? null;
      const reportMessage: AgentChatMessage = existingMessage ?? {
        id: `execution-report-${latestReport.id}`,
        role: "assistant",
        directorId: "project-manager",
        content: latestReport.summary,
        createdAt: latestReport.createdAt,
        status: "complete",
        metadata: {
          type: "execution-report",
          report: latestReport,
        },
      };
      setActivePanel({ type: "execution-report", message: reportMessage });
      return;
    }

    if (alertState.action === "regenerate-todd-plan") {
      setIsLoading(true);
      try {
        await window.programs.regenerateToddPlan({
          projectId: agentSelectedProjectId,
          provider: settings.advancedDefaults.provider,
          model: settings.advancedDefaults.model,
          claudeModel: settings.advancedDefaults.claudeModel,
        });
        const refreshed = await window.programs.getAgentSession(agentSelectedProjectId);
        if (refreshed) onSessionUpdate(refreshed);
        pushToast("Todd's plan regenerated.", "success");
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "Something went wrong.", "error");
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // For other directors, send a memory-processing message via agent chat
    const promptMessage = alertState.action === "reconcile-dan-memory"
      ? "@dan Let's reconcile the discussed and derived core-details before we confirm hard memory."
      : directorId === "creative-director"
        ? "@dan Let's review and process the notes we've gathered."
        : directorId === "project-manager"
          ? "Let's review the pending update reports and decide outcomes."
          : "@todd Let's review and process the pending handoff from Dan.";

    const optimisticUserMsg: AgentChatMessage = {
      id: `opt-${Date.now()}`,
      role: "user",
      directorId: null,
      content: promptMessage,
      createdAt: new Date().toISOString(),
    };
    setOptimisticMessages((prev) => [...prev, optimisticUserMsg]);
    setIsLoading(true);

    try {
      if (agentSession?.automation.status === "running") {
        const paused = await window.programs.pauseAutomationRun({
          projectId: agentSelectedProjectId,
          summary: "Automation paused because the user triggered a manual agent step.",
        });
        onSessionUpdate(paused);
      }
      await window.programs.agentChat({
        projectId: agentSelectedProjectId,
        provider: settings.advancedDefaults.provider,
        model: settings.advancedDefaults.model,
        claudeModel: settings.advancedDefaults.claudeModel,
        message: promptMessage,
        targetDirectorId: directorId === "project-manager" ? null : directorId,
      });
      const refreshed = await window.programs.getAgentSession(agentSelectedProjectId);
      if (refreshed) onSessionUpdate(refreshed);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Something went wrong.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [
    agentSelectedProjectId,
    agentSession,
    onSessionUpdate,
    pushToast,
    settings.advancedDefaults.provider,
    settings.advancedDefaults.model,
    settings.advancedDefaults.claudeModel,
  ]);

  const handleDirectorAlertClick = useCallback((directorId: DirectorId) => {
    const alertState = resolveAgentAlertState(directorId, agentSession);
    if (!alertState) return;
    if (alertState.warningTargetDirectorId) {
      setPendingAgentAlert({
        directorId,
        warningTargetDirectorId: alertState.warningTargetDirectorId,
      });
      return;
    }
    void runDirectorAlertAction(directorId);
  }, [agentSession, runDirectorAlertAction]);

  return (
    <section className={agentSelectedProjectId ? "agentsPage agentsPage-conversation" : "agentsPage"}>
      <div className="agentsTopBar agentTopBar windowNoDrag">
        <div className="agentTopBarPrimary">
          <select
            className="plannerSelect"
            value={agentSelectedProjectId ?? ""}
            onChange={(e) => onSelectProject(e.target.value || null)}
          >
            <option value="" disabled>Select a project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        {selectedProject ? <div className="agentTopBarSpacer" aria-hidden="true" /> : null}
        {selectedProject ? (
          <button
            type="button"
            className="agentTopBarButton agentDetailsButton"
            onClick={() => setShowProjectDetails(true)}
          >
            Project Details
          </button>
        ) : null}
      </div>

      {agentSelectedProjectId && livePendingApprovals.length > 0 ? (
        <PendingApprovalsPanel
          projectId={agentSelectedProjectId}
          session={agentSession}
          onSessionUpdate={onSessionUpdate}
          pushToast={pushToast}
        />
      ) : null}

      <div className="chatViewportDivider pageChromeDivider" aria-hidden="true" />
      <div className="agentLandingGrid">
        {AGENT_LANDING_SECTION_ORDER.map((department) => {
          const director = DIRECTOR_SECTIONS.find((item) => item.department === department);
          if (!director) {
            return null;
          }

          const directorName = DIRECTOR_NAMES[director.id];
          const isActive = director.id === activeDirectorId;
          const isPresent = Boolean(agentSelectedProjectId) && presentDirectorIds.has(director.id);

          const alertState = resolveAgentAlertState(director.id, agentSession);

          return (
            <section key={department} className="agentDepartmentSection">
              <div className="agentDepartmentContent">
                <AgentLandingCard
                  name={directorName}
                  color={director.color}
                  footerLabel={department}
                  active={isActive}
                  present={isPresent}
                  muted={!agentSelectedProjectId || !isPresent}
                  disabled={!agentSelectedProjectId}
                  onClick={() => {
                    if (agentSelectedProjectId) {
                      setShowDirectorProfile(director.id);
                    }
                  }}
                  onOpenOptions={agentSelectedProjectId ? () => {
                    setShowDirectorProfile(director.id);
                  } : undefined}
                  alertTone={alertState?.tone ?? null}
                  onExclamationClick={alertState && agentSelectedProjectId ? () => {
                    handleDirectorAlertClick(director.id);
                  } : undefined}
                  ariaLabel={`View ${directorName} info`}
                />
              </div>
            </section>
          );
        })}
      </div>

      {agentSelectedProjectId ? (
        <>
          {(agentSession?.automation.status ?? "idle") !== "idle" || agentSession?.automation.selectedTargetUpdateId ? (
            <div className="agentDetailsCard" style={{ marginBottom: 12 }}>
              <div className="agentDetailsSubsectionHead">
                <h5 style={{ margin: 0 }}>Automation</h5>
                <StatusChip tone={
                  agentSession?.automation.status === "running"
                    ? "info"
                    : agentSession?.automation.status === "completed"
                      ? "confirmed"
                      : agentSession?.automation.status === "stopped"
                        ? "action_required"
                        : "neutral"
                }>
                  {agentSession?.automation.status ?? "idle"}
                </StatusChip>
              </div>
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>
                {automationTargetTitle
                  ? `Target: ${automationTargetTitle}`
                  : "No automation target is selected yet."}
              </p>
              {agentSession?.automation.nextUpdateId ? (
                <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--muted)" }}>
                  Next update: {agentSession.toddMemory.futureUpdatePlan.find((update) => update.id === agentSession.automation.nextUpdateId)?.title ?? "Waiting on current step"}
                </p>
              ) : null}
              {agentSession?.automation.stopSummary ? (
                <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--muted)" }}>
                  {agentSession.automation.stopSummary}
                </p>
              ) : null}
              <div className="proposalActions" style={{ marginTop: 10 }}>
                <button
                  className="secondaryButton"
                  disabled={agentSession?.automation.status !== "running"}
                  onClick={() => void handleAutomationControl("pause")}
                >
                  Pause
                </button>
                <button
                  className="secondaryButton"
                  disabled={agentSession?.automation.status !== "paused" && agentSession?.automation.status !== "stopped"}
                  onClick={() => void handleAutomationControl("resume")}
                >
                  Resume
                </button>
                <button
                  className="secondaryButton"
                  disabled={agentSession?.automation.status !== "running" && agentSession?.automation.status !== "paused"}
                  onClick={() => void handleAutomationControl("stop")}
                >
                  Stop
                </button>
                {agentSession?.automation.pendingRevertCommitSha ? (
                  <button className="secondaryButton" onClick={() => void handleAutomationControl("recovery")}>
                    Queue Recovery Revert
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="conversationViewportShell agentChatConversationViewportShell">
            <div className="chatViewportDivider" aria-hidden="true" />
            <div className="agentContentLayout">
              <div className="agentChatPane">
                <div className="agentChatScroll agentChatScroll" ref={chatScrollRef}>
                  <div className="agentUnifiedConversation">
                    {renderedAgentChatMessages.map(({ message: msg, dayLabel, showSenderLabel, isSenderContinuation }) => (
                      <div
                        key={msg.id}
                        className={`agentChatConversationItem${isSenderContinuation ? " agentChatConversationItem--continuation" : ""}${msg.role === "user" ? " agentChatConversationItem--user" : ""}${dayLabel && msg.role === "user" ? " agentChatConversationItem--userDayStart" : ""}`}
                      >
                        {dayLabel ? (
                          <div className="agentChatDaySeparator">
                            <span className="agentChatDaySeparatorLabel">{dayLabel}</span>
                          </div>
                        ) : null}
                        {msg.role === "system" ? (
                          <div className="agentChatSystemMessage">
                            {coerceAgentChatText(msg.content)}
                          </div>
                        ) : (
                          <>
                            {showSenderLabel && msg.role === "assistant" && msg.directorId && (
                              <div className="agentChatMessageLabel">{DIRECTOR_NAMES[msg.directorId]}</div>
                            )}
                            <div
                              className={`agentConvoMessage agentConvoMessage-${msg.role}${selectedMessageId === msg.id ? " agentChatMessageSelected" : ""}${msg.status === "working" ? " agentConvoMessage--working" : ""}${msg.metadata?.type === "hard-memory-report" ? " agentConvoMessage--hard-memory-report" : ""}`}
                              style={msg.role === "assistant" && msg.directorId ? { background: DIRECTOR_COLORS[msg.directorId], color: "#fff" } : undefined}
                              onClick={() => handleMessageClick(msg)}
                            >
                              <div className="agentConvoContent">
                                {msg.status === "working" ? (
                                  <span className="agentChatTypingDots">
                                    <span className="agentChatDot" />
                                    <span className="agentChatDot" />
                                    <span className="agentChatDot" />
                                  </span>
                                ) : (
                                  renderPingAwareMessageContent(msg)
                                )}
                              </div>
                              <div className="agentChatMessageMetaRow">
                                <div className="agentChatMessageMetaActions">
                                  {msg.metadata?.type === "hard-memory-report" ? (() => {
                                    const stage = (msg.metadata as HardMemoryReportMetadata).reportStage ?? "hard";
                                    return (
                                      <button
                                        type="button"
                                        className={`agentChatViewMoreButton ${stage === "soft" ? "agentChatViewMoreButton--soft-report" : "agentChatViewMoreButton--hard-report"}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setActivePanel({ type: "hard-memory-report", messageId: msg.id });
                                        }}
                                      >
                                        {stage === "soft" ? "View Soft Report" : "View Hard Report"}
                                      </button>
                                    );
                                  })() : null}
                                  {msg.metadata?.type === "research-result" && (
                                    <button
                                      className="agentChatViewMoreButton"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActivePanel({ type: "research", message: msg });
                                      }}
                                    >
                                      View Research
                                    </button>
                                  )}
                                  {msg.metadata?.type === "refresh-update" && (
                                    <button
                                      className="agentChatViewMoreButton"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActivePanel({ type: "update", message: msg });
                                      }}
                                    >
                                      View Update
                                    </button>
                                  )}
                                  {msg.metadata?.type === "ping-task" && (
                                    <button
                                      className="agentChatViewMoreButton"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActivePanel({ type: "ping-task", message: msg });
                                      }}
                                    >
                                      View Priority Update
                                    </button>
                                  )}
                                  {msg.metadata?.type === "ping-plan-summary" && (
                                    <button
                                      className="agentChatViewMoreButton"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActivePanel({ type: "ping-plan", message: msg });
                                      }}
                                    >
                                      View Update Plan
                                    </button>
                                  )}
                                  {msg.metadata?.type === "ping-update-report" && (
                                    <button
                                      className="agentChatViewMoreButton"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActivePanel({ type: "ping-update-report", message: msg });
                                      }}
                                    >
                                      View Update Report
                                    </button>
                                  )}
                                  {msg.metadata?.type === "execution-report" && (
                                    <button
                                      className="agentChatViewMoreButton"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActivePanel({ type: "execution-report", message: msg });
                                      }}
                                    >
                                      View Project Status Report
                                    </button>
                                  )}
                                </div>
                                {msg.status !== "working" ? (
                                  <div className="agentChatMessageTimestamp">
                                    {formatAgentChatTimestamp(msg.createdAt)}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    ))}

                  </div>

                </div>

                <div className="agentChatComposerFooter">
                  <div className="composerShell agentChatComposerShellCompact">
                    <textarea
                      ref={composerInputRef}
                      className="composerInput agentChatComposerInputCompact"
                      placeholder={alertedDirectorId ? `Replying to ${DIRECTOR_NAMES[alertedDirectorId]}...` : "Message the team..."}
                      value={messageValue}
                      onChange={(e) => setMessageValue(e.target.value)}
                      disabled={isLoading}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void handleSend();
                        }
                      }}
                    />
                    <ComposerControlBar
                      options={agentChatRuntimeOptions}
                      modelCatalog={modelCatalog}
                      hideAddFilesButton
                      hideModelMenu
                      hideThinkingMenu
                      hidePlanningMenu
                      hideSpeedMenu
                      addFilesBusy={false}
                      sendBusy={isLoading || !messageValue.trim()}
                      isRunning={isLoading}
                      onCodexModelChange={() => {}}
                      onClaudeModelChange={() => {}}
                      onReasoningChange={() => {}}
                      onSpeedChange={() => {}}
                      onPlanningModeChange={() => {}}
                      onAddFiles={() => {}}
                      onSubmit={() => void handleSend()}
                      onStop={() => {
                        if (!agentSelectedProjectId) return;
                        // Clear the jeff live-presence window so the typing bubble can go away immediately.
                        setJeffLivePresenceByProject((prev) => {
                          if (!(agentSelectedProjectId in prev)) return prev;
                          const next = { ...prev };
                          delete next[agentSelectedProjectId];
                          return next;
                        });
                        setIsLoading(false);
                        void (async () => {
                          try {
                            const updated = await window.programs.stopWorkingAgentMessages(agentSelectedProjectId);
                            if (updated) onSessionUpdate(updated);
                          } catch (error) {
                            pushToast(error instanceof Error ? error.message : "Failed to stop the current response.", "error");
                          }
                        })();
                      }}
                      submitLabel="Send"
                    />
                  </div>
                </div>
              </div>

              {hardMemoryReport ? (
                <HardMemoryReportPanel
                  report={hardMemoryReport}
                  liveApproval={hardMemoryReportApproval}
                  session={agentSession}
                  projectId={agentSelectedProjectId}
                  onSessionUpdate={onSessionUpdate}
                  onClose={closePanel}
                  pushToast={pushToast}
                />
              ) : null}

              {activePanel.type === "research" && activePanel.message.metadata?.type === "research-result" && (
                <div className="agentChatPanel">
                  <div className="agentChatPanelHeader">
                    <h3>Research by Todd</h3>
                    <button className="secondaryButton" style={{ fontSize: '0.75rem', padding: '4px 8px' }} onClick={closePanel}>Close</button>
                  </div>
                  <div className="agentChatPanelBody">
                    <section>
                      <h4>Research Prompt</h4>
                      <p>{activePanel.message.metadata.researchPrompt}</p>
                    </section>
                    <section>
                      <h4>General Findings</h4>
                      <AgentChatMarkdown text={activePanel.message.metadata.generalSummary} />
                    </section>
                    <section>
                      <h4>Project-Specific Findings</h4>
                      <AgentChatMarkdown text={activePanel.message.metadata.projectSummary} />
                    </section>
                  </div>
                </div>
              )}

              {activePanel.type === "update" && activePanel.message.metadata?.type === "refresh-update" && (
                <div className="agentChatPanel">
                  <div className="agentChatPanelHeader">
                    <h3>Update by {DIRECTOR_NAMES[activePanel.message.metadata.directorId]}</h3>
                    <button className="secondaryButton" style={{ fontSize: '0.75rem', padding: '4px 8px' }} onClick={closePanel}>Close</button>
                  </div>
                  <div className="agentChatPanelBody">
                    <section>
                      <h4>Summary</h4>
                      <AgentChatMarkdown text={activePanel.message.metadata.summary} />
                    </section>
                    {activePanel.message.metadata.same.length > 0 && (
                      <section>
                        <h4>Same (Matched Prior Understanding)</h4>
                        <ul className="agentChatUpdateList">
                          {activePanel.message.metadata.same.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </section>
                    )}
                    {activePanel.message.metadata.updated.length > 0 && (
                      <section>
                        <h4>Updated (New / Changed / Removed)</h4>
                        <ul className="agentChatUpdateList">
                          {activePanel.message.metadata.updated.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </section>
                    )}
                  </div>
                </div>
              )}

              {activePanel.type === "ping-task" && activePanel.message.metadata?.type === "ping-task" ? (
                <PingTaskPanel
                  task={activePanel.message.metadata.task}
                  onClose={closePanel}
                />
              ) : null}

              {activePanel.type === "ping-plan" && activePanel.message.metadata?.type === "ping-plan-summary" ? (
                <PingPlanPanel
                  plan={activePanel.message.metadata.plan ?? null}
                  summary={activePanel.message.metadata.summary}
                  onClose={closePanel}
                />
              ) : null}

              {activePanel.type === "ping-update-report" && activePanel.message.metadata?.type === "ping-update-report" ? (
                <PingUpdateReportPanel
                  report={activePanel.message.metadata.report ?? null}
                  fallbackRawReport={activePanel.message.metadata.rawReport}
                  onClose={closePanel}
                />
              ) : null}

              {activePanel.type === "execution-report" && activePanel.message.metadata?.type === "execution-report" ? (
                <ErrorBoundaryPanel onClose={closePanel}>
                  <ExecutionReportPanel
                    report={activePanel.message.metadata.report}
                    projectId={agentSelectedProjectId}
                    session={agentSession}
                    onSessionUpdate={onSessionUpdate}
                    pushToast={pushToast}
                    onClose={closePanel}
                  />
                </ErrorBoundaryPanel>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <div className="placeholderPanel" style={{ marginTop: 48 }}>
          <h4>Agent Chat</h4>
          <p>Select a project above to open the team channel.</p>
        </div>
      )}

      {showProjectDetails && selectedProject ? (
        <AgentProjectDetailsModal
          project={selectedProject}
          session={agentSession}
          settings={settings}
          modelCatalog={modelCatalog}
          onUpdateAgentDefaults={onUpdateAgentDefaults}
          onSessionUpdate={onSessionUpdate}
          pushToast={pushToast}
          initialView={projectDetailsInitialView}
          onClose={() => {
            setShowProjectDetails(false);
            setProjectDetailsInitialView(undefined);
          }}
        />
      ) : null}

      {pendingAgentAlert ? (
        <Modal
          title="Proceed With Agent Action?"
          onClose={() => setPendingAgentAlert(null)}
          compact
        >
          <p className="modalLead">
            {`Are you sure you want to run ${DIRECTOR_NAMES[pendingAgentAlert.directorId]} before ${DIRECTOR_NAMES[pendingAgentAlert.warningTargetDirectorId]}?`}
          </p>
          <div className="modalActions">
            <button
              type="button"
              className="secondaryButton"
              onClick={() => setPendingAgentAlert(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primaryButton"
              onClick={() => {
                const directorId = pendingAgentAlert.directorId;
                setPendingAgentAlert(null);
                void runDirectorAlertAction(directorId);
              }}
            >
              Proceed
            </button>
          </div>
        </Modal>
      ) : null}

      {showDirectorProfile !== null && (
        <Modal
          title=""
          headerLeading={
            <button
              type="button"
              className="textButton"
              onClick={() => {
                setProjectDetailsInitialView({ type: "agents" });
                setShowProjectDetails(true);
                setShowDirectorProfile(null);
              }}
            >
              View Agent Team
            </button>
          }
          onClose={() => setShowDirectorProfile(null)}
          fullscreen
        >
          <DirectorProfilePanel
            key={showDirectorProfile}
            directorId={showDirectorProfile}
            session={agentSession}
            projectId={agentSelectedProjectId}
            settings={settings}
            modelCatalog={modelCatalog}
            onNavigateToDirector={setShowDirectorProfile}
            onUpdateAgentDefaults={onUpdateAgentDefaults}
            onSessionUpdate={onSessionUpdate}
            pushToast={pushToast}
          />
        </Modal>
      )}
    </section>
  );
}

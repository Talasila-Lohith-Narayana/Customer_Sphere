import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  MessageSquare,
  MessageSquarePlus,
  Pencil,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Page } from "../components/States";
import { assistantService } from "../services/api";

const suggestedQuestions = [
  "Which campaigns target the most customers?",
  "How has monthly revenue changed?",
  "Which product categories have the highest sales?",
  "How many customers are in each churn-risk group?",
  "Which customer segments are largest?",
];

const formatValue = (value, format) => {
  if (format === "currency") {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 0,
    }).format(value);
  }
  return new Intl.NumberFormat().format(value);
};

export default function Assistant() {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState("");
  const [question, setQuestion] = useState("");
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [turns, setTurns] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionAction, setSessionAction] = useState(false);
  const [renamingSessionId, setRenamingSessionId] = useState(null);
  const [sessionTitleDraft, setSessionTitleDraft] = useState("");
  const conversationRef = useRef(null);
  const sessionIdRef = useRef(null);

  const loadStatus = useCallback(async () => {
    setStatusError("");
    try {
      setStatus(await assistantService.status());
    } catch (requestError) {
      setStatusError(requestError.message || "Unable to check Nova status.");
    }
  }, []);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    setHistoryError("");
    try {
      const result = await assistantService.sessions();
      let availableSessions = result.sessions || [];
      if (availableSessions.length === 0) {
        const createdSession = await assistantService.createSession();
        availableSessions = [createdSession];
      }
      setSessions(availableSessions);
      const selected = availableSessions[0];
      sessionIdRef.current = selected.id;
      setSessionId(selected.id);
    } catch (requestError) {
      setHistoryError(requestError.message || "Unable to load conversations.");
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    void loadSessions();
  }, [loadSessions, loadStatus]);

  const loadHistory = useCallback(async (selectedSessionId) => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const history = await assistantService.history(selectedSessionId);
      if (sessionIdRef.current === selectedSessionId) {
        setTurns(history.turns || []);
      }
    } catch (requestError) {
      if (sessionIdRef.current === selectedSessionId) {
        setHistoryError(requestError.message || "Unable to load this conversation.");
      }
    } finally {
      if (sessionIdRef.current === selectedSessionId) {
        setHistoryLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (sessionId !== null) void loadHistory(sessionId);
  }, [loadHistory, sessionId]);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (conversation) {
      conversation.scrollTop = conversation.scrollHeight;
    }
  }, [historyLoading, loading, turns]);

  const startNewChat = async () => {
    setSessionAction(true);
    setHistoryError("");
    try {
      const createdSession = await assistantService.createSession();
      setSessions((previous) => [createdSession, ...previous]);
      sessionIdRef.current = createdSession.id;
      setSessionId(createdSession.id);
      setTurns([]);
      setQuestion("");
      setError("");
    } catch (requestError) {
      setHistoryError(requestError.message || "Unable to start a new conversation.");
    } finally {
      setSessionAction(false);
    }
  };

  const selectSession = (selectedSessionId) => {
    if (selectedSessionId === sessionIdRef.current) return;
    sessionIdRef.current = selectedSessionId;
    setSessionId(selectedSessionId);
    setTurns([]);
    setQuestion("");
    setError("");
    setHistoryError("");
  };

  const beginRenameSession = (session) => {
    setRenamingSessionId(session.id);
    setSessionTitleDraft(session.title);
    setHistoryError("");
  };

  const cancelRenameSession = () => {
    setRenamingSessionId(null);
    setSessionTitleDraft("");
  };

  const renameSession = async (event, sessionIdToRename) => {
    event.preventDefault();
    const title = sessionTitleDraft.trim();
    if (!title || title.length > 120 || sessionAction) return;

    setSessionAction(true);
    setHistoryError("");
    try {
      const updatedSession = await assistantService.renameSession(
        sessionIdToRename,
        title,
      );
      setSessions((previous) => previous
        .map((session) => (
          session.id === sessionIdToRename ? updatedSession : session
        ))
        .sort((left, right) => (
          new Date(right.updated_at) - new Date(left.updated_at)
        )));
      cancelRenameSession();
    } catch (requestError) {
      setHistoryError(requestError.message || "Unable to rename this conversation.");
    } finally {
      setSessionAction(false);
    }
  };

  const removeSession = async (removedSessionId) => {
    setSessionAction(true);
    setHistoryError("");
    try {
      await assistantService.deleteSession(removedSessionId);
      const remainingSessions = sessions.filter(({ id }) => id !== removedSessionId);
      if (removedSessionId === sessionIdRef.current) {
        let nextSession = remainingSessions[0];
        if (!nextSession) {
          nextSession = await assistantService.createSession();
          remainingSessions.unshift(nextSession);
        }
        sessionIdRef.current = nextSession.id;
        setSessionId(nextSession.id);
        setTurns([]);
        setQuestion("");
      }
      setSessions(remainingSessions);
    } catch (requestError) {
      setHistoryError(requestError.message || "Unable to delete this conversation.");
    } finally {
      setSessionAction(false);
    }
  };

  const askQuestion = async (event) => {
    event.preventDefault();
    const trimmedQuestion = question.trim();
    if (
      !trimmedQuestion
      || loading
      || sessionAction
      || sessionsLoading
      || historyLoading
      || historyError
      || sessionId === null
      || !status?.configured
    ) return;

    setLoading(true);
    setError("");
    try {
      const result = await assistantService.ask(trimmedQuestion, sessionId);
      setTurns((previousTurns) => [
        ...previousTurns,
        { question: trimmedQuestion, ...result },
      ]);
      setSessions((previousSessions) => previousSessions.map((session) => (
        session.id === sessionId && session.title === "New chat"
          ? {
            ...session,
            title: trimmedQuestion.length > 117
              ? `${trimmedQuestion.slice(0, 117).trimEnd()}...`
              : trimmedQuestion,
            updated_at: new Date().toISOString(),
          }
          : session
      )).sort((left, right) => (
        left.id === sessionId ? -1 : right.id === sessionId ? 1 : 0
      )));
      setQuestion("");
    } catch (requestError) {
      setError(requestError.message || "Unable to get an answer.");
    } finally {
      setLoading(false);
    }
  };

  const handleQuestionKeyDown = (event) => {
    if (
      event.key === "Enter"
      && !event.shiftKey
      && !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <Page>
      <header className="assistantHeader">
        <div>
          <h1>Nova</h1>
        </div>
        <span className="assistantModel">
          <Sparkles size={15} />
          {status?.model || "Nova"}
        </span>
      </header>

      {(statusError || (status && !status.configured)) && (
        <div className={`assistantNotice${statusError ? " assistantNoticeError" : ""}`} role={statusError ? "alert" : "status"}>
          <span>
            {statusError || (
              <>Nova is unavailable. Configure <code>OPENROUTER_API_KEY</code> on the backend.</>
            )}
          </span>
          {statusError && (
            <button type="button" className="btn ghost" onClick={() => void loadStatus()}>
              Retry
            </button>
          )}
        </div>
      )}

      {historyError && (
        <div className="assistantNotice assistantNoticeError" role="alert">
          <span>{historyError}</span>
          {sessionId !== null && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => void loadHistory(sessionId)}
            >
              Retry
            </button>
          )}
        </div>
      )}

      <section className="assistantWorkspace" aria-label="Nova workspace">
        <aside className="assistantSidebar" aria-label="Your conversations">
          <button
            type="button"
            className="assistantNewChat"
            onClick={() => void startNewChat()}
            disabled={sessionAction || sessionsLoading}
          >
            <MessageSquarePlus size={17} />
            New chat
          </button>
          <h2>Recent</h2>
          <div className="assistantSessionList">
            {sessions.map((session) => (
              <div
                className={`assistantSession${session.id === sessionId ? " isActive" : ""}`}
                key={session.id}
              >
                {renamingSessionId === session.id ? (
                  <form
                    className="assistantSessionRenameForm"
                    onSubmit={(event) => void renameSession(event, session.id)}
                  >
                    <input
                      aria-label="Conversation name"
                      autoFocus
                      maxLength={120}
                      value={sessionTitleDraft}
                      onChange={(event) => setSessionTitleDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") cancelRenameSession();
                      }}
                      disabled={sessionAction}
                    />
                    <button
                      type="submit"
                      className="assistantSessionAction"
                      aria-label="Save conversation name"
                      disabled={sessionAction || !sessionTitleDraft.trim()}
                    >
                      <Check size={15} />
                    </button>
                    <button
                      type="button"
                      className="assistantSessionAction"
                      aria-label="Cancel renaming"
                      onClick={cancelRenameSession}
                      disabled={sessionAction}
                    >
                      <X size={15} />
                    </button>
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      className="assistantSessionSelect"
                      aria-current={session.id === sessionId ? "page" : undefined}
                      onClick={() => selectSession(session.id)}
                      disabled={sessionAction || loading}
                      title={session.title}
                    >
                      <MessageSquare size={15} />
                      <span>{session.title}</span>
                    </button>
                    <button
                      type="button"
                      className="assistantSessionRename"
                      aria-label={`Rename ${session.title}`}
                      onClick={() => beginRenameSession(session)}
                      disabled={sessionAction || loading}
                    >
                      <Pencil size={14} />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="assistantSessionDelete"
                  aria-label={`Delete ${session.title}`}
                  onClick={() => void removeSession(session.id)}
                  disabled={sessionAction || loading}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            {sessionsLoading && <p className="assistantSidebarHint">Loading chats…</p>}
            {!sessionsLoading && sessions.length === 0 && (
              <p className="assistantSidebarHint">No conversations yet</p>
            )}
          </div>
        </aside>

        <div className="assistantChatPanel" role="region" aria-label="Current conversation">
          {turns.length === 0 && !loading && !historyLoading && !error ? (
            <div className="assistantEmptyState">
              <span className="assistantEmptyIcon"><Bot size={25} /></span>
              <h2>What can I help with?</h2>
              <div className="assistantSuggestions" aria-label="Suggested questions">
                {suggestedQuestions.map((suggestion) => (
                  <button
                    type="button"
                    key={suggestion}
                    className="assistantSuggestion"
                    disabled={!status?.configured || sessionAction}
                    onClick={() => setQuestion(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div
              className="assistantResponse"
              aria-label="Conversation messages"
              aria-live="polite"
              ref={conversationRef}
              tabIndex={0}
            >
              {historyLoading && <p className="assistantThinking">Loading conversation…</p>}
              {turns.map((turn, index) => (
                <article className="assistantTurn" key={`${index}-${turn.question}`}>
                  <div className="assistantMessage assistantMessageUser">
                    <strong>You</strong>
                    <p>{turn.question}</p>
                  </div>
                  <div className="assistantMessage assistantMessageAssistant">
                    <strong><Bot size={15} /> Nova</strong>
                    <p>{turn.answer}</p>
                  </div>
                  {turn.visualizations?.map((visualization) => (
                    <section
                      className="assistantVisualization"
                      key={visualization.title}
                      aria-label={visualization.title}
                    >
                      <h3>{visualization.title}</h3>
                      <div className="assistantChart">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={visualization.data}
                            margin={{ top: 8, right: 12, left: 8, bottom: 42 }}
                          >
                            <CartesianGrid
                              stroke="var(--assistant-grid)"
                              strokeDasharray="3 3"
                              vertical={false}
                            />
                            <XAxis
                              dataKey="label"
                              angle={-25}
                              textAnchor="end"
                              interval={0}
                              height={58}
                              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                            />
                            <YAxis
                              tickFormatter={(value) => formatValue(value, visualization.format)}
                              width={72}
                              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                            />
                            <Tooltip
                              formatter={(value) => formatValue(value, visualization.format)}
                              contentStyle={{
                                background: "var(--card-bg)",
                                borderColor: "var(--card-border)",
                                borderRadius: 10,
                                color: "var(--text-main)",
                              }}
                              labelStyle={{ color: "var(--text-main)" }}
                              itemStyle={{ color: "var(--assistant-accent)" }}
                            />
                            <Bar
                              dataKey="value"
                              fill="var(--assistant-accent)"
                              radius={[5, 5, 0, 0]}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </section>
                  ))}
                </article>
              ))}
              {loading && <p className="assistantThinking">Thinking…</p>}
              {error && <p className="assistantAnswerError" role="alert">{error}</p>}
            </div>
          )}

          <form className="assistantForm" onSubmit={askQuestion}>
            <label className="visuallyHidden" htmlFor="assistant-question">Message</label>
            <textarea
              id="assistant-question"
              value={question}
              maxLength={1000}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={handleQuestionKeyDown}
              placeholder="Message Nova"
              rows={2}
              disabled={!status?.configured || loading || sessionsLoading || sessionAction}
            />
            <div className="assistantFormFooter">
              <span>{question.length}/1000</span>
              <button
                type="submit"
                className="btn primary"
                disabled={
                  !status?.configured
                  || loading
                  || sessionAction
                  || sessionsLoading
                  || historyLoading
                  || Boolean(historyError)
                  || sessionId === null
                  || !question.trim()
                }
                aria-label="Send message"
              >
                <Send size={16} />
              </button>
            </div>
          </form>
        </div>
      </section>
    </Page>
  );
}

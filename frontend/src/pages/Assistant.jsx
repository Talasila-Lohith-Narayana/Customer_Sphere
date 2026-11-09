import React, { useCallback, useEffect, useState } from "react";
import { Bot, Send, Sparkles } from "lucide-react";
import { Page } from "../components/States";
import { assistantService } from "../services/api";

const suggestedQuestions = [
  "Which campaigns target the most customers?",
  "How are campaigns distributed across segments?",
  "What can you tell me about our current campaign mix?",
];

export default function Assistant() {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const loadStatus = useCallback(async () => {
    setStatusError("");
    try {
      setStatus(await assistantService.status());
    } catch (requestError) {
      setStatusError(requestError.message || "Unable to check assistant status.");
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const askQuestion = async (event) => {
    event.preventDefault();
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || loading || !status?.configured) return;

    setLoading(true);
    setError("");
    setAnswer("");
    try {
      const result = await assistantService.ask(trimmedQuestion);
      setAnswer(result.answer);
    } catch (requestError) {
      setError(requestError.message || "Unable to get an answer.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Page>
      <header className="assistantHeader">
        <div>
          <p className="eyebrow">CUSTOMER SPHERE</p>
          <h1>Analytics assistant</h1>
          <p>Ask questions about campaign and customer-segment aggregates.</p>
        </div>
        <span className="assistantModel">
          <Sparkles size={15} />
          {status?.model || "AI assistant"}
        </span>
      </header>

      <section className="assistantCard" aria-label="Analytics assistant">
        <div className="assistantIntro">
          <span className="assistantIcon"><Bot size={22} /></span>
          <div>
            <h2>Explore your campaign data</h2>
            <p>
              Answers are based on aggregate campaign counts and segment labels.
              Individual customer records are not sent to the model.
            </p>
          </div>
        </div>

        {statusError && (
          <div className="assistantNotice assistantNoticeError" role="alert">
            <span>{statusError}</span>
            <button type="button" className="btn ghost" onClick={() => void loadStatus()}>
              Retry
            </button>
          </div>
        )}

        {status && !status.configured && (
          <div className="assistantNotice" role="status">
            The assistant is not configured yet. Add <code>OPENAI_API_KEY</code> to
            the backend environment and restart the API.
          </div>
        )}

        <div className="assistantSuggestions" aria-label="Suggested questions">
          {suggestedQuestions.map((suggestion) => (
            <button
              type="button"
              key={suggestion}
              className="assistantSuggestion"
              disabled={!status?.configured || loading}
              onClick={() => setQuestion(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>

        {(answer || loading || error) && (
          <div className="assistantResponse" aria-live="polite">
            {loading ? (
              <p>Reviewing the available aggregate data…</p>
            ) : error ? (
              <p className="assistantAnswerError" role="alert">{error}</p>
            ) : (
              <>
                <strong>Answer</strong>
                <p>{answer}</p>
              </>
            )}
          </div>
        )}

        <form className="assistantForm" onSubmit={askQuestion}>
          <label className="visuallyHidden" htmlFor="assistant-question">Your question</label>
          <textarea
            id="assistant-question"
            value={question}
            maxLength={1000}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask about campaigns or customer segments…"
            rows={3}
            disabled={!status?.configured || loading}
          />
          <div className="assistantFormFooter">
            <span>{question.length}/1000</span>
            <button
              type="submit"
              className="btn primary"
              disabled={!status?.configured || loading || !question.trim()}
            >
              <Send size={15} />
              {loading ? "Thinking…" : "Ask"}
            </button>
          </div>
        </form>
      </section>
    </Page>
  );
}

import React, { useCallback, useEffect, useState } from "react";
import { Bot, Send, Sparkles } from "lucide-react";
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
      setAnswer(result);
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
          <p className="eyebrow">CUSTOMER SPHERE</p>
          <h1>Analytics assistant</h1>
          <p>Explore sales, products, customer segments, churn, and campaigns.</p>
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
            <h2>Explore your business data</h2>
            <p>
              Ask about sales trends, products, customer segments, churn, and
              campaigns. Answers and charts use aggregated data only; individual
              customer records are not sent to the model.
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
            The assistant is not configured yet. Add <code>OPENROUTER_API_KEY</code> to
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
              <p>Thinking through your question…</p>
            ) : error ? (
              <p className="assistantAnswerError" role="alert">{error}</p>
            ) : (
              <>
                <strong>Answer</strong>
                <p>{answer.answer}</p>
                {answer.visualizations?.map((visualization) => (
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
            onKeyDown={handleQuestionKeyDown}
            placeholder="Ask about sales, products, churn, segments, or campaigns…"
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

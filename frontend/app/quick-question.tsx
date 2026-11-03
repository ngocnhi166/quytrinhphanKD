"use client";
import { useState } from "react";
import { Job, send } from "./lib";

export default function QuickQuestion({ taskId, ready, onCreated }: { taskId: string; ready: boolean; onCreated: (id: string) => void }) {
  const [question, setQuestion] = useState("Thủ đô của Việt Nam là gì?");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function ask() {
    setBusy(true); setError("");
    try { onCreated((await send<Job>("/search", "POST", { prompt: question, task_id: taskId })).id); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="card input-card">
    <div className="card-heading"><span className="step">01</span><div><h2>Hỏi nhanh</h2></div></div>
    <label className="field-label" htmlFor="quick-question">Câu hỏi của bạn</label>
    <textarea id="quick-question" value={question} onChange={e => setQuestion(e.target.value)} maxLength={4000}/>
    {error && <p className="alert error" role="alert">{error}</p>}
    <div className="input-footer"><button className="primary" onClick={ask} disabled={!ready || busy || !question.trim()}>{busy ? "Đang gửi…" : "Gửi câu hỏi →"}</button></div>
  </section>;
}

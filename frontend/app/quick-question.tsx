"use client";
import { useState } from "react";

export default function QuickQuestion({ connected, onCreated }: { connected: boolean; onCreated: (id: string) => void }) {
  const [question, setQuestion] = useState("Thủ đô của Việt Nam là gì?");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: question }) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Không gửi được câu hỏi.");
      onCreated(data.id);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="card input-card">
    <div className="card-heading"><span className="step">01</span><div><h2>Hỏi nhanh</h2><p>Nhập câu hỏi → gửi ChatGPT → nhận câu trả lời</p></div></div>
    <label className="field-label" htmlFor="quick-question">Câu hỏi của bạn</label>
    <textarea id="quick-question" value={question} onChange={e => setQuestion(e.target.value)} maxLength={4000}/>
    <p className="fine-print">Chỉ gửi câu hỏi đơn giản. Không cần tải tệp hoặc phân tích dữ liệu.</p>
    {error && <p className="alert error" role="alert">{error}</p>}
    <div className="input-footer"><button className="primary" onClick={send} disabled={!connected || busy || !question.trim()}>{busy ? "Đang gửi…" : "Gửi câu hỏi →"}</button></div>
    {!connected && <p className="fine-print">Kết nối extension trước khi gửi câu hỏi.</p>}
  </section>;
}

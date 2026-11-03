"use client";

import { useCallback, useRef, useState } from "react";
import ReportView from "./report-view";
import { api, Job, jobLabels, send, Task, taskLabels, taskTone, usePolling, when } from "./lib";

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    edit: <><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/></>,
    unlock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0M12 14v3"/></>,
    key: <><circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-4-4 3-3m-6 0 3-3"/></>,
    trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></>,
    checklist: <path d="m3 7 2 2 4-5m3 3h9M3 16l2 2 4-5m3 3h9"/>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/></>,
    file: <><path d="M14 2H5v20h14V7zM14 2v6h5M8 12h8M8 16h8"/></>,
    history: <><path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2"/></>,
    link: <><path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 2 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"/></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
    back: <path d="M20 12H4m6-6-6 6 6 6"/>,
    spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/><path d="m20 2 .5 1.5L22 4l-1.5.5L20 6l-.5-1.5L18 4l1.5-.5z"/></>,
    users: <><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/></>,
    shield: <><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/></>,
    logout: <><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.file}</svg>;
}

export function Alert({ text, error, onClose }: { text: string; error?: boolean; onClose: () => void }) {
  if (!text) return null;
  return <div className={error ? "alert error" : "alert"} role={error ? "alert" : "status"}>{text}<button onClick={onClose} aria-label="Đóng thông báo">×</button></div>;
}

export function TaskStatus({ status }: { status: string }) {
  return <span className={`status ${taskTone[status] || ""}`}>{taskLabels[status] || status}</span>;
}

import { OPEN } from "./lib";

export function TaskList({ tasks, empty, onOpen, onDelete, deleting }: { tasks: Task[] | null; empty: string; onOpen: (task: Task) => void; onDelete?: (task: Task) => void; deleting?: string | null }) {
  if (!tasks) return <div className="history-empty">Đang tải tác vụ…</div>;
  if (!tasks.length) return <div className="history-empty">{empty}</div>;
  return <>{tasks.map(task => (
    <div className="task-list-entry" key={task.id}>
      <button className="history-row" onClick={() => onOpen(task)}>
        <span className="stat-icon"><Icon name="grid"/></span>
        <div><strong>{task.title}</strong><p>{task.assignee} · {task.department}</p></div>
        <time>{when(task.updated)}</time><TaskStatus status={task.status}/>
        {!onDelete && <Icon name="arrow"/>}
      </button>
      {onDelete && <details className="department-menu work-menu task-actions"
        onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false; }}
        onKeyDown={e => { if (e.key === "Escape") { e.currentTarget.open = false; e.currentTarget.querySelector("summary")?.focus(); } }}>
        <summary aria-label={`Tùy chọn tác vụ ${task.title}`} title="Tùy chọn tác vụ">⋮</summary>
        <div className="department-menu-panel">
          <button onClick={() => onOpen(task)}>Mở tác vụ</button>
          {OPEN.includes(task.status) && <button className="department-menu-delete" disabled={Boolean(deleting)}
            onClick={e => { e.currentTarget.closest("details")!.open = false; onDelete(task); }}>Xóa tác vụ</button>}
        </div>
      </details>}
    </div>
  ))}</>;
}

export function TaskBrief({ task }: { task: Task }) {
  return <section className="card task-brief">
    <div className="result-meta"><div><h2>{task.title}</h2><p className="fine-print">Thực hiện: {task.assignee} · {task.department}{task.submitted ? ` · Gửi duyệt lúc ${when(task.submitted)}` : ""}</p></div><TaskStatus status={task.status}/></div>
    <div className="brief-grid"><div><span className="field-label">Mục tiêu</span><p>{task.objective}</p></div><div><span className="field-label">Yêu cầu phân tích</span><p>{task.requirements}</p></div></div>
    {/* The revision note stays visible after a rerun moves the task back to in progress. */}
    {task.reviewed && (task.status === "approved" || task.review_note) && <p className={task.status === "needs_revision" ? "result-error" : "setup-tip"}><b>{task.status === "approved" ? `Kết quả phê duyệt: ${taskLabels.approved}` : "Nhận xét của trưởng phòng"}</b> — ghi nhận bởi {task.reviewer} lúc {when(task.reviewed)}.{task.review_note ? <><br/>{task.review_note}</> : null}</p>}
  </section>;
}

export function JobList({ jobs, selected, onSelect, showOwner, onRemove }: { onRemove?: (job: Job) => void; jobs: Job[] | null; selected?: string; onSelect: (id: string) => void; showOwner?: boolean }) {
  if (!jobs) return <div className="history-empty">Đang tải lịch sử…</div>;
  if (!jobs.length) return <div className="history-empty">Chưa có lượt chạy AI nào.</div>;
  return <>{jobs.map(job => <div className="task-list-entry" key={job.id}><button className={`history-row ${job.id === selected ? "selected" : ""}`} onClick={() => onSelect(job.id)}><span className="stat-icon"><Icon name="file"/></span><div><strong>{job.filename} · {job.task_title || "Không gắn tác vụ"}</strong><p>{showOwner && job.owner ? `${job.owner}: ` : ""}{job.prompt}</p></div><time>{when(job.created)}</time><span className={`status ${job.status}`}>{jobLabels[job.status]}</span>{!onRemove && <Icon name="arrow"/>}</button>
    {onRemove && <details className="department-menu work-menu task-actions"
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false; }}
      onKeyDown={e => { if (e.key === "Escape") { e.currentTarget.open = false; e.currentTarget.querySelector("summary")?.focus(); } }}>
      <summary aria-label={`Tùy chọn lượt phân tích ${job.filename}`}>⋮</summary>
      <div className="department-menu-panel"><button onClick={() => onSelect(job.id)}>Xem kết quả</button>
        <button className="department-menu-delete" onClick={e => { e.currentTarget.closest("details")!.open = false; onRemove(job); }}>Xóa khỏi lịch sử</button></div>
    </details>}</div>)}</>;
}

// What a run was given: who ran it, for which task, on which data, with which question.
function RunFacts({ job, pending }: { job: Job; pending: boolean }) {
  const quick = job.summary.mode === "simple";
  const origin = job.source === "dataset" ? " · dữ liệu mẫu của tác vụ" : job.source === "upload" ? " · tệp tự tải lên" : "";
  const data = job.summary.columns.length ? `${job.filename} · ${job.summary.row_count.toLocaleString("vi-VN")} dòng · ${job.summary.columns.length} cột${origin}` : "Không dùng tệp dữ liệu";
  return <div className="run-facts">
    <dl>
      <div><dt>Người chạy</dt><dd>{job.owner || "—"}</dd></div>
      <div><dt>Hình thức</dt><dd>{quick ? "Hỏi nhanh" : "Phân tích dữ liệu"}</dd></div>
      <div><dt>Dữ liệu</dt><dd>{data}</dd></div>
      <div><dt>Thời gian</dt><dd>{when(job.created)}{pending ? "" : ` → ${when(job.updated)}`}</dd></div>
    </dl>
    <span className="field-label">Câu hỏi đã gửi</span>
    <pre className="run-prompt">{job.prompt}</pre>
  </div>;
}

const escapeHtml = (value: string) => value.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

// One AI run with its report. Polls only while ChatGPT is still answering.
// The assignee may edit a finished run in place before submit; the AI's original stays viewable next to the edited version.
export function JobView({ id, onUse, editable, reportOnly = false }: { reportOnly?: boolean; id: string; onUse?: () => void; editable?: boolean }) {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
  const [original, setOriginal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const load = useCallback(async () => {
    try { setJob(await api<Job>(`/jobs/${id}`)); setError(""); }
    catch (e) { setError((e as Error).message); }
  }, [id]);
  const pending = !job || ["queued", "running"].includes(job.status);
  usePolling(load, pending ? 2500 : 0);
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setNotice("Đã sao chép."); }
    catch { setError("Không sao chép được. Hãy chọn và sao chép nội dung thủ công."); }
  }
  async function downloadPdf(format: "pdf" | "word" = "pdf") {
    setExporting(true); setError("");
    try {
      const response = await fetch(`/api/jobs/${id}/${format}?original=${original}`, { cache: "no-store" });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.detail || "Không tạo được file báo cáo.");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `phan-tich-${id.slice(0, 8)}.${format === "word" ? "docx" : "pdf"}`; anchor.click(); URL.revokeObjectURL(url);
    } catch (e) { setError((e as Error).message); }
    finally { setExporting(false); }
  }
  async function saveEdit() {
    const body = frame.current?.contentDocument?.body;
    if (!body) return;
    setSaving(true); setError("");
    try {
      await send(`/jobs/${id}`, "PATCH", { result: body.innerText.trim(), html: body.innerHTML });
      await load(); setEditing(false); setOriginal(false);
      setNotice("Đã lưu chỉnh sửa vào kết quả lượt chạy này. Bản AI gốc vẫn được giữ.");
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }
  if (!job) return <div className="processing">{error ? <p className="result-error">{error}</p> : <span className="spinner"/>}</div>;
  const text = job.edited_result ?? job.result ?? "";
  const done = job.status === "succeeded";
  const editedReport = job.edited_html ?? (job.edited_result ? `<pre>${escapeHtml(job.edited_result)}</pre>` : null);
  const originalReport = job.result_html ?? `<pre>${escapeHtml(job.result ?? "")}</pre>`;
  return <div className="result-content">
    {!reportOnly && <><div className="result-meta"><strong>{job.task_title ? `Tác vụ “${job.task_title}”` : "Lượt chạy không gắn tác vụ"}</strong><span className={`status ${job.status}`}>{jobLabels[job.status]}</span></div>
    <RunFacts job={job} pending={pending}/></>}
    <Alert text={error} error onClose={() => setError("")}/>
    <Alert text={notice} onClose={() => setNotice("")}/>
    {/* A half-written answer is never shown as a report; it appears once ChatGPT has finished. */}
    {pending ? <div className="processing" role="status"><span className="spinner"/><h3>{job.status === "queued" ? "Đang chờ đến lượt…" : "ChatGPT đang trả lời…"}</h3><p>{job.result ? `Đã nhận khoảng ${job.result.length.toLocaleString("vi-VN")} ký tự. Báo cáo sẽ hiện đầy đủ khi ChatGPT trả lời xong.` : "Tab tự mở trong trình duyệt có extension. Kết quả sẽ xuất hiện tại đây khi hoàn tất và tab sẽ đóng sau khi lưu."}</p></div>
      : job.result ? <>
      {!editing && <div className="result-actions">
        <button className="secondary" onClick={() => copy(text)}>Sao chép</button>
        {job.source === "attachment" && <a className="secondary" href={`/api/jobs/${id}/attachment`}>Tải file gốc ↓</a>}
        {done && job.source !== "attachment" && <button className="secondary" onClick={() => downloadPdf("word")} disabled={exporting}>Tải Word ↓</button>}
        {done && job.source !== "attachment" && <button className="secondary" onClick={() => downloadPdf()} disabled={exporting}>{exporting ? "Đang tạo PDF…" : "Tải PDF ↓"}</button>}
        {editable && done && <button className="secondary" onClick={() => setEditing(true)}>Chỉnh sửa ✎</button>}
        {onUse && done && <button className="secondary" onClick={onUse}>Dùng làm kết quả tác vụ ↓</button>}
      </div>}
      {job.status === "failed" && <p className="fine-print" role="status">Lượt chạy bị gián đoạn. Nội dung dưới đây có thể chưa đầy đủ.</p>}
      {editing ? <div className="run-editor">
        <p className="edit-note">Bấm trực tiếp vào chữ hoặc ô trong bảng để sửa. Định dạng, bảng và biểu đồ được giữ nguyên.</p>
        <ReportView html={editedReport ?? originalReport} editable frameRef={frame}/>
        <div className="result-actions"><button className="primary" style={{ width: "auto" }} disabled={saving} onClick={saveEdit}>{saving ? "Đang lưu…" : "Xong · lưu chỉnh sửa"}</button><button className="secondary" disabled={saving} onClick={() => setEditing(false)}>Hủy</button></div>
      </div> : editedReport && !original ? <>
        <p className="edit-note">Đã chỉnh sửa lúc {when(job.edited!)} · <button className="link-button" onClick={() => setOriginal(true)}>Xem bản AI gốc</button></p>
        <ReportView html={editedReport}/>
      </> : <>
        {editedReport && <p className="edit-note">Bản AI gốc · <button className="link-button" onClick={() => setOriginal(false)}>Xem bản đã chỉnh sửa</button></p>}
        <ReportView html={originalReport}/>
      </>}
      {job.error && <p className="result-error">{job.error}</p>}
    </> : <div className="result-error">{job.error || "ChatGPT không trả về nội dung."}<p>Tab lỗi được giữ lại để kiểm tra. Tạo lượt mới sau khi khắc phục.</p></div>}
  </div>;
}

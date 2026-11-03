"use client";

import { useRef, useState } from "react";
import QuickQuestion from "./quick-question";
import { api, Dataset, Job, OPEN, send, Summary, Task, taskLabels, useApi, when } from "./lib";
import { Alert, Icon, JobView, TaskBrief } from "./ui";


// Choose the task's permitted data, ask ChatGPT and follow the run.
// Only the run in progress (or just started here) is shown; earlier runs live in the run history.
function AnalysisPanel({ taskId, datasets = [], ready, onStarted, onUse, onHistory, chosenRun }: { taskId: string; datasets?: Dataset[]; ready: boolean; onStarted: () => void; onUse?: (runId: string) => void; onHistory: () => void; chosenRun: string | null }) {
  const { data: jobs, reload: reloadJobs } = useApi<Job[]>(`/jobs?task=${taskId}`, 5000);
  const [mode, setMode] = useState<"data" | "quick">(datasets.length ? "data" : "quick");
  const [source, setSource] = useState(datasets[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<Summary | null>(null);
  const [prompt, setPrompt] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadVersion = useRef(0);
  const dataset = datasets.find(d => d.id === source);
  const preview = dataset ? { columns: dataset.columns, rows: dataset.preview } : upload ? { columns: upload.columns, rows: upload.preview } : null;
  const current = selected ?? jobs?.find(job => ["queued", "running"].includes(job.status))?.id;
  const started = (id: string) => { setSelected(id); reloadJobs(); onStarted(); };

  async function chooseFile(next: File | undefined) {
    if (!next) return;
    const version = ++uploadVersion.current;
    setPreviewing(false); setError(""); setUpload(null); setFile(null); setSource("");
    if (!/\.(csv|xlsx)$/i.test(next.name)) { setError("Chọn tệp .csv hoặc .xlsx. Với .xls, hãy lưu lại thành .xlsx."); return; }
    if (next.size > 4 * 1024 * 1024) { setError("Dung lượng tối đa là 4 MB."); return; }
    setFile(next); setPreviewing(true);
    try {
      const form = new FormData(); form.append("file", next);
      const data = await api<Summary>("/preview", { method: "POST", body: form });
      if (version === uploadVersion.current) setUpload(data);
    } catch (e) { if (version === uploadVersion.current) setError((e as Error).message); }
    finally { if (version === uploadVersion.current) setPreviewing(false); }
  }
  async function run() {
    setBusy(true); setError("");
    try {
      const form = new FormData(); form.append("task_id", taskId); form.append("prompt", prompt);
      if (dataset) form.append("dataset_id", dataset.id);
      else if (file) form.append("file", file);
      started((await api<Job>("/jobs", { method: "POST", body: form })).id);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return <>
    <Alert text={error} error onClose={() => setError("")}/>
    <div className="result-actions mode-switch"><button className={mode === "data" ? "primary" : "secondary"} onClick={() => setMode("data")}>Phân tích dữ liệu</button><button className={mode === "quick" ? "primary" : "secondary"} onClick={() => setMode("quick")}>Hỏi AI không kèm tệp</button></div>
    <div className="studio-grid">
      {mode === "quick" ? <QuickQuestion taskId={taskId} ready={ready} onCreated={started}/> : <section className="card input-card"><div className="card-heading"><span className="step">01</span><div><h2>Chạy AI Agent</h2></div><span className="badge">ĐẦU VÀO</span></div>
        {datasets.length > 0 && <div className="data-choices">
          {dataset && <p><strong>{dataset.filename}</strong> · {dataset.row_count.toLocaleString("vi-VN")} dòng</p>}
          {datasets.length > 1 && <label className="field">Tệp đã gắn với tác vụ<select value={source} onChange={e => setSource(e.target.value)}>{!dataset && <option value="">Tệp từ thiết bị</option>}{datasets.map(d => <option key={d.id} value={d.id}>{d.filename}</option>)}</select></label>}
          <button className="secondary" onClick={() => setSource(dataset ? "" : datasets[0].id)}>{dataset ? "Dùng tệp khác từ thiết bị" : "Dùng lại tệp của tác vụ"}</button>
        </div>}
        {!dataset && <><label className="field-label">Tệp dữ liệu <span>*</span></label>
          <div className={`dropzone ${drag ? "dragging" : ""}`} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); chooseFile(e.dataTransfer.files[0]); }}>
            <input ref={fileInput} type="file" accept=".csv,.xlsx" aria-label="Chọn tệp dữ liệu CSV hoặc XLSX" onChange={e => { chooseFile(e.target.files?.[0]); e.target.value = ""; }}/>
            <span className="upload-icon"><Icon name={file ? "file" : "upload"} size={25}/></span><strong>{file ? file.name : "Kéo thả tệp dữ liệu vào đây"}</strong><p>{previewing ? "Đang kiểm tra dữ liệu…" : file && upload ? `${upload.row_count.toLocaleString("vi-VN")} dòng · ${upload.columns.length} cột · ${(file.size / 1024).toFixed(1)} KB` : "Chỉ dùng dữ liệu bạn được phép sử dụng"}</p><button className="secondary" onClick={() => fileInput.current?.click()}>{file ? "Đổi tệp" : "Chọn tệp dữ liệu"}</button><small>CSV, XLSX · Tối đa 4 MB / 10.000 dòng</small>
          </div></>}
        <div className="label-row"><label className="field-label" htmlFor="prompt">Câu hỏi cho AI Agent <span>*</span></label><span>{prompt.length.toLocaleString("vi-VN")}/12.000</span></div>
        <textarea id="prompt" value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={12000} placeholder="Ví dụ: Phân tích doanh thu theo khu vực, xác định xu hướng theo tháng và chỉ ra những giao dịch bất thường…"/>
        <div className="input-footer"><button className="primary" onClick={run} disabled={!ready || busy || previewing || !prompt.trim() || !(dataset || (file && upload))}><Icon name="spark" size={18}/>{busy ? "Đang gửi…" : "Chạy AI Agent"}<Icon name="arrow" size={18}/></button></div>
      </section>}
      {mode === "data" && <section className="card preview-card"><div className="preview-title"><h2>Xem trước dữ liệu</h2>{preview && <span>8 dòng đầu tiên · {preview.columns.length} cột</span>}</div>{preview ? <div className="table-scroll"><table><thead><tr>{preview.columns.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{preview.rows.map((row, i) => <tr key={i}>{preview.columns.map(c => <td key={c}>{row[c] || <span className="muted">Trống</span>}</td>)}</tr>)}</tbody></table></div> : <div className="history-empty">{previewing ? "Đang đọc tệp…" : "Tải tệp để xem trước."}</div>}</section>}
      <section className="card result-card"><div className="card-heading"><span className="step">02</span><div><h2>Kết quả AI</h2></div><button className="secondary heading-action" onClick={onHistory}>Lịch sử chạy AI ↗</button></div>
        {current && current === chosenRun ? <p className="setup-tip chosen-note">Lượt chạy này đang là kết quả tác vụ. Xem, chỉnh sửa và tải PDF ở mục 03 bên dưới.</p>
          : current ? <JobView key={current} id={current} onUse={onUse ? () => onUse(current) : undefined} editable={Boolean(onUse)}/> : <div className="history-empty">Chưa có lượt nào đang chạy. Bấm “Chạy AI Agent” để xem kết quả tại đây.</div>}
      </section>
    </div>
  </>;
}

// T12 for the assigned employee: choose permitted data, run the AI agent, pick and edit the run that becomes
// the task's result, submit.
export default function TaskWorkspace({ taskId, connected, onHistory }: { taskId: string; connected: boolean; onHistory: () => void }) {
  const { data: task, error: loadError, reload } = useApi<Task>(`/tasks/${taskId}`, 5000);
  const { data: runs } = useApi<Job[]>(`/jobs?task=${taskId}`, 5000);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const confirmation = useRef<HTMLDialogElement>(null);
  if (!task) return <section className="card"><div className="history-empty">{loadError || "Đang tải tác vụ…"}</div></section>;

  const open = OPEN.includes(task.status);
  const finished = (runs || []).filter(run => run.status === "succeeded");
  const choose = async (runId: string) => {
    setBusy(true); setError("");
    try { await send(`/tasks/${task.id}/result`, "PUT", { run_id: runId }); await reload(); setNotice("Đã chọn lượt chạy làm kết quả tác vụ. Xem, chỉnh sửa và tải PDF ở mục 03."); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const uploadResult = async (file: File | undefined) => {
    if (!file) return;
    if (file.size === 0 || file.size > 10 * 1024 * 1024) { setError("Chọn file có nội dung, tối đa 10 MB."); return; }
    setBusy(true); setError("");
    try {
      const form = new FormData(); form.append("file", file);
      await api(`/tasks/${task.id}/attachment`, { method: "POST", body: form });
      await reload(); setNotice("Đã tải file và chọn làm kết quả tác vụ. Bấm Gửi trưởng phòng duyệt để nộp.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const submit = async () => {
    confirmation.current?.close();
    if (!open || busy || !task.selected_run_id) return;
    setBusy(true); setError("");
    try { await send(`/tasks/${task.id}/submit`, "POST"); await reload(); setNotice("Đã gửi trưởng phòng. Bạn có thể xem trạng thái trong Theo dõi tác vụ."); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return <>
    <Alert text={error} error onClose={() => setError("")}/>
    <Alert text={notice} onClose={() => setNotice("")}/>
    <TaskBrief task={task}/>
    {!open && <p className="setup-tip locked-note">Tác vụ đang ở trạng thái “{taskLabels[task.status]}”. Không chạy AI hoặc sửa kết quả cho đến khi có yêu cầu chỉnh sửa.</p>}
    <AnalysisPanel taskId={task.id} datasets={task.datasets} ready={open && connected} onStarted={reload} onHistory={onHistory} onUse={open ? choose : undefined} chosenRun={task.selected_run_id}/>
    <section className="card result-card task-output"><div className="card-heading"><span className="step">03</span><div><h2>Kết quả tác vụ</h2></div><span className="badge">ĐẦU RA T12</span></div>
      {task.selected_run_id ? <JobView key={task.selected_run_id} id={task.selected_run_id} editable={open}/>
        : task.result ? <pre className="answer saved-result">{task.result}</pre>
        : <div className="history-empty">Chưa chọn kết quả. Upload file từ thiết bị bên dưới hoặc ở mục 02, bấm “Dùng làm kết quả tác vụ” trên một lượt chạy đã hoàn tất.</div>}
      <dialog ref={confirmation} className="review-confirm" aria-labelledby="review-confirm-title" aria-describedby="review-confirm-note">
        <h2 id="review-confirm-title">Gửi kết quả này cho trưởng phòng duyệt?</h2>
        <p id="review-confirm-note">Sau khi gửi, bạn chỉ được sửa khi trưởng phòng yêu cầu.</p>
        <div><button className="secondary" autoFocus onClick={() => confirmation.current?.close()}>Hủy</button>
          <button className="primary" onClick={submit} disabled={!open || busy || !task.selected_run_id}>Gửi duyệt</button></div>
      </dialog>
      <div className="task-submit">{open && <label className="secondary file-button">{busy ? "Đang xử lý…" : "Upload file từ thiết bị ↑"}<input type="file" accept=".pdf,.docx,.xlsx,.csv,.txt" disabled={busy} onChange={e => { uploadResult(e.target.files?.[0]); e.target.value = ""; }}/><small> · PDF, DOCX, XLSX, CSV, TXT · tối đa 10 MB</small></label>}<button className="primary" style={{ width: "auto" }} onClick={() => confirmation.current?.showModal()} disabled={!open || busy || !task.selected_run_id}>Gửi trưởng phòng duyệt</button>{open && finished.length > 0 && <label className="check">Lượt chạy làm kết quả:<select className="inline-select" value={task.selected_run_id ?? ""} disabled={busy} onChange={e => e.target.value && choose(e.target.value)}>{!task.selected_run_id && <option value="">Chọn lượt chạy</option>}{finished.map(run => <option key={run.id} value={run.id}>{when(run.created)} · {run.prompt.slice(0, 60)}</option>)}</select></label>}</div>
    </section>
  </>;
}

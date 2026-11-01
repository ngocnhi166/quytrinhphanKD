"use client";

import { useRef, useState } from "react";
import QuickQuestion from "./quick-question";
import { api, Dataset, Job, OPEN, send, Summary, Task, taskLabels, useApi, when } from "./lib";
import { Alert, Icon, JobView, TaskBrief } from "./ui";

const suggestions = ["Tóm tắt dữ liệu, các chỉ số chính và những điểm đáng chú ý.", "Phân tích xu hướng và so sánh kết quả giữa các nhóm dữ liệu.", "Tìm dữ liệu thiếu, bản ghi trùng và các giá trị bất thường."];

// Choose the task's permitted data, ask ChatGPT and follow the run.
// Only the run in progress (or just started here) is shown; earlier runs live in the run history.
function AnalysisPanel({ taskId, datasets = [], ready, connected, onStarted, onUse, onHistory, chosenRun }: { taskId: string; datasets?: Dataset[]; ready: boolean; connected: boolean; onStarted: () => void; onUse?: (runId: string) => void; onHistory: () => void; chosenRun: string | null }) {
  const { data: jobs, reload: reloadJobs } = useApi<Job[]>(`/jobs?task=${taskId}`, 5000);
  const [mode, setMode] = useState<"data" | "quick">("data");
  const [source, setSource] = useState("");
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
    setError(""); setUpload(null); setFile(null); setSource("");
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
    <div className="result-actions mode-switch"><button className={mode === "data" ? "primary" : "secondary"} onClick={() => setMode("data")}>Phân tích dữ liệu</button><button className={mode === "quick" ? "primary" : "secondary"} onClick={() => setMode("quick")}>Hỏi nhanh</button></div>
    <div className="studio-grid">
      {mode === "quick" ? <QuickQuestion taskId={taskId} ready={ready} onCreated={started}/> : <section className="card input-card"><div className="card-heading"><span className="step">01</span><div><h2>Chạy AI Agent</h2><p>Chọn dữ liệu được phép sử dụng và đặt câu hỏi</p></div><span className="badge">ĐẦU VÀO</span></div>
        {datasets.length > 0 && <><label className="field-label">Dữ liệu mẫu của tác vụ</label><div className="suggestions data-choices">{datasets.map(d => <button key={d.id} className={source === d.id ? "chosen" : ""} onClick={() => setSource(d.id)}>{d.filename}<span>{d.row_count.toLocaleString("vi-VN")} dòng</span></button>)}<button className={!dataset ? "chosen" : ""} onClick={() => setSource("")}>Tải tệp khác<span>＋</span></button></div></>}
        {!dataset && <><label className="field-label">Tệp dữ liệu <span>*</span></label>
          <div className={`dropzone ${drag ? "dragging" : ""}`} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); chooseFile(e.dataTransfer.files[0]); }}>
            <input ref={fileInput} type="file" accept=".csv,.xlsx" aria-label="Chọn tệp dữ liệu CSV hoặc XLSX" onChange={e => { chooseFile(e.target.files?.[0]); e.target.value = ""; }}/>
            <span className="upload-icon"><Icon name={file ? "file" : "upload"} size={25}/></span><strong>{file ? file.name : "Kéo thả tệp dữ liệu vào đây"}</strong><p>{previewing ? "Đang kiểm tra dữ liệu…" : file && upload ? `${upload.row_count.toLocaleString("vi-VN")} dòng · ${upload.columns.length} cột · ${(file.size / 1024).toFixed(1)} KB` : "Chỉ dùng dữ liệu bạn được phép sử dụng"}</p><button className="secondary" onClick={() => fileInput.current?.click()}>{file ? "Đổi tệp" : "Chọn tệp dữ liệu"}</button><small>CSV, XLSX · Tối đa 4 MB / 10.000 dòng</small>
          </div></>}
        <div className="label-row"><label className="field-label" htmlFor="prompt">Câu hỏi cho AI Agent <span>*</span></label><span>{prompt.length.toLocaleString("vi-VN")}/12.000</span></div>
        <textarea id="prompt" value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={12000} placeholder="Ví dụ: Phân tích doanh thu theo khu vực, xác định xu hướng theo tháng và chỉ ra những giao dịch bất thường…"/>
        <p className="suggestion-label"><Icon name="spark" size={14}/> Gợi ý để bắt đầu</p><div className="suggestions">{["Tổng quan dữ liệu", "Xu hướng & so sánh", "Tìm bất thường"].map((s, i) => <button key={s} onClick={() => setPrompt(suggestions[i])}>{s}<span>＋</span></button>)}</div>
        <div className="input-footer"><button className="primary" onClick={run} disabled={!ready || busy || previewing || !prompt.trim() || !(dataset || (file && upload))}><Icon name="spark" size={18}/>{busy ? "Đang gửi…" : "Chạy AI Agent"}<Icon name="arrow" size={18}/></button><p>{connected ? "Dữ liệu và câu hỏi sẽ được gửi đến ChatGPT qua tab mới." : "Kết nối extension trước khi chạy AI."}</p></div>
      </section>}
      {mode === "data" && <section className="card preview-card"><div className="preview-title"><h2>Xem trước dữ liệu</h2>{preview && <span>8 dòng đầu tiên · {preview.columns.length} cột</span>}</div>{preview ? <div className="table-scroll"><table><thead><tr>{preview.columns.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{preview.rows.map((row, i) => <tr key={i}>{preview.columns.map(c => <td key={c}>{row[c] || <span className="muted">Trống</span>}</td>)}</tr>)}</tbody></table></div> : <div className="history-empty">{previewing ? "Đang đọc tệp…" : "Chọn dữ liệu mẫu hoặc tải tệp để xem trước."}</div>}</section>}
      <section className="card result-card"><div className="card-heading"><span className="step">02</span><div><h2>Kết quả AI</h2><p>Lượt đang chạy. Các lượt trước được lưu trong lịch sử chạy AI.</p></div><button className="secondary heading-action" onClick={onHistory}>Lịch sử chạy AI ↗</button></div>
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
  if (!task) return <section className="card"><div className="history-empty">{loadError || "Đang tải tác vụ…"}</div></section>;

  const open = OPEN.includes(task.status);
  const finished = (runs || []).filter(run => run.status === "succeeded");
  const choose = async (runId: string) => {
    setBusy(true); setError("");
    try { await send(`/tasks/${task.id}/result`, "PUT", { run_id: runId }); await reload(); setNotice("Đã chọn lượt chạy làm kết quả tác vụ. Xem, chỉnh sửa và tải PDF ở mục 03."); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const submit = async () => {
    if (!window.confirm("Submit để xác nhận hoàn thành T12? Lượt chạy đã chọn (bản đã chỉnh sửa nếu có) sẽ được chốt làm kết quả và bị khóa cho đến khi có yêu cầu chỉnh sửa từ G11.")) return;
    setBusy(true); setError("");
    try { await send(`/tasks/${task.id}/submit`, "POST"); await reload(); setNotice("Đã Submit T12. Trưởng phòng sẽ quyết định tại G11."); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return <>
    <Alert text={error} error onClose={() => setError("")}/>
    <Alert text={notice} onClose={() => setNotice("")}/>
    <TaskBrief task={task}/>
    {!open && <p className="setup-tip locked-note">Tác vụ đang ở trạng thái “{taskLabels[task.status]}”. Không chạy AI hoặc sửa kết quả cho đến khi có yêu cầu chỉnh sửa.</p>}
    <AnalysisPanel taskId={task.id} datasets={task.datasets} ready={open && connected} connected={connected} onStarted={reload} onHistory={onHistory} onUse={open ? choose : undefined} chosenRun={task.selected_run_id}/>
    <section className="card result-card task-output"><div className="card-heading"><span className="step">03</span><div><h2>Kết quả tác vụ</h2><p>Lượt chạy được chọn làm kết quả T12; chỉnh sửa trực tiếp trên báo cáo trước khi Submit</p></div><span className="badge">ĐẦU RA T12</span></div>
      {task.selected_run_id ? <JobView key={task.selected_run_id} id={task.selected_run_id} editable={open}/>
        : task.result ? <pre className="answer saved-result">{task.result}</pre>
        : <div className="history-empty">Chưa chọn kết quả. Ở mục 02, bấm “Dùng làm kết quả tác vụ” trên một lượt chạy đã hoàn tất.</div>}
      <div className="task-submit"><button className="primary" style={{ width: "auto" }} onClick={submit} disabled={!open || busy || !task.selected_run_id}>Submit xác nhận hoàn thành T12</button>{open && finished.length > 0 && <label className="check">Lượt chạy làm kết quả:<select className="inline-select" value={task.selected_run_id ?? ""} disabled={busy} onChange={e => e.target.value && choose(e.target.value)}>{!task.selected_run_id && <option value="">Chọn lượt chạy</option>}{finished.map(run => <option key={run.id} value={run.id}>{when(run.created)} · {run.prompt.slice(0, 60)}</option>)}</select></label>}</div>
    </section>
  </>;
}

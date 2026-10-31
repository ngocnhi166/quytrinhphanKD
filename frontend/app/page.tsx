"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QuickQuestion from "./quick-question";
import ReportView from "./report-view";

type Summary = { columns: string[]; row_count: number; preview: Record<string, string>[]; metrics: { duplicate_rows: number; missing_values: Record<string, number>; numeric: Record<string, { sum: string; mean: string; min: string; max: string }> } };
type Job = { id: string; filename: string; status: string; prompt: string; result: string | null; result_html?: string | null; error: string | null; created: number; summary: Summary };
const labels: Record<string, string> = { queued: "Đang chờ", running: "Đang xử lý", succeeded: "Hoàn thành", failed: "Cần kiểm tra" };
const suggestions = ["Tóm tắt dữ liệu, các chỉ số chính và những điểm đáng chú ý.", "Phân tích xu hướng và so sánh kết quả giữa các nhóm dữ liệu.", "Tìm dữ liệu thiếu, bản ghi trùng và các giá trị bất thường."];
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.detail === "string" ? body.detail : "Không kết nối được backend. Kiểm tra dịch vụ FastAPI.");
  return body;
}
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/></>,
    file: <><path d="M14 2H5v20h14V7zM14 2v6h5M8 12h8M8 16h8"/></>,
    history: <><path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2"/></>,
    link: <><path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 2 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"/></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
    spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/><path d="m20 2 .5 1.5L22 4l-1.5.5L20 6l-.5-1.5L18 4l1.5-.5z"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.file}</svg>;
}

export default function Home() {
  const [view, setView] = useState("studio");
  const [simple, setSimple] = useState(true);
  const [online, setOnline] = useState(false);
  const [connected, setConnected] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [drag, setDrag] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadVersion = useRef(0);
  const refresh = useCallback(async () => {
    try {
      const [health, list] = await Promise.all([api<{ extension_connected: boolean }>("/health"), api<Job[]>("/jobs")]);
      setOnline(true); setConnected(health.extension_connected); setJobs(list);
    } catch { setOnline(false); setConnected(false); }
  }, []);
  useEffect(() => { const timer = setTimeout(refresh, 0); const interval = setInterval(refresh, 2500); return () => { clearTimeout(timer); clearInterval(interval); }; }, [refresh]);
  const active = jobs.find(job => job.id === selected);
  const running = jobs.filter(job => ["running", "queued"].includes(job.status)).length;
  async function chooseFile(next: File | undefined) {
    if (!next) return;
    const version = ++uploadVersion.current;
    setError(""); setNotice(""); setSummary(null); setFile(null);
    if (!/\.(csv|xlsx)$/i.test(next.name)) { setError("Chọn tệp .csv hoặc .xlsx. Với .xls, hãy lưu lại thành .xlsx."); return; }
    if (next.size > 4 * 1024 * 1024) { setError("Dung lượng tối đa là 4 MB."); return; }
    setFile(next); setPreviewing(true);
    try {
      const form = new FormData(); form.append("file", next);
      const data = await api<Summary>("/preview", { method: "POST", body: form });
      if (version === uploadVersion.current) setSummary(data);
    } catch (e) { if (version === uploadVersion.current) setError((e as Error).message); }
    finally { if (version === uploadVersion.current) setPreviewing(false); }
  }
  async function submit() {
    if (!file || !summary || !prompt.trim()) return;
    setBusy(true); setError("");
    try {
      const form = new FormData(); form.append("file", file); form.append("prompt", prompt);
      const job = await api<Job>("/jobs", { method: "POST", body: form });
      setSelected(job.id); await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function pair() {
    setView("connect"); setError("");

  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setNotice("Đã sao chép."); }
    catch { setError("Không sao chép được. Hãy chọn và sao chép nội dung thủ công."); }
  }
  function download(job: Job) {
    const url = URL.createObjectURL(new Blob([`# ${job.filename}\n\nYêu cầu: ${job.prompt}\n\n${job.result || ""}`], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `phan-tich-${job.id.slice(0, 8)}.md`; anchor.click(); URL.revokeObjectURL(url);
  }
  return <div className="shell">
    <aside className="sidebar">
      <a className="brand" href="/"><span className="brand-mark">✳</span><span>T12 <b>studio</b><small>DATA ANALYSIS WORKSPACE</small></span></a>
      <div className="workspace"><span className="workspace-icon">T</span><div>Không gian cá nhân<small>Local workspace</small></div><span className="local-tag">LOCAL</span></div>
      <p className="nav-label">KHÔNG GIAN LÀM VIỆC</p>
      <nav>
        <button className={view === "studio" ? "nav-item active" : "nav-item"} onClick={() => setView("studio")}><Icon name="grid"/>Phân tích mới<span>↗</span></button>
        <button className={view === "history" ? "nav-item active" : "nav-item"} onClick={() => setView("history")}><Icon name="history"/>Lịch sử phân tích<span className="count">{jobs.length}</span></button>
        <button className={view === "connect" ? "nav-item active" : "nav-item"} onClick={pair}><Icon name="link"/>Kết nối trình duyệt<span className={`dot ${connected ? "green" : ""}`}/></button>
      </nav>
      <div className="sidebar-bottom"><div className="privacy-icon">⌘</div><h3>Trình duyệt của bạn.<br/>Không gian của bạn.</h3><p>Dùng phiên ChatGPT đã đăng nhập. Không cần nhập API key.</p><button onClick={pair}>Hướng dẫn kết nối <span>↗</span></button></div>
      <div className="profile"><span className="avatar">N</span><div>Người dùng cá nhân<small>Phiên làm việc cục bộ</small></div><span className="dot green"/></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div>Workspace <span>/</span> <b>{view === "history" ? "Lịch sử phân tích" : view === "connect" ? "Kết nối trình duyệt" : "Phân tích mới"}</b></div><button className="connection-pill" onClick={pair}><span className={`dot ${connected ? "green" : ""}`}/>{connected ? "Extension đã kết nối" : online ? "Chưa kết nối extension" : "Backend chưa chạy"}<span>↗</span></button></header>
      <main>
        <div className="eyebrow"><span/> TỪ DỮ LIỆU ĐẾN GÓC NHÌN</div>
        <div className="page-heading"><div><h1>{view === "studio" ? <>{simple ? "Hỏi một câu." : "Dữ liệu của bạn."} <em>{simple ? "Nhận câu trả lời." : "Góc nhìn mới."}</em></> : view === "history" ? "Mỗi phân tích, một góc nhìn." : "Kết nối để bắt đầu."}</h1><p>{view === "studio" ? (simple ? "Nhập một câu hỏi đơn giản để kiểm tra gửi và nhận với ChatGPT." : "Tải dữ liệu, đặt câu hỏi. Để ChatGPT giúp bạn tìm ra điều đáng chú ý.") : view === "history" ? "Kết quả và yêu cầu được lưu trên máy, sẵn sàng để xem lại." : "Một lần thiết lập. Sử dụng phiên ChatGPT ngay trên trình duyệt của bạn."}</p></div><span className="version">STUDIO / 01</span></div>
        {error && <div className="alert error" role="alert">{error}<button onClick={() => setError("")} aria-label="Đóng thông báo">×</button></div>}
        {notice && <div className="alert" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Đóng thông báo">×</button></div>}
        {view === "studio" && <>
          <div className="result-actions" style={{ margin: "0 0 20px" }}><button className={simple ? "primary" : "secondary"} style={{ width: "auto" }} onClick={() => setSimple(true)}>Hỏi nhanh</button><button className={!simple ? "primary" : "secondary"} style={{ width: "auto" }} onClick={() => setSimple(false)}>Phân tích tệp</button></div>
          {!simple && <div className="stat-strip"><div><span className="stat-icon"><Icon name="file"/></span><div><small>ĐỊNH DẠNG HỖ TRỢ</small><strong>CSV & Excel <span>.csv · .xlsx</span></strong></div></div><div><span className="stat-icon"><Icon name="link"/></span><div><small>PHƯƠNG THỨC XỬ LÝ</small><strong>ChatGPT <span>Qua trình duyệt</span></strong></div></div><div><span className="stat-icon"><Icon name="history"/></span><div><small>PHÂN TÍCH ĐÃ LƯU</small><strong>{jobs.filter(j => j.status === "succeeded").length.toString().padStart(2, "0")} <span>{running ? `${running} đang xử lý` : "Sẵn sàng cho ý tưởng mới"}</span></strong></div></div></div>}
          <div className="studio-grid">{simple ? <QuickQuestion connected={connected} onCreated={id => { setSelected(id); refresh(); }}/> : <section className="card input-card"><div className="card-heading"><span className="step">01</span><div><h2>Thiết lập phân tích</h2><p>Bắt đầu với dữ liệu và câu hỏi của bạn</p></div><span className="badge">ĐẦU VÀO</span></div>
            <label className="field-label">Tệp dữ liệu <span>*</span></label>
            <div className={`dropzone ${drag ? "dragging" : ""}`} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); chooseFile(e.dataTransfer.files[0]); }}>
              <input ref={fileInput} type="file" accept=".csv,.xlsx" aria-label="Chọn tệp dữ liệu CSV hoặc XLSX" onChange={e => { chooseFile(e.target.files?.[0]); e.target.value = ""; }}/>
              <span className="upload-icon"><Icon name={file ? "file" : "upload"} size={25}/></span><strong>{file ? file.name : "Kéo thả tệp dữ liệu vào đây"}</strong><p>{previewing ? "Đang kiểm tra dữ liệu…" : file && summary ? `${summary.row_count.toLocaleString("vi-VN")} dòng · ${summary.columns.length} cột · ${(file.size / 1024).toFixed(1)} KB` : "hoặc chọn tệp từ máy tính của bạn"}</p><button className="secondary" onClick={() => fileInput.current?.click()}>{file ? "Đổi tệp" : "Chọn tệp dữ liệu"}</button><small>CSV, XLSX · Tối đa 4 MB / 10.000 dòng</small>
            </div>
            <div className="label-row"><label className="field-label" htmlFor="prompt">Bạn muốn tìm hiểu điều gì? <span>*</span></label><span>{prompt.length.toLocaleString("vi-VN")}/12.000</span></div>
            <textarea id="prompt" value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={12000} placeholder="Ví dụ: Phân tích doanh thu theo khu vực, xác định xu hướng theo tháng và chỉ ra những giao dịch bất thường…"/>
            <p className="suggestion-label"><Icon name="spark" size={14}/> Gợi ý để bắt đầu</p><div className="suggestions">{["Tổng quan dữ liệu", "Xu hướng & so sánh", "Tìm bất thường"].map((s, i) => <button key={s} onClick={() => setPrompt(suggestions[i])}>{s}<span>＋</span></button>)}</div>
            <div className="input-footer"><button className="primary" onClick={submit} disabled={!file || !summary || !prompt.trim() || busy || !connected || previewing}><Icon name="spark" size={18}/>{busy ? "Đang gửi…" : "Bắt đầu phân tích"}<Icon name="arrow" size={18}/></button><p>Tệp và câu hỏi sẽ được gửi đến ChatGPT qua tab mới.</p></div>
          </section>}
          <section className="card result-card"><div className="card-heading"><span className="step">02</span><div><h2>Kết quả phân tích</h2><p>Từ con số đến những phát hiện có ý nghĩa</p></div><span className="badge">ĐẦU RA</span></div>
            {active ? <div className="result-content"><div className="result-meta"><strong>{active.filename}</strong><span className={`status ${active.status}`}>{labels[active.status]}</span></div>{active.result ? <><div className="result-actions"><button className="secondary" onClick={() => copy(active.result!)}>Sao chép</button><button className="secondary" onClick={() => download(active)}>Tải kết quả ↓</button></div><p className="fine-print" role="status">{active.status === "running" ? "Đang nhận nội dung từ ChatGPT. Đây là bản đang viết, chưa phải kết quả hoàn tất." : active.status === "failed" ? "Lượt chạy bị gián đoạn. Nội dung dưới đây có thể chưa đầy đủ." : "Đã nhận kết quả hoàn tất. Hãy kiểm tra số liệu trước khi sử dụng."}</p>{active.result_html ? <ReportView html={active.result_html}/> : <pre className="answer">{active.result}</pre>}{active.error && <p className="result-error">{active.error}</p>}</> : active.error ? <div className="result-error">{active.error}<p>Tab lỗi được giữ lại để bạn kiểm tra. Tạo lượt mới sau khi khắc phục.</p></div> : <div className="processing"><span className="spinner"/><h3>{active.status === "queued" ? "Đang chờ đến lượt…" : "ChatGPT đang trả lời…"}</h3><p>Tab tự mở trong trình duyệt có extension. Kết quả sẽ xuất hiện tại đây và tab sẽ đóng sau khi lưu.</p></div>}</div> : <div className="empty-state"><div className="orbit"><div className="orbit-inner"><Icon name="spark" size={34}/></div><span className="orbit-dot a"/><span className="orbit-dot b"/><span className="orbit-dot c"/></div><span className="empty-eyebrow">MỌI GÓC NHÌN ĐỀU BẮT ĐẦU TỪ MỘT CÂU HỎI</span><h3>Dữ liệu đang chờ được khám phá</h3><p>Tải tệp và nhập câu hỏi ở bên trái.<br/>Những phát hiện sẽ xuất hiện tại đây.</p><div className="output-features"><span>✓ Tóm tắt dữ liệu</span><span>✓ Phát hiện nổi bật</span><span>✓ Gợi ý hành động</span></div></div>}
            <div className="result-bottom"><span className={`dot ${connected ? "green" : ""}`}/>{connected ? "Trình duyệt sẵn sàng nhận yêu cầu" : "Kết nối extension để bắt đầu phân tích"}<button onClick={pair}>Thiết lập ↗</button></div>
          </section>
          {!simple && summary && <section className="card preview-card"><div className="preview-title"><h2>Xem trước dữ liệu</h2><span>8 dòng đầu tiên · {summary.columns.length} cột</span></div><div className="table-scroll"><table><thead><tr>{summary.columns.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{summary.preview.map((row, i) => <tr key={i}>{summary.columns.map(c => <td key={c}>{row[c] || <span className="muted">Trống</span>}</td>)}</tr>)}</tbody></table></div></section>}
          {!simple && !summary && <section className="card preview-card"><div className="preview-title"><h2>Xem trước dữ liệu</h2></div><div className="history-empty">{previewing ? "Đang đọc tệp…" : "Chọn tệp bên trái để xem trước dữ liệu."}</div></section>}
          </div>
          {!simple && <div className="flow-note"><span>QUY TRÌNH ĐƠN GIẢN</span><p>01 <b>Tải dữ liệu</b><span>→</span>02 <b>ChatGPT phân tích</b><span>→</span>03 <b>Lưu kết quả & đóng tab</b></p><span>Được lưu tại máy của bạn ↙</span></div>}
        </>}
        {view === "history" && <section className="card history-card"><div className="preview-title"><h2>Lịch sử phân tích</h2><span>{jobs.length} lượt gần nhất</span></div>{!jobs.length ? <div className="history-empty">Chưa có lượt phân tích nào. <button className="secondary" onClick={() => setView("studio")}>Tạo phân tích đầu tiên ↗</button></div> : jobs.map(job => <button className="history-row" key={job.id} onClick={() => { setSelected(job.id); setView("studio"); }}><span className="stat-icon"><Icon name="file"/></span><div><strong>{job.filename}</strong><p>{job.prompt}</p></div><time>{new Date(job.created * 1000).toLocaleString("vi-VN")}</time><span className={`status ${job.status}`}>{labels[job.status]}</span><Icon name="arrow"/></button>)}</section>}
        {view === "connect" && <div className="setup-grid"><section className="card setup-card"><h2>Kết nối ChatGPT của bạn</h2><p>Chạy backend tại cổng 8000, website tại cổng 3000.</p><ol><li><b>Mở Chrome hoặc Edge</b><p>Dùng đúng hồ sơ trình duyệt đã đăng nhập tại <a href="https://chatgpt.com" target="_blank" rel="noreferrer">chatgpt.com ↗</a>.</p></li><li><b>Cài extension của dự án</b><p>Vào trang quản lý tiện ích → bật Chế độ nhà phát triển → Tải tiện ích đã giải nén → chọn thư mục <code>extension</code> trong dự án.</p></li><li><b>Mở và đóng tool</b><p>Khởi động backend, mở tiện ích T12 Studio rồi bấm Mở tool. Bấm Đóng tool khi ngừng sử dụng. Không cần nhập mã.</p></li></ol></section><section className="card setup-card"><span className="setup-icon"><Icon name="link" size={30}/></span><h2>Trạng thái kết nối</h2><div className="health-row">Backend FastAPI <span className={`status ${online ? "succeeded" : "failed"}`}>{online ? "Đang chạy" : "Chưa chạy"}</span></div><div className="health-row">Extension <span className={`status ${connected ? "succeeded" : "failed"}`}>{connected ? "Đã kết nối" : "Chưa kết nối"}</span></div><p className="setup-tip">Kết nối extension không đồng nghĩa đã đăng nhập ChatGPT. Hãy kiểm tra tài khoản trong trình duyệt trước khi chạy.</p><p className="fine-print">Tệp được gửi lên ChatGPT để xử lý. Đóng tab không xóa cuộc hội thoại. Khi gặp lỗi, tab được giữ lại để kiểm tra.</p><button className="primary" onClick={() => setView("studio")}>Về không gian phân tích <Icon name="arrow"/></button></section></div>}
        <footer><span>✳ T12 Studio</span><span>Một không gian gọn gàng cho những câu hỏi lớn.</span><span>LOCAL WORKSPACE · V1.0</span></footer>
      </main>
    </div>
  </div>;
}

"use client";

import BrandMark from "./brand-mark";

import { useCallback, useState } from "react";
import { Accounts, AuditLog, Datasets } from "./admin";
import { api, ApiError, Dataset, OPEN, Role, roleNames, send, Task, useApi, usePolling, User } from "./lib";
import Login from "./login";
import { Icon, TaskList } from "./ui";
import { RunHistory, TaskOverview } from "./views";
import TaskWorkspace from "./workspace";

const NAV: Record<Role, { key: string; label: string; icon: string }[]> = {
  employee: [{ key: "tasks", label: "Tác vụ của tôi", icon: "grid" }, { key: "datasets", label: "Kho dữ liệu", icon: "file" }, { key: "history", label: "Lịch sử phân tích", icon: "history" }, { key: "tracking", label: "Theo dõi tác vụ", icon: "checklist" }, { key: "connect", label: "Thiết lập kết nối", icon: "link" }],
  manager: [{ key: "tasks", label: "Tác vụ phòng ban", icon: "grid" }, { key: "history", label: "Lịch sử phân tích", icon: "history" }, { key: "review", label: "Phê duyệt tác vụ", icon: "shield" }],
  admin: [{ key: "users", label: "Quản lý tài khoản", icon: "users" }, { key: "datasets", label: "Kho dữ liệu", icon: "file" }, { key: "history", label: "Lịch sử phân tích", icon: "history" }, { key: "approved", label: "Kết quả đã duyệt", icon: "grid" }, { key: "audit", label: "Nhật ký hoạt động", icon: "history" }, { key: "connect", label: "Thiết lập kết nối", icon: "link" }],
};
function DatasetChoice() {
  const { data, error } = useApi<Dataset[]>("/datasets");
  return <label className="field">Dữ liệu từ kho<select name="dataset_id" defaultValue=""><option value="">Không gắn tệp</option>{data?.map(file => <option key={file.id} value={file.id}>{file.filename}</option>)}</select>{error && <small role="alert">{error}</small>}</label>;
}
function TaskCard({ view, user, onOpen }: { view: string; user: User; onOpen: (task: Task) => void }) {
  const { data, error, reload } = useApi<Task[]>("/tasks", 5000);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const myTasks = view === "tasks" && user.role === "employee";
  const items = data?.filter(task => {
    if (myTasks) return OPEN.includes(task.status);
    if (view === "approved") return task.status === "approved";
    if (view === "review") return task.status === "submitted";
    if (view === "tracking") return task.status === "submitted" || task.status === "approved";
    return true;
  }) ?? null;
  if (creating) return <section className="card task-create-card">
    <div className="preview-title"><h2>Tạo tác vụ mới</h2></div>
    <form onSubmit={async e => {
      e.preventDefault();
      if (busy) return;
      const values = Object.fromEntries(new FormData(e.currentTarget));
      if (!String(values.title).trim() || !String(values.objective).trim()) {
        setMessage("Vui lòng nhập tên và mục tiêu tác vụ.");
        return;
      }
      setBusy(true); setMessage("");
      try { const task = await send<Task>("/tasks", "POST", values); onOpen(task); }
      catch (err) { setMessage((err as Error).message); } finally { setBusy(false); }
    }}>
      <fieldset><legend>Thông tin tác vụ</legend>
        <label className="field">Tên tác vụ<input autoFocus name="title" required maxLength={200} placeholder="Ví dụ: Phân tích doanh thu quý II"/></label>
        <label className="field">Mục tiêu cần đạt<textarea name="objective" required maxLength={4000} placeholder="Ví dụ: Xác định khu vực có doanh thu giảm mạnh nhất."/></label>
      </fieldset>
      <fieldset><legend>Thiết lập phân tích <small>Tùy chọn</small></legend>
        <DatasetChoice/>
        <label className="field">Yêu cầu phân tích<textarea name="requirements" maxLength={8000} placeholder="Ví dụ: So sánh theo tháng, tách theo khu vực."/></label>
      </fieldset>
      {message && <p role="alert" className="alert error">{message}</p>}
      <div className="task-create-footer"><button type="button" className="secondary" disabled={busy} onClick={() => setCreating(false)}>Hủy</button><button className="primary task-create-action" disabled={busy}>{busy ? "Đang tạo…" : "Tạo và mở tác vụ"}</button></div>
    </form>
  </section>;
  return <section className="card history-card"><div className="preview-title"><h2>{view === "approved" ? "Hồ sơ đã phê duyệt" : view === "tracking" ? "Tác vụ đã gửi duyệt" : view === "review" ? "Tác vụ chờ phê duyệt" : user.role === "manager" ? `Tác vụ của ${user.department || "phòng ban"}` : "Tác vụ cần xử lý"}</h2>
    {view === "tasks" && user.role === "employee" && <button className="primary task-create-action" onClick={() => { setMessage(""); setCreating(true); }}>+ Tạo tác vụ</button>}</div>
    {error && <p role="alert" className="alert error">{error}</p>}
    {message && <p role="alert" className="alert error">{message}</p>}
    <TaskList deleting={deleting} onDelete={view === "tasks" && user.role === "employee" ? async task => {
      if (deleting || !window.confirm(`Xóa tác vụ “${task.title}”? Bạn không thể hoàn tác.`)) return;
      setDeleting(task.id); setMessage("");
      try { await send(`/tasks/${task.id}`, "DELETE"); await reload(); }
      catch (err) { setMessage((err as Error).message); }
      finally { setDeleting(null); }
    } : undefined} tasks={items} empty={myTasks ? "Hiện không có tác vụ cần xử lý. Xem kết quả đã gửi trong mục Theo dõi tác vụ." : "Chưa có tác vụ trong danh sách này."} onOpen={onOpen}/></section>;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  const [online, setOnline] = useState(false);
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState("");
  const [systemOpen, setSystemOpen] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const health = await api<{ extension_connected: boolean }>("/health");
      setOnline(true); setConnected(health.extension_connected);
    } catch { setOnline(false); setConnected(false); }
    // An expired, revoked or locked session drops back to the login screen.
    try { setUser(await api<User>("/me")); }
    catch (e) { if (e instanceof ApiError && e.status === 401) setUser(null); }
    setChecked(true);
  }, []);
  usePolling(refresh, 5000);
  if (!checked) return <div className="login"><span className="spinner"/></div>;
  if (!user) return <Login onLogin={next => { setUser(next); setView(""); setTaskId(null); setSystemOpen(false); }}/>;

  const nav = NAV[user.role];
  const current = nav.some(item => item.key === view) ? view : nav[0].key;
  const label = nav.find(item => item.key === current)!.label;
  const go = (key: string) => { setView(key); setTaskId(null); if (["audit", "connect"].includes(key)) setSystemOpen(true); };
  const primaryNav = nav.filter(item => !["audit", "connect"].includes(item.key));
  const systemNav = nav.filter(item => ["audit", "connect"].includes(item.key));
  const navButton = (item: typeof nav[number]) => <button key={item.key} className={current === item.key ? "nav-item active" : "nav-item"} aria-current={current === item.key ? "page" : undefined} onClick={() => go(item.key)}><Icon name={item.icon}/>{item.label}</button>;
  const logout = async () => { await send("/auth/logout", "POST").catch(() => {}); setUser(null); };
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><BrandMark/><span>SCOPE <b>T12</b><small>NỀN TẢNG PHÂN TÍCH DỮ LIỆU</small></span></div>
      <div className="workspace"><span className="workspace-icon">{(user.department || "T")[0]}</span><div>{user.department || "Toàn hệ thống"}<small>{roleNames[user.role]}</small></div></div>
      <p className="nav-label">ĐIỀU HƯỚNG</p>
      <nav aria-label="Điều hướng chính">{primaryNav.map(navButton)}</nav>
      {systemNav.length > 0 && <div className="system-navigation"><button className="system-toggle" aria-expanded={systemOpen} aria-controls="system-navigation" onClick={() => setSystemOpen(!systemOpen)}>Hệ thống <span aria-hidden="true">{systemOpen ? "−" : "+"}</span></button><nav id="system-navigation" aria-label="Hệ thống" hidden={!systemOpen}>{systemNav.map(navButton)}</nav></div>}
      <div className="profile"><span className="avatar">{user.full_name[0]}</span><div className="profile-identity"><span title={user.full_name}>{user.full_name}</span><small>{user.username}</small></div><button className="logout" onClick={logout} title="Đăng xuất" aria-label="Đăng xuất"><Icon name="logout" size={18}/></button></div>
    </aside>
    <div className="main-shell">
      <header className="topbar">
        <div>Không gian làm việc <span>/</span> <b>{label}</b></div>
        <div className="topbar-actions header-tools">
          {user.role !== "manager" && <button className="header-connection" onClick={() => go("connect")} title="Mở thiết lập kết nối" aria-label={`Thiết lập kết nối: ${!online ? "Máy chủ ngoại tuyến" : connected ? "Tiện ích đã kết nối" : "Tiện ích chưa kết nối"}`}>
            <i className={online && connected ? "signal active" : "signal"} aria-hidden="true"/>
            <span>{!online ? "Máy chủ ngoại tuyến" : connected ? "Tiện ích đã kết nối" : "Tiện ích chưa kết nối"}</span>
          </button>}
          <details className="header-account" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) e.currentTarget.open = false; }} onKeyDown={e => { if (e.key === "Escape") { e.currentTarget.open = false; e.currentTarget.querySelector("summary")?.focus(); } }}>
            <summary aria-label={`Menu tài khoản ${user.full_name}`}><span className="header-initial">{(user.full_name.trim() || user.username).slice(0,1).toUpperCase()}</span><svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12"><path d="m2 4 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg></summary>
            <div className="header-account-panel"><strong>{user.full_name}</strong><small>{roleNames[user.role]}</small><button onClick={logout}><Icon name="logout" size={16}/>Đăng xuất</button></div>
          </details>
        </div>
      </header>
      <main>
        <div className="eyebrow"><span/> {roleNames[user.role].toUpperCase()} · {label.toUpperCase()}</div>
        <div className="page-heading"><div><h1>{label}</h1></div></div>
        {["tasks", "tracking", "approved", "review"].includes(current) && (taskId
          ? <><button className="secondary back-button" onClick={() => setTaskId(null)}>← Danh sách tác vụ</button>{user.role === "employee" ? <TaskWorkspace key={taskId} taskId={taskId} connected={connected} onHistory={() => go("history")}/> : <TaskOverview key={taskId} taskId={taskId} canReview={user.role === "manager" && current === "review"}/>}</>
          : <TaskCard key={current} view={current} user={user} onOpen={task => setTaskId(task.id)}/>)}
        {current === "history" && <RunHistory role={user.role}/>}
        {current === "users" && <Accounts me={user}/>}
        {current === "datasets" && <Datasets canManage={user.role === "admin"}/>}
        {current === "audit" && <AuditLog/>}
        {current === "connect" && <div className="setup-grid"><section className="card setup-card"><h2>Kết nối ChatGPT của bạn</h2><p>Chạy backend tại cổng 8000, website tại cổng 3000.</p><ol><li><b>Mở Chrome hoặc Edge</b><p>Dùng đúng hồ sơ trình duyệt đã đăng nhập tại <a href="https://chatgpt.com" target="_blank" rel="noreferrer">chatgpt.com ↗</a>.</p></li><li><b>Cài extension của dự án</b><p>Vào trang quản lý tiện ích → bật Chế độ nhà phát triển → Tải tiện ích đã giải nén → chọn thư mục <code>extension</code> trong dự án.</p></li><li><b>Mở và đóng tool</b><p>Khởi động backend, mở tiện ích T12 Studio rồi bấm Mở tool. Bấm Đóng tool khi ngừng sử dụng. Không cần nhập mã.</p></li></ol></section><section className="card setup-card"><span className="setup-icon"><Icon name="link" size={30}/></span><h2>Trạng thái kết nối</h2><div className="health-row">Backend FastAPI <span className={`status ${online ? "succeeded" : "failed"}`}>{online ? "Đang chạy" : "Chưa chạy"}</span></div><div className="health-row">Extension <span className={`status ${connected ? "succeeded" : "failed"}`}>{connected ? "Đã kết nối" : "Chưa kết nối"}</span></div><p className="setup-tip">Kết nối extension không đồng nghĩa đã đăng nhập ChatGPT. Hãy kiểm tra tài khoản trong trình duyệt trước khi chạy.</p><p className="fine-print">Tệp được gửi lên ChatGPT để xử lý. Đóng tab không xóa cuộc hội thoại. Khi gặp lỗi, tab được giữ lại để kiểm tra.</p><button className="primary" onClick={() => go(nav[0].key)}>Về không gian làm việc <Icon name="arrow"/></button></section></div>}
      </main>
    </div>
  </div>;
}

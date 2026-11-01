"use client";

import { useCallback, useState } from "react";
import { Accounts, AdminTasks, AuditLog, Datasets } from "./admin";
import { api, ApiError, Role, roleNames, send, Task, useApi, usePolling, User } from "./lib";
import Login from "./login";
import { Icon, TaskList } from "./ui";
import { RolesInfo, RunHistory, TaskOverview } from "./views";
import TaskWorkspace from "./workspace";

const NAV: Record<Role, { key: string; label: string; icon: string }[]> = {
  employee: [{ key: "tasks", label: "Tác vụ của tôi", icon: "grid" }, { key: "history", label: "Lịch sử chạy AI", icon: "history" }, { key: "connect", label: "Kết nối trình duyệt", icon: "link" }, { key: "roles", label: "Phân quyền", icon: "shield" }],
  manager: [{ key: "tasks", label: "Tác vụ phòng ban", icon: "grid" }, { key: "history", label: "Lịch sử chạy AI", icon: "history" }, { key: "roles", label: "Phân quyền", icon: "shield" }],
  admin: [{ key: "users", label: "Tài khoản", icon: "users" }, { key: "admin-tasks", label: "Quản lý tác vụ", icon: "grid" }, { key: "datasets", label: "Dữ liệu mẫu", icon: "file" }, { key: "history", label: "Lịch sử chạy AI", icon: "spark" }, { key: "audit", label: "Nhật ký hoạt động", icon: "history" }, { key: "connect", label: "Kết nối trình duyệt", icon: "link" }, { key: "roles", label: "Phân quyền", icon: "shield" }],
};
const HINTS: Record<Role, string> = {
  employee: "Thực hiện T12 trên tác vụ được giao: chạy AI, kiểm tra, lưu và Submit.",
  manager: "Xem tác vụ và kết quả của phòng ban ở chế độ chỉ đọc. Quyết định G11 thực hiện ngoài web.",
  admin: "Quản lý tài khoản, tác vụ, dữ liệu mẫu và ghi nhận quyết định G11 đã có.",
};

function heading(view: string, role: Role): [React.ReactNode, string] {
  switch (view) {
    case "tasks": return role === "manager"
      ? [<>Phòng ban của bạn. <em>Theo dõi kết quả.</em></>, "Xem tác vụ, kết quả và lịch sử chạy AI của nhân viên trong phòng ban. Quyết định G11 thực hiện ngoài web."]
      : [<>Tác vụ được giao. <em>Từ dữ liệu đến kết quả.</em></>, "Mở tác vụ để xem mục tiêu, chạy AI Agent với dữ liệu được phép và Submit khi hoàn thành T12."];
    case "history": return ["Mỗi lượt chạy, một dấu vết.", role === "admin" ? "Toàn bộ lịch sử chạy AI của hệ thống, để kiểm tra và giải trình khi cần." : role === "manager" ? "Các lượt chạy AI trên tác vụ của phòng ban, chỉ xem." : "Các lượt chạy AI trên tác vụ được giao cho bạn."];
    case "connect": return ["Kết nối để bắt đầu.", "Một lần thiết lập. Sử dụng phiên ChatGPT ngay trên trình duyệt của bạn."];
    case "users": return [<>Tài khoản. <em>Vai trò rõ ràng.</em></>, "Tạo, sửa, khóa tài khoản và quản lý quyền truy cập theo phòng ban."];
    case "admin-tasks": return [<>Giao việc rõ ràng. <em>Ghi nhận minh bạch.</em></>, "Giao tác vụ cho nhân viên, gắn dữ liệu mẫu và ghi nhận quyết định G11 của Trưởng phòng."];
    case "datasets": return ["Dữ liệu mẫu.", "Quản lý tệp dữ liệu mà nhân viên được phép chọn khi chạy AI."];
    case "audit": return ["Nhật ký hoạt động.", "Ai đã làm gì, lúc nào — kể cả các lần bị từ chối truy cập."];
    default: return [<>Đúng người. <em>Đúng việc.</em></>, "Phân quyền để bảo mật dữ liệu, đảm bảo đúng trách nhiệm, ngăn truy cập trái phép, minh bạch khi giải trình và tránh xung đột quyền hạn."];
  }
}

function TaskCard({ title, empty, onOpen }: { title: string; empty: string; onOpen: (task: Task) => void }) {
  const { data } = useApi<Task[]>("/tasks", 5000);
  return <section className="card history-card"><div className="preview-title"><h2>{title}</h2><span>{data?.length ?? 0} tác vụ</span></div><TaskList tasks={data} empty={empty} onOpen={onOpen}/></section>;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  const [online, setOnline] = useState(false);
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState("");
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
  if (!user) return <Login onLogin={next => { setUser(next); setView(""); setTaskId(null); }}/>;

  const nav = NAV[user.role];
  const current = nav.some(item => item.key === view) ? view : nav[0].key;
  const label = nav.find(item => item.key === current)!.label;
  const [title, intro] = heading(current, user.role);
  const go = (key: string) => { setView(key); setTaskId(null); };
  const logout = async () => { await send("/auth/logout", "POST").catch(() => {}); setUser(null); };
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">✳</span><span>T12 <b>studio</b><small>DATA ANALYSIS WORKSPACE</small></span></div>
      <div className="workspace"><span className="workspace-icon">{(user.department || "T")[0]}</span><div>{user.department || "Toàn hệ thống"}<small>{roleNames[user.role]}</small></div><span className="local-tag">LOCAL</span></div>
      <p className="nav-label">KHÔNG GIAN LÀM VIỆC</p>
      <nav>{nav.map(item => <button key={item.key} className={current === item.key ? "nav-item active" : "nav-item"} onClick={() => go(item.key)}><Icon name={item.icon}/>{item.label}{item.key === "connect" ? <span className={`dot ${connected ? "green" : ""}`}/> : <span>↗</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="privacy-icon">⌘</div><h3>Vai trò của bạn:<br/>{roleNames[user.role]}.</h3><p>{HINTS[user.role]}</p><button onClick={() => go("roles")}>Xem phân quyền <span>↗</span></button></div>
      <div className="profile"><span className="avatar">{user.full_name[0]}</span><div>{user.full_name}<small>{user.username}</small></div><button className="logout" onClick={logout} title="Đăng xuất" aria-label="Đăng xuất"><Icon name="logout" size={18}/></button></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div>Workspace <span>/</span> <b>{label}</b></div><div className="topbar-actions">{user.role !== "manager" && <button className="connection-pill" onClick={() => go("connect")}><span className={`dot ${connected ? "green" : ""}`}/>{connected ? "Extension đã kết nối" : online ? "Chưa kết nối extension" : "Backend chưa chạy"}<span>↗</span></button>}<button className="logout-button" onClick={logout} title={`Đăng xuất ${user.username}`}><Icon name="logout" size={15}/>Đăng xuất</button></div></header>
      <main>
        <div className="eyebrow"><span/> {roleNames[user.role].toUpperCase()} · {label.toUpperCase()}</div>
        <div className="page-heading"><div><h1>{title}</h1><p>{intro}</p></div><span className="version">STUDIO / 02</span></div>
        {current === "tasks" && (taskId
          ? <><button className="secondary back-button" onClick={() => setTaskId(null)}>← Danh sách tác vụ</button>{user.role === "employee" ? <TaskWorkspace key={taskId} taskId={taskId} connected={connected} onHistory={() => go("history")}/> : <TaskOverview key={taskId} taskId={taskId}/>}</>
          : <TaskCard title={user.role === "manager" ? `Tác vụ của ${user.department}` : "Tác vụ được giao cho bạn"} empty={user.role === "manager" ? "Phòng ban chưa có tác vụ nào." : "Bạn chưa được giao tác vụ nào. Phần chạy AI nằm trong từng tác vụ: khi Admin giao tác vụ, mở tác vụ đó để chạy AI Agent."} onOpen={task => setTaskId(task.id)}/>)}
        {current === "history" && <RunHistory role={user.role}/>}
        {current === "users" && <Accounts me={user}/>}
        {current === "admin-tasks" && <AdminTasks/>}
        {current === "datasets" && <Datasets/>}
        {current === "audit" && <AuditLog/>}
        {current === "roles" && <RolesInfo role={user.role}/>}
        {current === "connect" && <div className="setup-grid"><section className="card setup-card"><h2>Kết nối ChatGPT của bạn</h2><p>Chạy backend tại cổng 8000, website tại cổng 3000.</p><ol><li><b>Mở Chrome hoặc Edge</b><p>Dùng đúng hồ sơ trình duyệt đã đăng nhập tại <a href="https://chatgpt.com" target="_blank" rel="noreferrer">chatgpt.com ↗</a>.</p></li><li><b>Cài extension của dự án</b><p>Vào trang quản lý tiện ích → bật Chế độ nhà phát triển → Tải tiện ích đã giải nén → chọn thư mục <code>extension</code> trong dự án.</p></li><li><b>Mở và đóng tool</b><p>Khởi động backend, mở tiện ích T12 Studio rồi bấm Mở tool. Bấm Đóng tool khi ngừng sử dụng. Không cần nhập mã.</p></li></ol></section><section className="card setup-card"><span className="setup-icon"><Icon name="link" size={30}/></span><h2>Trạng thái kết nối</h2><div className="health-row">Backend FastAPI <span className={`status ${online ? "succeeded" : "failed"}`}>{online ? "Đang chạy" : "Chưa chạy"}</span></div><div className="health-row">Extension <span className={`status ${connected ? "succeeded" : "failed"}`}>{connected ? "Đã kết nối" : "Chưa kết nối"}</span></div><p className="setup-tip">Kết nối extension không đồng nghĩa đã đăng nhập ChatGPT. Hãy kiểm tra tài khoản trong trình duyệt trước khi chạy.</p><p className="fine-print">Tệp được gửi lên ChatGPT để xử lý. Đóng tab không xóa cuộc hội thoại. Khi gặp lỗi, tab được giữ lại để kiểm tra.</p><button className="primary" onClick={() => go(nav[0].key)}>Về không gian làm việc <Icon name="arrow"/></button></section></div>}
        <footer><span>✳ T12 Studio</span><span>Một không gian gọn gàng cho những câu hỏi lớn.</span><span>LOCAL WORKSPACE · V2.0</span></footer>
      </main>
    </div>
  </div>;
}

"use client";

import { useState } from "react";
import { actionLabels, api, AuditEntry, Dataset, Department, Role, roleNames, send, Task, taskLabels, useApi, User, when } from "./lib";
import { Alert, TaskBrief, TaskList } from "./ui";
import { TaskEvidence } from "./views";

function useAction(after: () => void) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function act(work: () => Promise<unknown>, done: string) {
    setError(""); setNotice("");
    try { await work(); setNotice(done); return true; }
    catch (e) { setError((e as Error).message); return false; }
    finally { after(); }
  }
  const alerts = <><Alert text={error} error onClose={() => setError("")}/><Alert text={notice} onClose={() => setNotice("")}/></>;
  return { act, alerts };
}

export function Accounts({ me }: { me: User }) {
  const users = useApi<User[]>("/users");
  const departments = useApi<Department[]>("/departments");
  const { act, alerts } = useAction(() => { users.reload(); departments.reload(); });
  const blank = { username: "", full_name: "", password: "", role: "employee" as Role, department_id: "" };
  const [form, setForm] = useState(blank);
  const [department, setDepartment] = useState("");
  const firstDepartment = departments.data?.[0]?.id ?? null;
  const change = (user: User, body: object, done: string) => act(() => send(`/users/${user.id}`, "PATCH", body), done);
  async function create() {
    const body = { ...form, department_id: form.role === "admin" ? null : Number(form.department_id) || null };
    if (await act(() => send("/users", "POST", body), `Đã tạo tài khoản ${form.username}.`)) setForm(blank);
  }
  function resetPassword(user: User) {
    const password = window.prompt(`Mật khẩu mới cho ${user.username} (tối thiểu 8 ký tự):`);
    if (password) change(user, { password }, `Đã đặt lại mật khẩu cho ${user.username}. Phiên đăng nhập cũ đã bị thu hồi.`);
  }
  return <>
    {alerts}
    <div className="setup-grid">
      <section className="card setup-card"><h2>Tạo tài khoản</h2><div className="form-grid">
        <label className="field">Tên đăng nhập<input value={form.username} onChange={e => setForm({ ...form, username: e.target.value.toLowerCase() })} placeholder="vd: nguyenvana"/></label>
        <label className="field">Họ tên<input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })}/></label>
        <label className="field">Mật khẩu ban đầu<input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} autoComplete="new-password"/></label>
        <label className="field">Vai trò<select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as Role })}>{(Object.keys(roleNames) as Role[]).map(r => <option key={r} value={r}>{roleNames[r]}</option>)}</select></label>
        {form.role !== "admin" && <label className="field">Phòng ban<select value={form.department_id} onChange={e => setForm({ ...form, department_id: e.target.value })}><option value="">Chọn phòng ban</option>{departments.data?.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
      </div><button className="primary" onClick={create} disabled={!form.username || !form.full_name || !form.password}>Tạo tài khoản</button></section>
      <section className="card setup-card"><h2>Phòng ban</h2>{departments.data?.map(d => <div className="health-row" key={d.id}>{d.name}<span className="fine-print">{d.members} tài khoản</span></div>)}
        <div className="token-row add-row"><input value={department} onChange={e => setDepartment(e.target.value)} placeholder="Tên phòng ban mới" aria-label="Tên phòng ban mới"/><button className="secondary" disabled={!department.trim()} onClick={async () => { if (await act(() => send("/departments", "POST", { name: department }), "Đã tạo phòng ban.")) setDepartment(""); }}>Thêm</button></div>
      </section>
    </div>
    <section className="card history-card"><div className="preview-title"><h2>Tài khoản và quyền truy cập</h2><span>Đổi vai trò, khóa tài khoản hay đặt lại mật khẩu sẽ thu hồi phiên đăng nhập ngay</span></div><div className="table-scroll admin-table"><table><thead><tr><th>Tài khoản</th><th>Vai trò</th><th>Phòng ban</th><th>Trạng thái</th><th></th></tr></thead><tbody>
      {users.data?.map(user => { const self = user.id === me.id; return <tr key={user.id}>
        <td><b>{user.full_name}</b><br/><span className="muted">{user.username}{self ? " · bạn" : ""}</span></td>
        <td><select className="inline-select" value={user.role} disabled={self} title={self ? "Không thể tự đổi vai trò của mình" : undefined} onChange={e => change(user, { role: e.target.value, department_id: e.target.value === "admin" ? null : user.department_id ?? firstDepartment }, `Đã đổi vai trò của ${user.username}.`)}>{(Object.keys(roleNames) as Role[]).map(r => <option key={r} value={r}>{roleNames[r]}</option>)}</select></td>
        <td>{user.role === "admin" ? <span className="muted">Toàn hệ thống</span> : <select className="inline-select" value={user.department_id ?? ""} onChange={e => change(user, { department_id: Number(e.target.value) }, `Đã đổi phòng ban của ${user.username}.`)}>{departments.data?.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}</td>
        <td><span className={`status ${user.active ? "succeeded" : "failed"}`}>{user.active ? "Hoạt động" : "Đã khóa"}</span></td>
        <td className="row-actions"><button className="secondary" disabled={self} onClick={() => change(user, { active: !user.active }, user.active ? `Đã khóa ${user.username}.` : `Đã mở khóa ${user.username}.`)}>{user.active ? "Khóa" : "Mở khóa"}</button><button className="secondary" onClick={() => resetPassword(user)}>Đặt lại mật khẩu</button></td>
      </tr>; })}
    </tbody></table></div></section>
  </>;
}

function TaskForm({ initial, employees, datasets, onSaved }: { initial?: Task; employees: User[]; datasets: Dataset[]; onSaved: () => void }) {
  const [form, setForm] = useState({ title: initial?.title ?? "", objective: initial?.objective ?? "", requirements: initial?.requirements ?? "", assignee_id: String(initial?.assignee_id ?? ""), dataset_ids: initial?.datasets?.map(d => d.id) ?? [] });
  const { act, alerts } = useAction(() => {});
  const toggle = (id: string) => setForm({ ...form, dataset_ids: form.dataset_ids.includes(id) ? form.dataset_ids.filter(x => x !== id) : [...form.dataset_ids, id] });
  async function save() {
    const body = { ...form, assignee_id: Number(form.assignee_id) };
    if (await act(() => initial ? send(`/tasks/${initial.id}`, "PUT", body) : send("/tasks", "POST", body), initial ? "Đã cập nhật tác vụ." : "Đã giao tác vụ.")) onSaved();
  }
  return <section className="card setup-card">{alerts}<h2>{initial ? "Sửa tác vụ" : "Giao tác vụ mới"}</h2>
    <div className="form-grid">
      <label className="field">Tiêu đề<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}/></label>
      <label className="field">Nhân viên thực hiện<select value={form.assignee_id} onChange={e => setForm({ ...form, assignee_id: e.target.value })}><option value="">Chọn nhân viên</option>{employees.map(u => <option key={u.id} value={u.id}>{u.full_name} · {u.department}</option>)}</select></label>
    </div>
    <label className="field">Mục tiêu<textarea value={form.objective} onChange={e => setForm({ ...form, objective: e.target.value })}/></label>
    <label className="field">Yêu cầu phân tích<textarea value={form.requirements} onChange={e => setForm({ ...form, requirements: e.target.value })}/></label>
    <p className="field-label">Dữ liệu mẫu được phép sử dụng</p>
    {datasets.length ? <div className="check-list">{datasets.map(d => <label key={d.id} className="check"><input type="checkbox" checked={form.dataset_ids.includes(d.id)} onChange={() => toggle(d.id)}/>{d.filename} <span className="muted">· {d.row_count} dòng</span></label>)}</div> : <p className="fine-print">Chưa có dữ liệu mẫu. Nhân viên vẫn có thể tự tải tệp được phép sử dụng.</p>}
    <button className="primary" onClick={save} disabled={!form.title.trim() || !form.objective.trim() || !form.requirements.trim() || !form.assignee_id}>{initial ? "Lưu thay đổi" : "Giao tác vụ"}</button>
  </section>;
}

function G11Form({ task, onSaved }: { task: Task; onSaved: () => void }) {
  const [status, setStatus] = useState<"approved" | "needs_revision">("approved");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const { act, alerts } = useAction(() => {});
  async function record() {
    if (await act(() => send(`/tasks/${task.id}/review`, "POST", { status, note, confirmed }), "Đã ghi nhận quyết định G11.")) onSaved();
  }
  return <section className="card setup-card">{alerts}<h2>Ghi nhận quyết định G11</h2>
    <p className="setup-tip">Trưởng phòng {task.department} quyết định tại G11, ngoài web. Admin chỉ cập nhật trạng thái và ghi chú theo quyết định đã có; không tự quyết định phê duyệt.</p>
    <div className="check-list">{(["approved", "needs_revision"] as const).map(value => <label key={value} className="check"><input type="radio" name="g11" checked={status === value} onChange={() => setStatus(value)}/>{value} · {taskLabels[value]}</label>)}</div>
    <label className="field">Ghi chú chỉnh sửa {status === "needs_revision" ? "(bắt buộc)" : "(không bắt buộc)"}<textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Ghi đúng nội dung Trưởng phòng yêu cầu"/></label>
    <label className="check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>Tôi xác nhận Trưởng phòng đã đưa ra quyết định này tại G11.</label>
    <button className="primary" onClick={record} disabled={!confirmed || (status === "needs_revision" && !note.trim())}>Cập nhật trạng thái</button>
  </section>;
}

function AdminTaskDetail({ id, employees, datasets, onChanged }: { id: string; employees: User[]; datasets: Dataset[]; onChanged: () => void }) {
  const { data: task, error, reload } = useApi<Task>(`/tasks/${id}`);
  if (!task) return <section className="card"><div className="history-empty">{error || "Đang tải tác vụ…"}</div></section>;
  const saved = () => { reload(); onChanged(); };
  return <>
    <TaskBrief task={task}/>
    {task.status === "submitted" ? <G11Form task={task} onSaved={saved}/> : task.status === "approved" ? <p className="setup-tip admin-note">Tác vụ đã được duyệt và khóa để giữ nguyên căn cứ giải trình.</p> : <TaskForm initial={task} employees={employees} datasets={datasets} onSaved={saved}/>}
    <TaskEvidence task={task}/>
  </>;
}

export function AdminTasks() {
  const tasks = useApi<Task[]>("/tasks", 5000);
  const users = useApi<User[]>("/users");
  const datasets = useApi<Dataset[]>("/datasets");
  const [open, setOpen] = useState<string | null>(null);
  const employees = (users.data || []).filter(u => u.role === "employee" && u.active);
  if (open) return <><button className="secondary back-button" onClick={() => setOpen(null)}>← Danh sách tác vụ</button>
    {open === "new" ? <TaskForm employees={employees} datasets={datasets.data || []} onSaved={() => { tasks.reload(); setOpen(null); }}/> : <AdminTaskDetail key={open} id={open} employees={employees} datasets={datasets.data || []} onChanged={tasks.reload}/>}</>;
  return <section className="card history-card"><div className="preview-title"><h2>Tác vụ toàn hệ thống</h2><button className="primary" style={{ width: "auto" }} onClick={() => setOpen("new")}>Giao tác vụ mới</button></div>
    <TaskList tasks={tasks.data} empty="Chưa có tác vụ nào. Bấm “Giao tác vụ mới” để bắt đầu." onOpen={task => setOpen(task.id)}/></section>;
}

export function Datasets() {
  const datasets = useApi<Dataset[]>("/datasets");
  const { act, alerts } = useAction(datasets.reload);
  async function add(file: File | undefined) {
    if (!file) return;
    const form = new FormData(); form.append("file", file);
    await act(() => api("/datasets", { method: "POST", body: form }), `Đã thêm ${file.name}.`);
  }
  return <>{alerts}<section className="card history-card"><div className="preview-title"><h2>Dữ liệu mẫu</h2><label className="primary file-button">Thêm tệp CSV/XLSX<input type="file" accept=".csv,.xlsx" onChange={e => { add(e.target.files?.[0]); e.target.value = ""; }}/></label></div>
    {!datasets.data?.length ? <div className="history-empty">Chưa có dữ liệu mẫu. Dữ liệu thêm ở đây có thể gắn vào tác vụ để nhân viên chọn khi chạy AI.</div> : <div className="table-scroll admin-table"><table><thead><tr><th>Tệp</th><th>Kích thước</th><th>Thêm lúc</th><th></th></tr></thead><tbody>{datasets.data.map(d => <tr key={d.id}><td><b>{d.filename}</b></td><td>{d.row_count.toLocaleString("vi-VN")} dòng · {d.columns.length} cột</td><td>{when(d.created)}</td><td className="row-actions"><button className="secondary" onClick={() => window.confirm(`Xóa ${d.filename}? Tệp sẽ được gỡ khỏi các tác vụ đang dùng.`) && act(() => send(`/datasets/${d.id}`, "DELETE"), `Đã xóa ${d.filename}.`)}>Xóa</button></td></tr>)}</tbody></table></div>}
  </section></>;
}

export function AuditLog() {
  const { data } = useApi<AuditEntry[]>("/audit", 5000);
  const [deniedOnly, setDeniedOnly] = useState(false);
  const rows = (data || []).filter(r => !deniedOnly || ["denied", "login_failed"].includes(r.action));
  return <section className="card history-card"><div className="preview-title"><h2>Nhật ký hoạt động</h2><label className="check"><input type="checkbox" checked={deniedOnly} onChange={e => setDeniedOnly(e.target.checked)}/>Chỉ truy cập bị từ chối</label></div>
    <div className="table-scroll admin-table audit-table"><table><thead><tr><th>Thời gian</th><th>Tài khoản</th><th>Hoạt động</th><th>Đối tượng</th><th>Chi tiết</th></tr></thead><tbody>{rows.map(r => <tr key={r.id} className={["denied", "login_failed"].includes(r.action) ? "warn" : ""}><td>{when(r.at)}</td><td>{r.username || "—"}</td><td>{actionLabels[r.action] || r.action}</td><td title={r.target}>{r.target}</td><td title={r.detail}>{r.detail}</td></tr>)}</tbody></table></div>
  </section>;
}

"use client";

import { useState } from "react";
import { actionLabels, api, AuditEntry, Dataset, Department, Role, roleNames, send, useApi, User, when } from "./lib";
import { Alert, Icon } from "./ui";


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
  const blank = { username: "", full_name: "", phone: "", email: "", password: "", role: "employee" as Role, department_id: "" };
  const [form, setForm] = useState(blank);
  const [department, setDepartment] = useState("");
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null);
  const [departmentName, setDepartmentName] = useState("");
  const [savingDepartment, setSavingDepartment] = useState(false);
  const [deletingDepartment, setDeletingDepartment] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [editingName, setEditingName] = useState<number | null>(null);
  const [fullName, setFullName] = useState("");
  const [savingName, setSavingName] = useState(false);
  async function saveName(user: User) {
    if (!fullName.trim() || savingName) return;
    setSavingName(true);
    try {
      if (await act(() => send(`/users/${user.id}`, "PATCH", { full_name: fullName.trim() }), "Đã cập nhật họ và tên.")) setEditingName(null);
    } finally { setSavingName(false); }
  }
  const firstDepartment = departments.data?.[0]?.id ?? null;
  const change = (user: User, body: object, done: string) => act(() => send(`/users/${user.id}`, "PATCH", body), done);
  async function saveDepartment() {
    if (!editingDepartment || !departmentName.trim() || savingDepartment) return;
    setSavingDepartment(true);
    try {
      if (await act(() => send(`/departments/${editingDepartment.id}`, "PATCH", { name: departmentName.trim() }), "Đã cập nhật phòng ban.")) setEditingDepartment(null);
    } finally { setSavingDepartment(false); }
  }
  async function deleteDepartment(item: Department) {
    if (deletingDepartment !== null || !window.confirm(`Xóa phòng ban “${item.name}”? Thao tác này không thể hoàn tác.`)) return;
    setDeletingDepartment(item.id);
    try {
      if (await act(() => send(`/departments/${item.id}`, "DELETE"), `Đã xóa phòng ban ${item.name}.`)) {
        setForm(current => current.department_id === String(item.id) ? { ...current, department_id: "" } : current);
      }
    } finally { setDeletingDepartment(null); }
  }
  async function create() {
    const body = { ...form, phone: form.phone.trim(), email: form.email.trim(), department_id: form.role === "admin" ? null : Number(form.department_id) || null };
    if (await act(() => send("/users", "POST", body), `Đã tạo tài khoản ${form.username}.`)) setForm(blank);
  }
  function resetPassword(user: User) {
    const password = window.prompt(`Mật khẩu mới cho ${user.username} (tối thiểu 8 ký tự):`);
    if (password) change(user, { password }, `Đã đặt lại mật khẩu cho ${user.username}. Phiên đăng nhập cũ đã bị thu hồi.`);
  }
  async function deleteAccount(user: User) {
    if (deleting !== null || user.id === me.id) return;
    if (!window.confirm(`Xóa vĩnh viễn tài khoản ${user.username}? Tài khoản sẽ không thể đăng nhập lại. Thao tác này không thể hoàn tác.`)) return;
    setDeleting(user.id);
    try {
      await act(() => send(`/users/${user.id}`, "DELETE"), `Đã xóa tài khoản ${user.username}.`);
    } finally { setDeleting(null); }
  }
  return <>
    {alerts}
    <div className="setup-grid">
      <section className="card setup-card account-create"><h2>Tạo tài khoản mới</h2>
        <fieldset><legend>Thông tin người dùng</legend><label className="field">Họ và tên<input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} placeholder="Nhập họ và tên đầy đủ" autoComplete="name"/></label><div className="form-grid">
          <label className="field">Số điện thoại<input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} autoComplete="tel" maxLength={30} placeholder="Ví dụ: 0901234567"/></label>
          <label className="field">Email<input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} autoComplete="email" maxLength={254} placeholder="Ví dụ: ten@congty.vn"/></label>
        </div></fieldset>
        <fieldset><legend>Thông tin đăng nhập</legend><div className="form-grid">
          <label className="field">Tên đăng nhập<input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="Ví dụ: NguyenVanA" autoComplete="off"/></label>
          <label className="field">Mật khẩu<input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} autoComplete="new-password" placeholder="Tối thiểu 8 ký tự"/></label>
        </div></fieldset>
        <fieldset><legend>Phân quyền và đơn vị</legend><div className="form-grid">
          <label className="field">Vai trò hệ thống<select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as Role })}>{(Object.keys(roleNames) as Role[]).map(r => <option key={r} value={r}>{roleNames[r]}</option>)}</select></label>
          <label className="field">Phòng ban trực thuộc<select value={form.role === "admin" ? "" : form.department_id} disabled={form.role === "admin"} onChange={e => setForm({ ...form, department_id: e.target.value })}><option value="">{form.role === "admin" ? "Toàn hệ thống" : "Chọn phòng ban"}</option>{form.role !== "admin" && departments.data?.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        </div></fieldset>
        <button className="primary" onClick={create} disabled={!form.username.trim() || !form.full_name.trim() || form.password.length < 8 || (form.role !== "admin" && !form.department_id)}>Tạo tài khoản</button>
      </section>
      <section className="card setup-card"><h2>Phòng ban</h2>{departments.data?.map(d => <div className="health-row" key={d.id}>{d.name}<div className="department-actions"><span className="fine-print">{d.members} tài khoản</span><details className="department-menu" onKeyDown={e => { if (e.key === "Escape") { e.currentTarget.open = false; e.currentTarget.querySelector("summary")?.focus(); } }} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) e.currentTarget.open = false; }}><summary aria-label={`Thao tác phòng ban ${d.name}`} title="Thao tác phòng ban">⋮</summary><div className="department-menu-panel"><button disabled={deletingDepartment !== null || savingDepartment} onClick={e => { e.currentTarget.closest("details")!.open = false; setEditingDepartment(d); setDepartmentName(d.name); }}>Chỉnh sửa</button><button className="department-menu-delete" disabled={deletingDepartment !== null || savingDepartment} onClick={e => { e.currentTarget.closest("details")!.open = false; deleteDepartment(d); }}>Xóa phòng ban</button></div></details></div></div>)}
        {editingDepartment && <form className="department-editor" onSubmit={e => { e.preventDefault(); saveDepartment(); }}><label className="field">Tên phòng ban<input autoFocus value={departmentName} maxLength={100} disabled={savingDepartment} onChange={e => setDepartmentName(e.target.value)}/></label><div className="result-actions"><button className="secondary" disabled={savingDepartment || !departmentName.trim()}>{savingDepartment ? "Đang lưu…" : "Lưu thay đổi"}</button><button type="button" className="secondary" disabled={savingDepartment} onClick={() => setEditingDepartment(null)}>Hủy</button></div></form>}
        <div className="token-row add-row"><input value={department} onChange={e => setDepartment(e.target.value)} placeholder="Tên phòng ban mới" aria-label="Tên phòng ban mới"/><button className="secondary" disabled={!department.trim()} onClick={async () => { if (await act(() => send("/departments", "POST", { name: department }), "Đã tạo phòng ban.")) setDepartment(""); }}>Thêm</button></div>
      </section>
    </div>
    <section className="card history-card"><div className="preview-title"><h2>Tài khoản và quyền truy cập</h2></div><div className="table-scroll admin-table"><table><thead><tr><th>Tài khoản</th><th>Vai trò</th><th>Phòng ban</th><th>Trạng thái</th><th className="account-actions-heading">Thao tác</th></tr></thead><tbody>
      {users.data?.map(user => { const self = user.id === me.id; return <tr key={user.id}>
        <td className="account-name-cell">{editingName === user.id ? <form className="account-name-editor" onSubmit={e => { e.preventDefault(); saveName(user); }}>
          <input aria-label="Họ và tên mới" autoFocus maxLength={100} value={fullName} disabled={savingName} onChange={e => setFullName(e.target.value)} onKeyDown={e => { if (e.key === "Escape" && !savingName) setEditingName(null); }}/>
          <div><button className="secondary" disabled={savingName || !fullName.trim()}>{savingName ? "Đang lưu…" : "Lưu"}</button><button className="secondary" type="button" disabled={savingName} onClick={() => setEditingName(null)}>Hủy</button></div>
        </form> : <div className="account-display-name"><b>{user.full_name}</b><button type="button" className="edit-name-button" aria-label={`Chỉnh sửa họ và tên ${user.full_name}`} title="Chỉnh sửa họ và tên" disabled={savingName || deleting === user.id} onClick={() => { setEditingName(user.id); setFullName(user.full_name); }}><Icon name="edit" size={15}/></button></div>}<span className="muted">{user.username}{self ? " · bạn" : ""}</span></td>
        <td><select className="inline-select" value={user.role} disabled={self} title={self ? "Không thể tự đổi vai trò của mình" : undefined} onChange={e => change(user, { role: e.target.value, department_id: e.target.value === "admin" ? null : user.department_id ?? firstDepartment }, `Đã đổi vai trò của ${user.username}.`)}>{(Object.keys(roleNames) as Role[]).map(r => <option key={r} value={r}>{roleNames[r]}</option>)}</select></td>
        <td>{user.role === "admin" ? <span className="muted">Toàn hệ thống</span> : <select className="inline-select" value={user.department_id ?? ""} onChange={e => change(user, { department_id: Number(e.target.value) }, `Đã đổi phòng ban của ${user.username}.`)}>{departments.data?.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}</td>
        <td><span className={`status ${user.active ? "succeeded" : "failed"}`}>{user.active ? "Hoạt động" : "Đã khóa"}</span></td>
        <td className="account-actions-cell"><div className="account-actions" role="group" aria-label={`Thao tác với ${user.username}`}>
          <button type="button" className="account-action" disabled={self || deleting === user.id} title={self ? "Không thể tự khóa tài khoản đang đăng nhập" : `${user.active ? "Khóa" : "Mở khóa"} tài khoản ${user.username}`} onClick={() => change(user, { active: !user.active }, user.active ? `Đã khóa ${user.username}.` : `Đã mở khóa ${user.username}.`)}><Icon name={user.active ? "lock" : "unlock"} size={16}/><span>{user.active ? "Khóa" : "Mở khóa"}</span></button>
          <button type="button" className="account-action account-action-password" disabled={deleting === user.id} title={`Đặt lại mật khẩu cho ${user.username}`} onClick={() => resetPassword(user)}><Icon name="key" size={16}/><span>Đặt lại mật khẩu</span></button>
          <button type="button" className="account-action account-action-delete" disabled={self || deleting !== null} aria-label={`Xóa tài khoản ${user.username}`} title={self ? "Không thể tự xóa tài khoản đang đăng nhập" : `Xóa tài khoản ${user.username}`} onClick={() => deleteAccount(user)}><Icon name="trash" size={16}/><span>{deleting === user.id ? "Đang xóa…" : "Xóa"}</span></button>
        </div></td>
      </tr>; })}
    </tbody></table></div></section>
  </>;
}

export function Datasets({ canManage }: { canManage: boolean }) {
  const datasets = useApi<Dataset[]>("/datasets");
  const { act, alerts } = useAction(datasets.reload);
  async function add(file: File | undefined) {
    if (!file) return;
    const form = new FormData(); form.append("file", file);
    await act(() => api("/datasets", { method: "POST", body: form }), `Đã thêm ${file.name}.`);
  }
  return <>{alerts}<section className="card history-card"><div className="preview-title"><h2>Dữ liệu mẫu</h2><label className="primary file-button">Thêm tệp CSV/XLSX<input type="file" accept=".csv,.xlsx" onChange={e => { add(e.target.files?.[0]); e.target.value = ""; }}/></label></div>
    {!datasets.data?.length ? <div className="history-empty">{datasets.error || (datasets.data ? "Chưa có dữ liệu mẫu trong kho của bạn." : "Đang tải dữ liệu…")}</div> : <div className="table-scroll admin-table"><table><thead><tr><th>Tệp</th><th>Kích thước</th><th>Thêm lúc</th>{canManage && <th></th>}</tr></thead><tbody>{datasets.data.map(d => <tr key={d.id}><td><b>{d.filename}</b></td><td>{d.row_count.toLocaleString("vi-VN")} dòng · {d.columns.length} cột</td><td>{when(d.created)}</td>{canManage && <td className="row-actions"><button className="secondary" onClick={() => window.confirm(`Xóa ${d.filename}? Tệp sẽ được gỡ khỏi các tác vụ đang dùng.`) && act(() => send(`/datasets/${d.id}`, "DELETE"), `Đã xóa ${d.filename}.`)}>Xóa</button></td>}</tr>)}</tbody></table></div>}
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

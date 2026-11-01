"use client";

import { useState } from "react";
import { send, User } from "./lib";

export default function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try { onLogin(await send<User>("/auth/login", "POST", { username, password })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="login">
    <form className="card login-card" onSubmit={submit}>
      <div className="brand"><span className="brand-mark">✳</span><span>T12 <b>studio</b><small>DATA ANALYSIS WORKSPACE</small></span></div>
      <h1>Đăng nhập</h1>
      <p className="fine-print">Mỗi tài khoản có đúng một vai trò: Nhân viên, Trưởng phòng hoặc Admin. Bạn chỉ thấy các chức năng thuộc vai trò của mình.</p>
      {error && <p className="alert error" role="alert">{error}</p>}
      <label className="field">Tên đăng nhập<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" autoFocus/></label>
      <label className="field">Mật khẩu<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password"/></label>
      <button className="primary" disabled={busy || !username || !password}>{busy ? "Đang đăng nhập…" : "Đăng nhập"}</button>
      <p className="fine-print">Lần chạy đầu, tài khoản khởi tạo được lưu trong <code>backend/data/initial-accounts.txt</code>. Quên mật khẩu: liên hệ Admin để đặt lại.</p>
    </form>
  </div>;
}

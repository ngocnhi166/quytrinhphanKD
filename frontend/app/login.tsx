"use client";

import BrandMark from "./brand-mark";

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
      <div className="brand"><BrandMark/><span>SCOPE <b>T12</b><small>DATA ANALYSIS WORKSPACE</small></span></div>
      {error && <p className="alert error" role="alert">{error}</p>}
      <label className="field">Tên đăng nhập<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" autoFocus/></label>
      <label className="field">Mật khẩu<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password"/></label>
      <button className="primary" disabled={busy || !username || !password}>{busy ? "Đang đăng nhập…" : "Đăng nhập"}</button>
    </form>
  </div>;
}

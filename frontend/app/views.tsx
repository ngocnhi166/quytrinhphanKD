"use client";

import { useRef, useState } from "react";
import { Job, Role, roleNames, Task, send, useApi } from "./lib";
import { JobList, JobView, TaskBrief } from "./ui";

function TaskEvidence({ task }: { task: Task }) {
  return <section className="card task-output">
    <div className="preview-title"><h2>Báo cáo kết quả</h2></div>
    {task.selected_run_id
      ? <JobView key={task.selected_run_id} id={task.selected_run_id} reportOnly/>
      : <pre className="answer saved-result">{task.result || "Chưa có báo cáo kết quả."}</pre>}
  </section>;
}

export function TaskOverview({ taskId, canReview = false }: { taskId: string; canReview?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [decision, setDecision] = useState<"approved" | "needs_revision">("approved");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const { data: task, error, reload } = useApi<Task>(`/tasks/${taskId}`, 5000);
  if (!task) return <section className="card"><div className="history-empty">{error || "Đang tải tác vụ…"}</div></section>;
  function confirmDecision(status: typeof decision) {
    setDecision(status);
    dialog.current?.showModal();
  }
  async function decide() {
    dialog.current?.close();
    if (busy || !canReview || task?.status !== "submitted") return;
    setBusy(true); setMessage("");
    try { await send(`/tasks/${taskId}/review`, "POST", { status: decision, note, confirmed: true }); await reload(); }
    catch (err) { setMessage((err as Error).message); } finally { setBusy(false); }
  }
  return <><TaskBrief task={task}/><TaskEvidence task={task}/>{canReview && task.status === "submitted" && <section className="card setup-card task-review"><h2>Đánh giá kết quả tác vụ</h2>
    <label className="field"><textarea aria-label="Nhận xét" value={note} maxLength={4000} onChange={e => setNote(e.target.value)} placeholder="Nhập nhận xét hoặc nêu rõ nội dung cần chỉnh sửa."/></label>{message && <p role="alert">{message}</p>}<div className="result-actions"><button className="secondary" disabled={busy || !note.trim()} onClick={() => confirmDecision("needs_revision")}>Yêu cầu chỉnh sửa</button><button className="primary" disabled={busy} onClick={() => confirmDecision("approved")}>Phê duyệt tác vụ</button></div>
    <dialog ref={dialog} className="review-confirm decision-confirm" aria-labelledby="decision-title" aria-describedby="decision-task">
      <h2 id="decision-title">{decision === "approved" ? "Xác nhận phê duyệt" : "Xác nhận yêu cầu chỉnh sửa"}</h2>
      <p id="decision-task">{decision === "approved"
        ? "Sau khi phê duyệt, nhân viên và quản trị viên có thể xem kết quả."
        : "Nhân viên sẽ nhận được nhận xét của bạn để chỉnh sửa và gửi lại kết quả."}</p>
      <div><button className="secondary" autoFocus onClick={() => dialog.current?.close()}>Hủy</button>
        <button className="primary" disabled={busy} onClick={decide}>{decision === "approved" ? "Phê duyệt" : "Gửi yêu cầu"}</button></div>
    </dialog>
  </section>}</>;

}

const roles = Object.keys(roleNames) as Role[];
const historyTitles: Record<Role, string> = { employee: "Lịch sử chạy AI của tác vụ được giao", manager: "Lịch sử chạy AI trong phòng ban", admin: "Toàn bộ lịch sử chạy AI" };

export function RunHistory({ role }: { role: Role }) {
  const { data: jobs, reload } = useApi<Job[]>("/jobs", 2500);
  const [target, setTarget] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);
  const confirmation = useRef<HTMLDialogElement>(null);
  async function remove() {
    if (!target || removing) return;
    setRemoving(true);
    try {
      await send(`/history/${target.id}`, "DELETE");
      confirmation.current?.close();
      await reload();
    } catch (err) { setError((err as Error).message); }
    finally { setRemoving(false); }
  }
  const [selected, setSelected] = useState<string | null>(null);
  return <section className="card history-card"><div className="preview-title"><h2>{historyTitles[role]}</h2><span>{jobs?.length ?? 0} lượt gần nhất</span></div>
    {selected ? <><button className="secondary back-button" onClick={() => setSelected(null)}>← Danh sách lượt chạy</button><JobView key={selected} id={selected}/></> : <JobList jobs={jobs} onRemove={role === "admin" ? job => {
      setTarget(job); setError(""); confirmation.current?.showModal();
    } : undefined} onSelect={setSelected} showOwner={role !== "employee"}/>}
    {role === "admin" && <dialog className="review-confirm decision-confirm" ref={confirmation} aria-labelledby="remove-history-title">
      <h2 id="remove-history-title">Xóa lượt phân tích khỏi lịch sử?</h2>
      <p>{target?.filename} · {target && new Date(target.created * 1000).toLocaleString("vi-VN")}</p>
      {error && <p role="alert">{error}</p>}
      <div><button className="secondary" autoFocus disabled={removing} onClick={() => confirmation.current?.close()}>Hủy</button>
        <button className="account-action account-action-delete" disabled={removing} onClick={remove}>{removing ? "Đang xóa…" : "Xóa khỏi lịch sử"}</button></div>
    </dialog>}
  </section>;
}

// Role matrix 3.3 of the T12 software design ("3.3_Thiet_ke_phan_mem_T12_theo_TOBE_moi").
const matrix: [string, string, string, string][] = [
  ["Đăng nhập", "Có", "Có", "Có"],
  ["Xem tác vụ được giao", "Có – chỉ tác vụ được giao cho mình", "Có – theo phòng ban", "Quản lý tất cả"],
  ["Xem chi tiết tác vụ", "Tác vụ được giao", "Theo phòng ban", "Tất cả"],
  ["Tải dữ liệu đầu vào", "Có – tác vụ được giao", "Không", "Quản lý dữ liệu mẫu"],
  ["Chạy AI phân tích", "Có – nếu trạng thái cho phép", "Không", "Không"],
  ["Chỉnh sửa kết quả", "Có – trước Submit", "Không", "Không"],
  ["Submit hoàn thành T12", "Có", "Không", "Không"],
  ["Xem lịch sử chạy AI", "Tác vụ được giao", "Theo phòng ban", "Toàn bộ"],
  ["Xem nhật ký hoạt động", "Không", "Không", "Có – chỉ xem, không sửa/xóa"],
  ["Quản lý tài khoản và vai trò", "Không", "Không", "Có"],
  ["Cập nhật needs_revision/approved + ghi chú", "Không", "Không", "Có – nhập kết quả G11 ngoài web"],
];
const duties: Record<Role, string> = {
  employee: "Người sử dụng chính tại T12; chỉ xử lý các tác vụ được giao cho tài khoản của mình. Không truy cập tác vụ của người khác, không quản lý tài khoản, không tự phê duyệt.",
  manager: "Chỉ xem tác vụ và kết quả thuộc phòng ban của mình ở chế độ chỉ đọc. Không chạy AI, không tải dữ liệu, không sửa kết quả; không phê duyệt hoặc thực hiện T14/G11 trên web.",
  admin: "Quản lý tài khoản, vai trò, tác vụ và dữ liệu mẫu; nhập needs_revision/approved cùng ghi chú theo quyết định G11 đã có ngoài web. Không tự đưa ra quyết định phê duyệt, không thay nhân viên phân tích.",
};
const purposes = [
  ["Bảo mật dữ liệu", "Nhân viên chỉ thấy tác vụ được giao, Trưởng phòng chỉ thấy phòng ban mình. Mọi API kiểm tra quyền theo từng mã tác vụ/lượt chạy, sửa mã trên URL cũng bị chặn."],
  ["Đảm bảo đúng trách nhiệm", "Chỉ nhân viên được giao mới tải dữ liệu, chạy AI, lưu và Submit tác vụ; mỗi tài khoản giữ đúng một vai trò."],
  ["Ngăn truy cập trái phép", "Mọi API kiểm tra phiên đăng nhập và vai trò ở backend. Tài khoản bị khóa mất phiên ngay; đăng nhập sai 5 lần bị chặn 15 phút."],
  ["Minh bạch và giải trình", "Đăng nhập, chạy AI, lưu kết quả, Submit, ghi nhận G11 và các lần bị từ chối truy cập đều được ghi vào nhật ký; Admin chỉ xem, không sửa/xóa."],
  ["Tránh xung đột quyền hạn", "Người làm không tự duyệt; Trưởng phòng quyết định G11 ngoài web và không sửa kết quả; Admin chỉ nhập lại quyết định đã có, không tự đổi vai trò hay tự khóa mình."],
];

export function RolesInfo({ role }: { role: Role }) {
  return <>
    <section className="card setup-card"><h2>Mục đích phân quyền</h2><div className="purpose-grid">{purposes.map(([title, text]) => <div key={title}><b>{title}</b><p>{text}</p></div>)}</div></section>
    <section className="card history-card"><div className="preview-title"><h2>Ma trận phân quyền</h2><span>Theo thiết kế phần mềm T12, mục 3.3</span></div><div className="table-scroll admin-table"><table><thead><tr><th>Chức năng</th>{roles.map(r => <th key={r} className={r === role ? "current-col" : ""}>{roleNames[r]}</th>)}</tr></thead><tbody>{matrix.map(([feature, ...cells]) => <tr key={feature}><td><b>{feature}</b></td>{cells.map((cell, i) => <td key={i} className={`${cell === "Không" ? "muted" : ""} ${roles[i] === role ? "current-col" : ""}`}>{cell}</td>)}</tr>)}</tbody></table></div></section>
    <div className="role-grid">{roles.map(key => <section key={key} className={`card setup-card ${key === role ? "current-role" : ""}`}><h2>{roleNames[key]}{key === role && <span className="badge">VAI TRÒ CỦA BẠN</span>}</h2><p className="fine-print">{duties[key]}</p></section>)}</div>
  </>;
}

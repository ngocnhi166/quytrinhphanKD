import { useCallback, useEffect, useState } from "react";

export type Role = "employee" | "manager" | "admin";
export type User = { id: number; username: string; full_name: string; phone: string; email: string; role: Role; department_id: number | null; department: string | null; active: number; created: number };
export type Summary = { mode?: string; columns: string[]; row_count: number; preview: Record<string, string>[]; metrics: { duplicate_rows: number; missing_values: Record<string, number>; numeric: Record<string, { sum: string; mean: string; min: string; max: string }> } };
export type Job = { id: string; filename: string; status: string; prompt: string; result?: string | null; result_html?: string | null; error: string | null; created: number; updated: number; summary: Summary; source?: string | null; edited_result?: string | null; edited_html?: string | null; edited?: number | null; owner?: string | null; task_id?: string | null; task_title?: string | null };
export type Dataset = { id: string; filename: string; created: number; row_count: number; columns: string[]; preview: Record<string, string>[] };
export type Task = { id: string; title: string; objective: string; requirements: string; department_id: number; department: string; assignee_id: number; assignee: string; status: string; result?: string | null; result_html?: string | null; selected_run_id: string | null; review_note: string | null; reviewer: string | null; created: number; updated: number; submitted: number | null; reviewed: number | null; datasets?: Dataset[] };
export type Department = { id: number; name: string; members: number };
export type AuditEntry = { id: number; at: number; username: string | null; action: string; target: string; detail: string };

export const roleNames: Record<Role, string> = { employee: "Nhân viên", manager: "Trưởng phòng", admin: "Quản trị viên" };
export const jobLabels: Record<string, string> = { queued: "Đang chờ", running: "Đang xử lý", succeeded: "Hoàn thành", failed: "Cần kiểm tra" };
export const taskLabels: Record<string, string> = { ready_for_analysis: "Sẵn sàng phân tích", in_progress: "Đang thực hiện", submitted: "Chờ phê duyệt", needs_revision: "Cần chỉnh sửa", approved: "Đã duyệt" };
// Reuses the job status colours: waiting, in progress, needs attention, done.
export const taskTone: Record<string, string> = { ready_for_analysis: "queued", in_progress: "running", submitted: "running", needs_revision: "failed", approved: "succeeded" };
export const OPEN = ["ready_for_analysis", "in_progress", "needs_revision"];
export const actionLabels: Record<string, string> = { history_remove: "Xóa lượt phân tích khỏi lịch sử", login: "Đăng nhập", login_failed: "Đăng nhập sai", logout: "Đăng xuất", denied: "Bị từ chối truy cập", user_create: "Tạo tài khoản", user_update: "Sửa tài khoản", user_delete: "Xóa tài khoản", department_create: "Tạo phòng ban", department_delete: "Xóa phòng ban", department_update: "Sửa phòng ban", dataset_create: "Thêm dữ liệu mẫu", dataset_delete: "Xóa dữ liệu mẫu", task_review: "Phê duyệt tác vụ", task_create: "Tạo tác vụ", task_delete: "Xóa tác vụ", task_update: "Sửa tác vụ", ai_run: "Chạy AI", run_edit: "Sửa kết quả AI", run_export: "Tải PDF kết quả AI", result_save: "Lưu kết quả", result_select: "Chọn kết quả tác vụ", submit_t12: "Submit T12", record_g11: "Ghi nhận quyết định G11" };
const fieldNames: Record<string, string> = { phone: "số điện thoại", email: "địa chỉ email", username: "tên đăng nhập (3–32 ký tự A-Z, a-z, 0-9, . _ -)", full_name: "họ tên", password: "mật khẩu (tối thiểu 8 ký tự)", title: "tiêu đề", objective: "mục tiêu", requirements: "yêu cầu phân tích", assignee_id: "người thực hiện", name: "tên phòng ban" };

export const when = (seconds: number) => new Date(seconds * 1000).toLocaleString("vi-VN");

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.detail;
    const message = typeof detail === "string" ? detail : Array.isArray(detail) ? `Kiểm tra lại ${[...new Set(detail.map((d: { loc: string[] }) => fieldNames[d.loc.at(-1) || ""] || d.loc.at(-1)))].join(", ")}.` : "Không kết nối được backend. Kiểm tra dịch vụ FastAPI.";
    throw new ApiError(message, response.status);
  }
  return body;
}

export function send<T>(path: string, method: string, body?: unknown) {
  return api<T>(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}

export function usePolling(load: () => void, ms = 0) {
  useEffect(() => {
    const timer = setTimeout(load, 0);
    const interval = ms ? setInterval(load, ms) : undefined;
    return () => { clearTimeout(timer); clearInterval(interval); };
  }, [load, ms]);
}

export function useApi<T>(path: string, ms = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try { setData(await api<T>(path)); setError(""); }
    catch (e) { setError((e as Error).message); }
  }, [path]);
  usePolling(reload, ms);
  return { data, error, reload };
}

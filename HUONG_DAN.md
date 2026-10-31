# T12 Studio — phân tích CSV/XLSX qua ChatGPT trên trình duyệt

Ứng dụng chạy trên Windows tại máy cá nhân, gồm frontend Next.js, backend FastAPI và extension Chrome/Edge Manifest V3. Extension tham khảo luồng mở tab → inject → nhận kết quả → lưu → đóng tab của `D:\web\etsy_tool_TT_local\local_ai_runner.js`. Extension gốc không bị sửa và ứng dụng không kết nối các máy chủ Etsy của extension gốc.

## Chạy lần đầu

Yêu cầu: Node.js 20.9 trở lên, Python 3.12 trở lên, Chrome/Edge 116 trở lên.

Từ thư mục `D:\web\my-website`, mở hai terminal:

Terminal 1 — backend:

```powershell
.\start-backend.cmd
```

Terminal 2 — frontend:

```powershell
.\start-frontend.cmd
```

Mở http://127.0.0.1:3000. Backend ở http://127.0.0.1:8000; tài liệu API ở http://127.0.0.1:8000/docs. Dùng `npm.cmd` khi PowerShell chặn `npm.ps1`. Không đổi frontend sang cổng khác nếu chưa cập nhật danh sách origin được phép ở backend.

Nếu đã có môi trường và thư viện, có thể chạy `npm.cmd run backend` và `npm.cmd run dev` thay cho hai tệp khởi động.

## Cài extension một lần

1. Mở Chrome hoặc Edge với hồ sơ đã đăng nhập ChatGPT.
2. Mở `chrome://extensions` hoặc `edge://extensions`.
3. Bật **Developer mode / Chế độ nhà phát triển**.
4. Chọn **Load unpacked / Tải tiện ích đã giải nén**, chọn `D:\web\my-website\extension`.
5. Trên website, chọn **Kết nối trình duyệt**, sao chép mã kết nối.
6. Mở popup extension **T12 Studio**, dán mã, nhấn **Lưu và kết nối**.
7. Website hiển thị extension đã kết nối. Mở ChatGPT kiểm tra đã đăng nhập và tài khoản tải được tệp.

Không cần cung cấp mật khẩu, cookie hoặc API key. Extension sử dụng phiên đăng nhập của hồ sơ trình duyệt đang cài nó. Nếu thay đổi mã extension, nhấn Reload tại trang quản lý tiện ích.

## Sử dụng

1. Chọn CSV UTF-8 hoặc XLSX (tối đa 4 MB, 10.000 dòng, 50 cột, 1.000 ký tự mỗi ô). `.xls`/`.xlsl` không được hỗ trợ; lưu lại thành `.xlsx`.
2. Kiểm tra bảng xem trước. Với XLSX, chỉ đọc sheet đầu tiên, dùng giá trị đã lưu; không chạy công thức/macro.
3. Nhập yêu cầu phân tích hoặc chọn câu hỏi gợi ý.
4. Nhấn **Bắt đầu phân tích**. Extension mở tab ChatGPT mới, đính kèm **tệp gốc** và nhập câu hỏi cùng thống kê backend.
5. Extension đợi phản hồi hoàn tất rồi gửi văn bản về backend. Tab chỉ tự đóng khi SQLite đã lưu kết quả và backend gửi xác nhận.
6. Xem, sao chép hoặc tải kết quả Markdown. Lịch sử được giữ sau khi tải lại trang hoặc khởi động lại ứng dụng.

Các lượt chạy được xếp hàng tuần tự. Khi thất bại, tab được giữ lại để kiểm tra. Mất kết nối không tự gửi lại prompt để tránh xử lý trùng. Hãy sửa nguyên nhân rồi tạo lượt mới. Backend đánh dấu lượt chạy bị gián đoạn khi khởi động lại; thời gian chờ tối đa 15 phút, chờ phản hồi ChatGPT tối đa 12 phút.

## Cấu trúc

```text
frontend/
  app/page.tsx          Giao diện tải tệp, prompt, kết quả, lịch sử, kết nối
  app/globals.css       Giao diện responsive
  app/layout.tsx        Metadata và layout
  next.config.ts        Proxy /api đến FastAPI
backend/
  app/main.py           REST API, WebSocket, hàng đợi, lưu SQLite
  app/data.py           Kiểm tra CSV/XLSX, xem trước, thống kê
  requirements.txt
  tests/test_api.py
  data/                 Tự tạo, bị loại khỏi Git
extension/
  manifest.json
  background.js         WebSocket, tạo tab, điều phối, đóng tab sau lưu
  chatgpt.js            Đính kèm tệp, điền prompt, nhận phản hồi
  popup.html / popup.js Ghép nối với backend
  tests/lifecycle.test.cjs
start-backend.cmd
start-frontend.cmd
```

`node_modules` được cài ở thư mục gốc; các lệnh npm tại gốc chuyển tiếp vào frontend. Có thể cài frontend độc lập bằng `npm.cmd ci` trong thư mục frontend.

## Kiểm thử

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s backend\tests -v
node --test extension\tests\lifecycle.test.cjs
npm.cmd run build
```

Bộ kiểm thử bao gồm đọc CSV/XLSX, tệp lỗi, dữ liệu mẫu 60 dòng với tổng doanh thu 5.668.500.000, origin không được phép, token sai, hàng đợi, lưu kết quả và chỉ đóng tab sau xác nhận lưu. Kiểm thử extension mô phỏng trình duyệt; không thay thế chạy thật trên tài khoản ChatGPT.

## Phạm vi và giới hạn

- “Local” là website/backend và trình duyệt chạy tại máy; ChatGPT vẫn xử lý trên dịch vụ trực tuyến. **Tệp gốc được tải lên ChatGPT**, khác với thiết kế T12 ban đầu chỉ gửi thống kê và mẫu. Chỉ dùng dữ liệu bạn được phép tải lên.
- Đóng tab không xóa cuộc hội thoại hoặc tệp trên tài khoản ChatGPT.
- Không dùng API riêng tư của ChatGPT, không lấy cookie, không vượt CAPTCHA/giới hạn tài khoản. Nếu có CAPTCHA hoặc yêu cầu đăng nhập, người dùng hoàn tất trong trình duyệt.
- Tự động hóa dựa trên DOM. Khi ChatGPT đổi nút đính kèm, ô nhập hoặc dấu hiệu hoàn tất, cần cập nhật selector trong `extension/chatgpt.js`. Có timeout và thông báo lỗi; không khẳng định hỗ trợ mọi phiên bản giao diện.
- Backend cung cấp thống kê tổng quát theo cột: ô thiếu, dòng trùng hoàn toàn, tổng/trung bình/min/max cột số và số lượng theo nhóm. Đây chưa phải toàn bộ nghiệp vụ T12 trong tài liệu (phân quyền Employee/Manager/Admin, duyệt/làm lại, IQR doanh thu và đối chiếu evidence chưa triển khai).
- Phản hồi AI được lưu dưới dạng văn bản; người dùng cần kiểm tra lại số liệu. Kết quả không được tự động xác thực theo schema báo cáo T12.
- Thiết kế dùng cho **một máy cá nhân**, không triển khai công khai backend. Chỉ chạy một worker Uvicorn vì kết nối extension/hàng đợi điều phối trong tiến trình.
- SQLite giữ tệp gốc, prompt, thống kê và kết quả trong `backend/data/studio.sqlite3`; mã ghép nối ở `backend/data/bridge.key`. Không chia sẻ các tệp này và không đưa lên Git.
- Lần chạy thật với ChatGPT cần nạp extension và đăng nhập trong đúng hồ sơ trình duyệt; kiểm thử tự động không sử dụng tài khoản đăng nhập của bạn.

## Xử lý lỗi thường gặp

- **Backend chưa chạy:** mở `start-backend.cmd`; kiểm tra cổng 8000.
- **Chưa kết nối extension:** chạy backend trước, kiểm tra mã ghép nối, chỉ dùng một extension kết nối với backend này.
- **Không thấy ô nhập/nút đính kèm:** kiểm tra đăng nhập, hạn mức tài khoản và giao diện ChatGPT; mở tab được giữ lại để đọc lỗi.
- **XLSX chưa có giá trị công thức:** mở Excel, tính lại và lưu trước khi tải lên.
- **Lỗi mã hóa CSV:** lưu CSV UTF-8. Header không được trống/trùng, số ô mỗi dòng phải khớp số cột.

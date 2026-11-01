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

## Đăng nhập và phân quyền

Lần chạy backend đầu tiên tạo phòng ban "Phòng Kinh doanh" và ba tài khoản `admin`, `truongphong`, `nhanvien` với mật khẩu ngẫu nhiên, lưu trong `backend/data/initial-accounts.txt`. Đăng nhập Admin để đặt lại mật khẩu, tạo thêm tài khoản và phòng ban. Mỗi tài khoản có đúng một vai trò; menu và API đều theo vai trò đó. Quyền được làm theo ma trận mục 3.3 và mục 7.2 của tài liệu thiết kế phần mềm T12 (TO-BE mới); trang **Phân quyền** trên web hiển thị lại ma trận này.

| Vai trò | Được phép | Không được |
|---|---|---|
| Nhân viên | Xem tác vụ được giao (mục tiêu, yêu cầu, ghi chú chỉnh sửa); chọn dữ liệu mẫu của tác vụ hoặc tải tệp cho tác vụ; chạy AI khi tác vụ ở `ready_for_analysis`, `in_progress` hoặc `needs_revision`; kiểm tra, sửa, lưu kết quả trước Submit; xem lịch sử chạy AI của tác vụ được giao; Submit hoàn thành T12 | Truy cập tác vụ không được giao, quản lý tài khoản, tự phê duyệt |
| Trưởng phòng | Xem tác vụ, kết quả và lịch sử chạy AI của phòng ban mình ở chế độ chỉ đọc | Tải dữ liệu, chạy AI, sửa kết quả, Submit. Quyết định T14/G11 thực hiện ngoài web |
| Admin | Tạo/sửa/khóa tài khoản, đổi vai trò và phòng ban; giao và sửa tác vụ; quản lý dữ liệu mẫu; xem chi tiết mọi tác vụ và toàn bộ lịch sử chạy AI; xem nhật ký hoạt động (chỉ xem, không sửa/xóa); ghi nhận `approved`/`needs_revision` và ghi chú theo quyết định đã có của Trưởng phòng tại G11 | Tự quyết định phê duyệt, chạy AI, sửa kết quả hoặc Submit thay nhân viên |

Mục đích và cách thực hiện:

- **Bảo mật dữ liệu:** nhân viên chỉ thấy tác vụ, dữ liệu và lượt chạy của tác vụ được giao; Trưởng phòng chỉ thấy phòng ban mình. Mọi API kiểm tra quyền theo từng mã tác vụ/lượt chạy (chống sửa mã trên URL). Mật khẩu băm scrypt; phiên đăng nhập là cookie HttpOnly, SameSite=Strict, hết hạn sau 12 giờ.
- **Đúng trách nhiệm:** chỉ nhân viên được giao mới tải dữ liệu, chạy AI, lưu và Submit tác vụ; mỗi lượt chạy AI luôn gắn với một tác vụ. Sau Submit, kết quả bị khóa cho đến khi G11 yêu cầu chỉnh sửa; chạy lại sau `needs_revision` đưa tác vụ về `in_progress` và giữ nguyên các lượt trước.
- **Ngăn truy cập trái phép:** mọi API kiểm tra phiên và vai trò ở backend, không chỉ ẩn nút trên giao diện. Khóa tài khoản, đổi vai trò hoặc đặt lại mật khẩu sẽ thu hồi phiên ngay. Đăng nhập sai 5 lần trong 15 phút sẽ bị chặn tạm thời.
- **Minh bạch và giải trình:** đăng nhập, chạy AI, lưu kết quả, Submit, giao tác vụ, ghi nhận G11, thay đổi tài khoản và mọi lần bị từ chối truy cập đều được ghi vào **Nhật ký hoạt động**.
- **Tránh xung đột quyền hạn:** người làm không tự duyệt; Trưởng phòng quyết định nhưng không sửa kết quả; Admin chỉ ghi nhận quyết định đã có (phải tích xác nhận) và không thể tự đổi vai trò hay tự khóa mình. Tác vụ đã Submit hoặc đã duyệt không sửa được.

## Sử dụng

1. **Admin** thêm dữ liệu mẫu (nếu có), vào **Quản lý tác vụ** → **Giao tác vụ mới**: nhập tiêu đề, mục tiêu, yêu cầu phân tích, chọn nhân viên và dữ liệu mẫu được phép.
2. **Nhân viên** mở tác vụ trong **Tác vụ của tôi**, chọn dữ liệu mẫu hoặc tải CSV UTF-8/XLSX (tối đa 4 MB, 10.000 dòng, 50 cột, 1.000 ký tự mỗi ô; chỉ đọc sheet đầu tiên của XLSX, không chạy công thức/macro).
3. Nhập câu hỏi, nhấn **Chạy AI Agent**. Extension mở tab ChatGPT mới, đính kèm **tệp gốc** và nhập câu hỏi cùng thống kê backend; tab chỉ tự đóng khi SQLite đã lưu kết quả.
4. Ở lượt chạy phù hợp, nhấn **Dùng làm kết quả tác vụ**: lượt chạy đó trở thành kết quả T12 và hiện nguyên báo cáo (bảng, biểu đồ) ở mục **03 Kết quả tác vụ**; có thể đổi sang lượt khác bằng ô **Lượt chạy làm kết quả**. Nhấn **Chỉnh sửa ✎** để sửa trực tiếp trên báo cáo (bấm vào chữ hoặc ô trong bảng) rồi **Xong · lưu chỉnh sửa**; bản AI gốc vẫn giữ và xem lại được, chỉ người được giao sửa được, trước khi Submit. **Tải PDF ↓** tải báo cáo (bản đã chỉnh sửa nếu có). Cuối cùng nhấn **Submit xác nhận hoàn thành T12**: lượt chạy đã chọn (bản chỉnh sửa nếu có) được chốt làm đầu ra cho T13.
5. **Trưởng phòng** xem tác vụ, kết quả đã lưu và các lượt chạy AI trong **Tác vụ phòng ban**, rồi đưa ra quyết định G11 ngoài web.
6. **Admin** mở tác vụ đã Submit, chọn `approved` hoặc `needs_revision`, ghi chú theo quyết định của Trưởng phòng và xác nhận. Với `needs_revision`, nhân viên thấy ghi chú, sửa và Submit lại.

Các lượt chạy được xếp hàng tuần tự. Khi thất bại, tab được giữ lại để kiểm tra. Mất kết nối không tự gửi lại prompt để tránh xử lý trùng. Hãy sửa nguyên nhân rồi tạo lượt mới. Backend đánh dấu lượt chạy bị gián đoạn khi khởi động lại; thời gian chờ tối đa 15 phút, chờ phản hồi ChatGPT tối đa 12 phút.

## Cấu trúc

```text
frontend/
  app/page.tsx          Đăng nhập, menu theo vai trò, điều hướng
  app/workspace.tsx     Nhân viên thực hiện T12: dữ liệu, chạy AI, lưu, Submit
  app/views.tsx         Trưởng phòng xem tác vụ; lịch sử chạy AI; trang Phân quyền
  app/admin.tsx         Tài khoản, phòng ban, tác vụ, ghi nhận G11, dữ liệu mẫu, nhật ký
  app/ui.tsx, lib.ts    Thành phần dùng chung, gọi API, nhãn trạng thái
  app/globals.css       Giao diện responsive
  app/layout.tsx        Metadata và layout
  next.config.ts        Proxy /api đến FastAPI
backend/
  app/main.py           Chạy AI, WebSocket, hàng đợi, lịch sử theo vai trò
  app/access.py         Đăng nhập, phiên, kiểm tra vai trò, tài khoản, tác vụ, dữ liệu mẫu, nhật ký
  app/store.py          SQLite, tạo bảng, tài khoản khởi tạo
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
node --test extension\tests\composer.test.cjs extension\tests\conversation.test.cjs extension\tests\lifecycle.test.cjs
npm.cmd run build
```

Bộ kiểm thử bao gồm đọc CSV/XLSX, tệp lỗi, dữ liệu mẫu 60 dòng với tổng doanh thu 5.668.500.000, origin không được phép, token sai, hàng đợi, lưu kết quả và chỉ đóng tab sau xác nhận lưu. Phần phân quyền kiểm thử: bắt buộc đăng nhập, mỗi vai trò bị từ chối ngoài nhiệm vụ, phạm vi theo người được giao và phòng ban, luồng T12 → G11 (needs_revision → Submit lại → approved), khóa tài khoản thu hồi phiên, Admin không tự khóa/tự đổi vai trò, chặn đăng nhập sai nhiều lần. Kiểm thử extension mô phỏng trình duyệt; không thay thế chạy thật trên tài khoản ChatGPT.

## Phạm vi và giới hạn

- “Local” là website/backend và trình duyệt chạy tại máy; ChatGPT vẫn xử lý trên dịch vụ trực tuyến. **Tệp gốc được tải lên ChatGPT**, khác với thiết kế T12 ban đầu chỉ gửi thống kê và mẫu. Chỉ dùng dữ liệu bạn được phép tải lên.
- Đóng tab không xóa cuộc hội thoại hoặc tệp trên tài khoản ChatGPT.
- Không dùng API riêng tư của ChatGPT, không lấy cookie, không vượt CAPTCHA/giới hạn tài khoản. Nếu có CAPTCHA hoặc yêu cầu đăng nhập, người dùng hoàn tất trong trình duyệt.
- Tự động hóa dựa trên DOM. Khi ChatGPT đổi nút đính kèm, ô nhập hoặc dấu hiệu hoàn tất, cần cập nhật selector trong `extension/chatgpt.js`. Có timeout và thông báo lỗi; không khẳng định hỗ trợ mọi phiên bản giao diện.
- Backend cung cấp thống kê tổng quát theo cột: ô thiếu, dòng trùng hoàn toàn, tổng/trung bình/min/max cột số và số lượng theo nhóm. Phân quyền Nhân viên/Trưởng phòng/Admin và luồng Submit T12 → ghi nhận G11 đã có; IQR doanh thu và đối chiếu evidence chưa triển khai.
- Các lượt chạy tạo trước khi có phân quyền (hoặc trong bản thử nghiệm Phân tích cá nhân) không gắn với tác vụ nào; chỉ Admin thấy chúng trong Lịch sử chạy AI.
- Tải PDF dùng Microsoft Edge (có sẵn trên Windows) hoặc Google Chrome đã cài trên máy để in báo cáo, nên PDF giống hệt báo cáo trên màn hình. Có thể chỉ định trình duyệt khác bằng biến môi trường `T12_PDF_BROWSER`. Đây là bản tải về của một lượt chạy, không thay thế bước T13 xuất báo cáo PDF tự động (ngoài phạm vi web).
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

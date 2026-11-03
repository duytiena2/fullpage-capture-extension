# FullPage Screen Capture & Crop Extension (Chrome Manifest V3)

Chrome Extension mã nguồn mở mô phỏng và cải tiến các tính năng cốt lõi của **GoFullPage**:
1. **Chụp cuộn toàn bộ trang web (Full Page Scrolling Capture)**: Tự động tính toán chiều cao toàn trang, ẩn thanh cuộn để ảnh sạch đẹp, cuộn từng khung hình và chụp lại với độ phân giải gốc (DPR support).
2. **Trình biên tập & Cắt ảnh tương tác (Interactive Crop Tool)**: Sau khi chụp, tự động mở trang biên tập riêng biệt. Cho phép kéo chọn vùng cắt với 8 điểm neo tùy chỉnh (resize handles), lưới tỉ lệ 1/3 (rule of thirds) và tính năng khôi phục ảnh gốc (Non-destructive).
3. **Xuất file đa dạng & Sao chép nhanh**:
   - Tải về **PNG** chất lượng gốc sắc nét.
   - Tải về **JPG** tối ưu dung lượng (loại bỏ artifact nền trong suốt).
   - Xuất file **PDF** tiện lợi cho in ấn và lưu trữ tài liệu.
   - **Sao chép (Copy to Clipboard)** 1-click để paste ngay vào Zalo, Telegram, Slack, Word, v.v.
4. **Giảm bộ nhớ khi chụp ảnh dài**: Lưu từng khung PNG vào IndexedDB, ghép từng lát và giữ bản khôi phục dưới dạng PNG nén. Giới hạn an toàn: 64 megapixel, tối đa 32.767 pixel mỗi chiều; trang tải liên tục được giới hạn 120 giây.

---

## Cấu trúc thư mục

```
fullpage-capture-extension/
├── manifest.json         # Khai báo cấu hình Extension (Manifest V3)
├── background.js         # Service Worker điều phối chụp màn hình & quản lý tab
├── icons/                # Bộ biểu tượng ứng dụng (16x16, 48x48, 128x128)
├── lib/
│   └── db.js             # IndexedDB wrapper lưu trữ dữ liệu ảnh phân giải cao
├── content/
│   └── capture.js        # Script cuộn trang mượt mà & hiển thị thanh tiến trình
├── popup/
│   ├── popup.html        # Giao diện menu khi click icon extension
│   ├── popup.css         # Styling menu popup
│   └── popup.js          # Logic kích hoạt chụp từ popup
├── editor/
│   ├── editor.html       # Trang xem và chỉnh sửa ảnh chụp toàn màn hình
│   ├── editor.css        # Giao diện Dark theme chuyên nghiệp, hiện đại
│   └── editor.js         # Ghép lát cắt (Stitching), Zoom, Crop, Copy & Export
└── README.md
```

---

## Hướng dẫn cài đặt vào Chrome (Chế độ Developer)

1. Mở trình duyệt Chrome hoặc các trình duyệt nhân Chromium (Edge, Brave, Cốc Cốc...).
2. Truy cập vào trang quản lý tiện ích: `chrome://extensions/`.
3. Bật công tắc **Chế độ dành cho nhà phát triển (Developer mode)** ở góc trên bên phải.
4. Bấm nút **Tải tiện ích đã giải nén (Load unpacked)** ở góc trên bên trái.
5. Chọn thư mục dự án:
   ```
   /home/tientran/projects/fullpage-capture-extension
   ```
6. Biểu tượng **FullPage Capture** sẽ xuất hiện trên thanh tiện ích của Chrome (bạn có thể ghim - Pin lên thanh công cụ để tiện dùng).

---

## Hướng dẫn sử dụng

1. Mở bất kỳ trang web nào bạn muốn chụp (ví dụ: bài báo, trang sản phẩm thương mại điện tử, dashboard...).
2. Nhấp vào biểu tượng tiện ích trên thanh công cụ trình duyệt.
3. Chọn một trong 3 chế độ:
   - **Chụp toàn bộ trang web**: Tiện ích sẽ tự động cuộn mượt mà từ đầu trang xuống chân trang, hiển thị tiến trình % trực quan, sau đó tự động ghép các khung hình lại thành 1 ảnh duy nhất và mở tab Editor.
   - **Chụp vùng đang xem**: Chụp nhanh ngay lập tức phần trang đang hiển thị.
   - **Chụp vùng cuộn trong trang**: Di chuột để tô sáng và bấm vào bảng/panel có thanh cuộn. Đưa toàn bộ panel vào màn hình trước khi chọn. Tiện ích chụp nội dung bên trong và khôi phục vị trí cuộn sau khi xong.
   - Bấm **Hủy** hoặc **Esc** để dừng. Giữ tab nguồn đang được chọn trong cửa sổ của nó; đổi tab, ẩn trang, chuyển tab nguồn sang cửa sổ khác hoặc đổi kích thước màn hình sẽ dừng phiên chụp. Mất tiêu điểm do popup hay thao tác với cửa sổ khác không tự hủy phiên chụp.
4. Tại tab **Editor**:
   - **Zoom**: Dùng nút `+`, `-`, `Vừa màn hình` hoặc giữ `Ctrl + Lăn chuột`.
   - **Cắt ảnh (Crop)**: Bấm nút **Cắt ảnh (Crop)** -> Kéo thả khung chọn hoặc rê chuột vào 8 nút neo ở các cạnh/góc để điều chỉnh kích thước chính xác -> Bấm **Áp dụng cắt**.
   - Nếu muốn hoàn tác, bấm **Khôi phục gốc**.
   - **Tải ảnh / Sao chép**: Chọn **Tải PNG**, **JPG**, **PDF** hoặc bấm **Sao chép** để copy vào clipboard.
   - **Crop ảnh dài**: Vùng chọn ban đầu ôm toàn bộ ảnh. Kéo bất kỳ điểm nào trên cạnh; giữ chuột sát mép vùng làm việc để tự cuộn. **Esc** thoát crop.
   - **PDF** tải trực tiếp, chia trang A4 với ảnh JPEG chất lượng 92%; không mở cửa sổ in.

## Kiểm thử

Cần Node.js 18+ và Google Chrome đã cài. Không cần build để nạp extension.

```sh
npm install
npm test
```

Windows mặc định dùng Chrome tại `C:/Program Files/Google/Chrome/Application/chrome.exe`. Nếu Chrome ở vị trí khác, đặt biến môi trường `CHROME_PATH` trỏ đến file thực thi.

Các test chạy Chrome headless trên trang mẫu: header fixed/sticky, nội dung tăng khi cuộn, chọn panel, Hủy/Esc, crop/zoom/tự cuộn, xuất PNG/JPG/PDF dưới CSP và nâng cấp IndexedDB. Test service worker giả lập Chrome API để kiểm tra chuyển tab/cửa sổ và lưu từng khung. Đây không phải kiểm thử toàn bộ API extension trong profile Chrome thật.

Ảnh cũ vẫn đọc được. Không bổ sung lịch sử, màn hình quản lý ảnh hoặc chính sách tự xóa ảnh đã chụp.

Chưa hỗ trợ chọn vùng cuộn bên trong iframe hoặc shadow DOM. Trang tải ảnh quá chậm có thể chưa hiện hết: mỗi khung chờ tối đa 2,5 giây để tránh treo phiên chụp.

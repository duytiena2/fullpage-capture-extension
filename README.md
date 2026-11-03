# FullPage Screen Capture & Crop Extension (Chrome Manifest V3)

Chrome Extension mã nguồn mở mô phỏng và cải tiến các tính năng cốt lõi của **GoFullPage**:
1. **Chụp cuộn toàn bộ trang web (Full Page Scrolling Capture)**: Tự động tính toán chiều cao toàn trang, ẩn thanh cuộn để ảnh sạch đẹp, cuộn từng khung hình và chụp lại với độ phân giải gốc (DPR support).
2. **Trình biên tập & Cắt ảnh tương tác (Interactive Crop Tool)**: Sau khi chụp, tự động mở trang biên tập riêng biệt. Cho phép kéo chọn vùng cắt với 8 điểm neo tùy chỉnh (resize handles), lưới tỉ lệ 1/3 (rule of thirds) và tính năng khôi phục ảnh gốc (Non-destructive).
3. **Xuất file đa dạng & Sao chép nhanh**:
   - Tải về **PNG** chất lượng gốc sắc nét.
   - Tải về **JPG** tối ưu dung lượng (loại bỏ artifact nền trong suốt).
   - Xuất file **PDF** tiện lợi cho in ấn và lưu trữ tài liệu.
   - **Sao chép (Copy to Clipboard)** 1-click để paste ngay vào Zalo, Telegram, Slack, Word, v.v.
4. **Lưu trữ ảnh siêu lớn không giới hạn**: Sử dụng IndexedDB thay vì quota hạn hẹp của `chrome.storage.local`, đảm bảo chụp được cả những trang web cực dài mà không bị tràn bộ nhớ.

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
3. Chọn một trong 2 chế độ:
   - **Chụp toàn bộ trang web**: Tiện ích sẽ tự động cuộn mượt mà từ đầu trang xuống chân trang, hiển thị tiến trình % trực quan, sau đó tự động ghép các khung hình lại thành 1 ảnh duy nhất và mở tab Editor.
   - **Chụp vùng đang xem**: Chụp nhanh ngay lập tức phần trang đang hiển thị.
4. Tại tab **Editor**:
   - **Zoom**: Dùng nút `+`, `-`, `Vừa màn hình` hoặc giữ `Ctrl + Lăn chuột`.
   - **Cắt ảnh (Crop)**: Bấm nút **Cắt ảnh (Crop)** -> Kéo thả khung chọn hoặc rê chuột vào 8 nút neo ở các cạnh/góc để điều chỉnh kích thước chính xác -> Bấm **Áp dụng cắt**.
   - Nếu muốn hoàn tác, bấm **Khôi phục gốc**.
   - **Tải ảnh / Sao chép**: Chọn **Tải PNG**, **JPG**, **PDF** hoặc bấm **Sao chép** để copy vào clipboard.

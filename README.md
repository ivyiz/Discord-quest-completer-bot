# 🤖 Ivyseal DQC Discord Bot 🚀

> Bot Discord hỗ trợ thành viên trong server **Tự Động Làm Quest Discord**, tích lũy Orbs để đổi vật phẩm trang trí hồ sơ (Avatar Decoration / Effects) thông qua lệnh Slash Command **`/dqcspawn`**.

---

## 🌟 Tính Năng Chính

1. **Lệnh Slash Command `/dqcspawn`**:
   - Quản trị viên hoặc thành viên chỉ cần gõ `/dqcspawn` trong kênh bất kỳ để triệu hồi bảng điều khiển của Ivyseal.
2. **Embed Giao Diện Tuyệt Đẹp**:
   - Tiêu đề: **✨ Tự Động Làm Quest Của Ivyseal**
   - Mô tả: **🎯 Tự động hoàn thành quest, nhận Orb để đổi decor dễ hơn**
   - Cảnh báo: **⚠️ Lưu ý : Khi sử dụng dịch vụ này, chúng mình không chịu trách nhiệm cho bất cứ điều gì xảy ra trong tài khoản của các bạn**
3. **Bảo Mật Tuyệt Đối Bằng Discord Modal (Ephemeral)**:
   - Khi bấm **"🚀 Bắt Đầu Làm Quest"**, Discord sẽ bật lên một khung popup bí mật để thành viên nhập Token.
   - **Chỉ duy nhất người đó nhìn thấy**, không bao giờ bị lộ token vào kênh chat chung của server!
4. **Cập Nhật Tiến Trình Thời Gian Thực**:
   - Hiển thị thanh tiến trình trực quan ngay trong tin nhắn: `[████████░░] 80% (12/15 phút)`.
   - Tự động nhận thưởng và xuất Gift Code ngay khi hoàn thành.

---

## 📂 Cấu Trúc Thư Mục

Thư mục: `C:\Users\kabir\.gemini\antigravity-ide\scratch\ivyseal-dqc-bot`

| Tệp tin | Chức năng |
| :--- | :--- |
| **`index.js`** | Mã nguồn chính của Bot Discord (xử lý slash command `/dqcspawn`, embed, buttons, modal). |
| **`quest-engine.js`** | Động cơ cày Quest kế thừa từ `dqc.txt` (Orion API, heartbeat 30s, auto-claim). |
| **`config.json`** | Chứa `botToken`, `clientId` và `guildId` (tùy chọn). |
| **`Start-Ivyseal-Bot.bat`** | File khởi động nhanh bot trên Windows. |

---

## 🔑 Hướng Dẫn Thiết Lập Bot (Trong 2 Phút)

### Bước 1: Tạo Bot trên Discord Developer Portal
1. Truy cập [Discord Developer Portal](https://discord.com/developers/applications).
2. Nhấn nút **"New Application"**, đặt tên cho bot (ví dụ: `Ivyseal DQC`).
3. Vào mục **Bot** ở menu bên trái:
   - Bấm **"Reset Token"** để lấy **Bot Token** của bạn.
4. Vào mục **General Information**:
   - Copy **Application ID** (đây là `clientId`).
5. Vào mục **OAuth2 > URL Generator**:
   - Chọn scope: `bot` và `applications.commands`.
   - Chọn Bot Permissions: `Send Messages`, `Embed Links`, `Attach Files`, `Use External Emojis`.
   - Copy link phía dưới và mở trên trình duyệt để mời Bot vào Discord Server của bạn.

### Bước 2: Điền thông tin vào `config.json`
Mở file `config.json` và dán thông tin vừa lấy:
```json
{
  "botToken": "DÁN_BOT_TOKEN_CỦA_BẠN_VÀO_ĐÂY",
  "clientId": "DÁN_APPLICATION_ID_VÀO_ĐÂY",
  "guildId": "ID_SERVER_CỦA_BẠN_ĐỂ_CẬP_NHẬT_LỆNH_NGAY_LẬP_TỨC"
}
```
*(Nếu để trống `guildId`, bot sẽ đăng ký lệnh toàn cầu mất khoảng vài phút).*

### Bước 3: Khởi chạy Bot
Chỉ cần click đúp vào file **`Start-Ivyseal-Bot.bat`** (hoặc mở terminal gõ `node index.js`).

---

## 🎮 Cách Sử Dụng Trong Server

1. Vào kênh chat trong Discord Server của bạn.
2. Gõ lệnh:
   ```text
   /dqcspawn
   ```
3. Bot sẽ gửi ngay Embed của Ivyseal kèm 3 nút bấm tương tác:
   - **`🚀 Bắt Đầu Làm Quest`**: Nhập token và tự động cày nhiệm vụ.
   - **`📖 Hướng Dẫn Lấy Token`**: Hướng dẫn thành viên lấy token trong 5 giây.
   - **`📋 Xem Danh Sách Quest`**: Liệt kê các quest hiện có của tài khoản.

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
   - Tự động hoàn thành và nhắc nhở thành viên vào Discord nhận thưởng an toàn.
   - Thành viên cần liên hệ **@ivy.ls** để được cấp quyền whitelist tài khoản trước khi cày.

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

## 🎮 Danh Sách Slash Commands
- **`/dqcspawn`**: Triệu hồi bảng điều khiển cày ọp (kèm 3 nút: Cày Ọp, Xem Danh Sách Quest, Hướng dẫn lấy token).
- **`/quests`**: Xem danh sách nhiệm vụ Discord, trạng thái và tổng Orb có thể cày của tài khoản.
- **`/whitelist`**: Thêm hoặc cập nhật tài khoản vào whitelist qua Modal bí mật (tự động mã hóa AES-256-GCM).
- **`/unwhitelist [user]`**: Xóa tài khoản khỏi whitelist (thành viên chỉ có thể xóa chính mình, Admin có thể chọn xóa người khác).
- **`/whitelisted`**: Xem danh sách các tài khoản đã được whitelist trong hệ thống (*Chỉ Quản trị viên*).
- **`/autoschedule <ngay> [gio]`**: Lên lịch tự động cày ọp hàng tuần với tùy chọn giờ chạy và hàng đợi song song (*Chỉ Quản trị viên*).

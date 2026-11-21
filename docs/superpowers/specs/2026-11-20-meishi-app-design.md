# Meishi App — Thiết kế (v1)

Ngày: 2026-11-20 · Trạng thái: chờ duyệt

## 1. Mục tiêu & phạm vi

Web-app quản lý danh thiếp cho **1 người dùng, nhiều thiết bị** (chủ yếu điện thoại).
Input là ảnh chụp danh thiếp bằng camera điện thoại. Không có server riêng, chỉ dùng dịch vụ free.

Trong phạm vi v1:
- Chụp ảnh danh thiếp (mặt trước, tùy chọn mặt sau) → Gemini đọc ra các trường.
- Danh sách, tìm kiếm, lọc theo tag / trạng thái; xem chi tiết, sửa, xóa.
- Trang tĩnh **Từ điển chức danh** Nhật ↔ Việt (↔ Anh), tìm kiếm được.
- Hành động nhanh: gọi, mail, mở bản đồ, copy, xuất vCard vào danh bạ.
- **Sơ đồ tổ chức** theo công ty, dựng từ danh thiếp đã có + chỉnh tay, tô nổi vị trí 1 người.
- Đồng bộ đa thiết bị qua GitHub repo private; dùng được offline.
- Xuất CSV / vCard toàn bộ.

Ngoài phạm vi v1: nhiều người dùng / chia sẻ, Claude OCR, tự tra sơ đồ tổ chức trên internet,
tự động cắt viền ảnh (chỉ có xoay), lịch sử chuyển công ty của 1 người.

## 2. Kiến trúc

```
 Điện thoại / PC — SPA (PWA, cài lên màn hình chính)
   │  IndexedDB (Dexie): cache toàn bộ dữ liệu + hàng đợi ghi khi offline
   ├──► Gemini API (key của người dùng) ── đọc ảnh → JSON
   └──► GitHub REST API ──► repo PRIVATE "meishi-data" (nguồn dữ liệu chính)

 Code app: repo riêng → GitHub Actions build → GitHub Pages (không chứa dữ liệu, không chứa secret)
```

Công nghệ: Vite + Vue 3 (Composition API) + Vue Router (hash mode) + Dexie + vite-plugin-pwa. Test: Vitest.

## 3. Lưu trữ

### 3.1 Cấu trúc repo `meishi-data`
```
cards/{cardId}.json
companies/{companyId}.json
images/{cardId}-front.jpg
images/{cardId}-back.jpg      (tùy chọn)
```
- `cardId` = `YYYYMMDD-` + 6 ký tự ngẫu nhiên. `companyId` = `c-` + 8 ký tự ngẫu nhiên.
- Ảnh: resize cạnh dài 1600px, JPEG q=0.8 (~200–300KB). Thumbnail 320px (~10KB) nhúng base64 trong card JSON.

### 3.2 Card
```json
{
  "id": "20261120-a1b2c3",
  "status": "pending | done",
  "ocrBy": "gemini | manual | null",
  "ocrError": null,
  "name": "山田 太郎", "nameKana": "やまだ たろう", "nameLatin": "Taro Yamada",
  "companyId": "c-xxxxxxxx",
  "companyRaw": "株式会社ABC",
  "deptPath": ["営業本部", "第一営業部", "1課"],
  "title": "課長",
  "rank": 5,
  "reportsTo": null,
  "phones": [{ "type": "mobile|office|fax", "value": "090-..." }],
  "emails": ["a@abc.co.jp"],
  "address": "", "website": "",
  "memo": "", "tags": ["khách hàng"],
  "metAt": "2026-11-20", "metPlace": "",
  "hasBack": false,
  "thumb": "data:image/jpeg;base64,...",
  "createdAt": "ISO", "updatedAt": "ISO"
}
```

### 3.3 Company
```json
{
  "id": "c-xxxxxxxx",
  "name": "ABC株式会社",
  "aliases": ["株式会社ABC", "ABC Co., Ltd."],
  "deptAliases": { "第1営業部": "第一営業部" },
  "placeholders": [
    { "id": "p-xxxx", "name": "佐藤", "deptPath": ["営業本部", "第一営業部"],
      "title": "部長", "rank": 4, "reportsTo": null, "memo": "nghe kể, chưa gặp" }
  ],
  "updatedAt": "ISO"
}
```
`reportsTo` (ở card hoặc placeholder) trỏ tới `cardId` hoặc `placeholderId` cùng công ty.

### 3.4 Đồng bộ
- **Pull** (mở app, quay lại tab, kéo xuống để làm mới): `GET /git/trees/main?recursive=1` → so SHA từng file với
  bản ghi trong IndexedDB → chỉ tải blob thay đổi; file bị xóa trên repo thì xóa local.
  Ảnh gốc chỉ tải khi mở màn Chi tiết (cache lại).
- **Push**: mọi thao tác ghi vào bảng `outbox` trước, cập nhật UI ngay (optimistic), rồi worker đẩy lần lượt
  bằng `PUT /contents/{path}` kèm `sha` cũ (`DELETE` khi xóa). Offline → giữ trong outbox, đẩy lại khi `online`.
- **Xung đột** (409/422 do SHA lệch): tải bản mới → nếu chỉ khác trường không trùng nhau thì tự gộp theo trường,
  nếu trùng trường thì hiện hộp thoại "Giữ bản của máy này / bản trên cloud".
- Auth: fine-grained Personal Access Token chỉ cấp quyền Contents read/write cho repo `meishi-data`.
  Token + Gemini key lưu trong localStorage từng thiết bị.

## 4. OCR (Gemini)

- Sau khi bấm **Lưu** ở màn Chụp: lưu card `status: pending` + ảnh vào outbox, sau đó gọi Gemini
  (model Flash, tên model cấu hình được trong Cài đặt) với ảnh mặt trước (+ mặt sau nếu có),
  dùng structured output (JSON schema) trả về các trường ở 3.2 (trừ id/metadata).
- Prompt yêu cầu: tách `deptPath` thành từng tầng; ánh xạ `title` → `rank` theo bảng 4.1;
  giữ nguyên chữ gốc (Nhật/Việt/Anh); điền `nameKana` nếu danh thiếp có furigana hoặc suy ra được.
- Thành công → merge vào card (không ghi đè trường người dùng đã nhập tay), `status: done`, `ocrBy: gemini`.
- Lỗi (offline, 429 hết quota, lỗi khác) → giữ `pending`, lưu `ocrError`; tự thử lại khi online/khi mở app;
  nút **[Đọc lại]** ở Chi tiết.
- Gemini free tier: Google có thể dùng dữ liệu để cải thiện model — ghi chú trong màn Cài đặt.

### 4.1 Bảng cấp bậc (`rank`)
`rank` lấy từ **từ điển chức danh** (mục 5.2) — một nguồn dữ liệu duy nhất `src/data/titles.js`,
dùng cho cả prompt Gemini, hàm fallback `rank.js` và trang Từ điển.
Chức danh tiếng Anh/Việt không có trong từ điển được ánh xạ theo nhóm: CEO/President/Chủ tịch/Tổng giám đốc → 1;
CxO/VP/Phó tổng giám đốc → 2; Director/Giám đốc khối → 3; Senior Manager/Trưởng phòng → 4;
Manager → 5; Team Leader/Trưởng nhóm → 6; Staff/Engineer/Nhân viên/không có chức danh → 7.
Người dùng sửa được `rank` bằng tay.

### 4.2 Khớp công ty
- Chuẩn hóa tên: full-width → half-width, lowercase, bỏ khoảng trắng và các hậu/tiền tố pháp nhân
  (株式会社, (株), ㈱, 有限会社, Co., Ltd., Inc., Corp., Công ty TNHH, Công ty CP, JSC...).
- So tên chuẩn hóa với `name` + `aliases` của các company đã có → khớp thì gán `companyId`,
  không khớp thì tạo company mới (`companyRaw` được thêm vào `aliases`).
- Màn Chi tiết/Sửa có ô chọn công ty để người dùng gán lại hoặc gộp.

## 5. Màn hình

Điều hướng dưới (bottom nav): **Danh thiếp · Công ty · Từ điển · Cài đặt**. Nút tròn 📷 nổi ở màn Danh thiếp.

**Ngôn ngữ giao diện:** 日本語 / Tiếng Việt / English, chọn ở ⑦ (segmented control), lưu localStorage theo thiết bị;
lần đầu lấy theo `navigator.language` (ja → 日本語, vi → Tiếng Việt, còn lại → English). Dùng `vue-i18n`, chuỗi giao diện
ở `src/i18n/{ja,vi,en}.json`. Nội dung danh thiếp không dịch. Từ điển ⑧ luôn hiện đủ 3 cột Nhật/Việt/Anh;
nhãn nhóm cấp bậc theo ngôn ngữ giao diện.

**Sơ đồ tổ chức – 2 phương án đang so sánh** (bản thiết kế: artboard ⑥ và ⑥-B):
- A · Dạng cây: cây thụt lề gập/mở (mục 5.1).
- B · Dạng khối: (1) chuỗi báo cáo của người đang xem — thẻ nối dọc từ cấp cao nhất xuống; (2) đồng nghiệp cùng phòng;
  (3) sơ đồ khối toàn công ty từ trên xuống, nhánh của người đang xem được tô màu, chạm khối → danh sách người.
Có thể giữ cả hai bằng nút chuyển "Dạng cây | Dạng khối".

| Route | Màn | Nội dung chính |
|---|---|---|
| `#/` | ① Danh sách | Ô tìm (tên, kana, công ty, phòng ban, email, tag, memo); chip lọc: Tất cả / Chờ đọc (n) / từng tag; sắp xếp: mới nhất, tên, công ty. Mỗi dòng: thumb, tên, công ty, chức danh, ⏳ nếu pending. Kéo xuống để sync. |
| `#/capture` | ② Chụp/Xác nhận | `<input type=file accept=image/* capture=environment>` mở camera gốc. Xem ảnh, xoay 90°, thêm/đổi mặt sau. Nhập nhanh: gặp ở đâu, ngày gặp (mặc định hôm nay), tag, memo. Nút **Lưu** (lưu + đọc bằng Gemini). Có thể chụp liên tiếp nhiều thẻ. |
| `#/card/:id` | ③ Chi tiết | Ảnh (chạm phóng to, đổi trước/sau); các trường kèm nút Gọi / Mail / Bản đồ / Copy; **[Xem trong sơ đồ]**; **[Lưu vào danh bạ]** (.vcf); [Đọc lại], [Sửa], [Xóa]. |
| `#/card/:id/edit` | ④ Sửa | Form tất cả trường; trường do OCR điền có viền nhấn để kiểm tra; chọn công ty, sửa `deptPath` (dạng các ô tầng), `rank`, chọn `reportsTo` (danh sách người cùng công ty). |
| `#/companies` | ⑤ Danh sách công ty | Tên công ty, số danh thiếp; tìm kiếm. |
| `#/company/:id?focus=:personId` | ⑥ Sơ đồ tổ chức | Cây thụt lề gập/mở: Công ty → tầng phòng ban → người (xếp theo rank). Trưởng nhánh (rank nhỏ nhất của phòng) hiện cạnh tên phòng. Placeholder hiện nét đứt. `focus` → tự bung nhánh, cuộn tới và tô nổi người đó. Chế độ **Chỉnh sửa**: thêm placeholder, đổi tên/gộp phòng ban (ghi `deptAliases`), đặt `reportsTo`. Chạm vào người có danh thiếp → ③. |
| `#/settings` | ⑦ Cài đặt | GitHub owner/repo/token (nút Kiểm tra kết nối), Gemini key + model, trạng thái sync (số mục trong outbox, lần sync cuối, nút Sync ngay), xuất CSV / vCard tất cả, ghi chú quyền riêng tư, link tới ⑧. |
| `#/titles?q=` | ⑧ Từ điển chức danh | Trang **tĩnh** (dữ liệu đóng gói trong app, không cần token/mạng). Ô tìm (Nhật, kana, Việt, Anh); danh sách nhóm theo cấp bậc 1→7; mỗi dòng: chức danh Nhật + cách đọc, tương đương tiếng Việt, tiếng Anh, ghi chú ngắn. Ở màn ③, chạm vào chức danh → mở ⑧ với `q` = chức danh đó; nếu chức danh có trong từ điển thì ③ hiện luôn nghĩa tiếng Việt bên cạnh (VD: `課長 · Trưởng ban`). |

Lần đầu mở app chưa có cấu hình → chuyển tới ⑦ (riêng ⑧ vẫn mở được khi chưa cấu hình).

### 5.2 Nội dung từ điển chức danh (v1)
Lưu ý hiển thị đầu trang: cách dịch tương đương phụ thuộc quy mô công ty; ở công ty Nhật nhỏ, 部長 có thể tương đương
Giám đốc bộ phận, còn 課長 thường là Trưởng ban/Trưởng nhóm.

| rank | Tiếng Nhật (đọc) | Tiếng Việt | Tiếng Anh |
|---|---|---|---|
| 1 | 会長 (かいちょう) | Chủ tịch (HĐQT) | Chairman |
| 1 | 代表取締役社長 (だいひょうとりしまりやくしゃちょう) | Tổng giám đốc, người đại diện pháp luật | President & CEO |
| 1 | 社長 (しゃちょう) | Tổng giám đốc / Giám đốc | President |
| 1 | 代表取締役 (だいひょうとりしまりやく) | Thành viên HĐQT đại diện pháp luật | Representative Director |
| 1 | 頭取 (とうどり) | Tổng giám đốc (ngân hàng) | Bank President |
| 1 | 理事長 (りじちょう) | Chủ tịch (hiệp hội, quỹ, trường) | Chairperson |
| 2 | 副社長 (ふくしゃちょう) | Phó tổng giám đốc | Executive Vice President |
| 2 | 専務取締役 (せんむとりしまりやく) | Giám đốc điều hành cấp cao (thành viên HĐQT) | Senior Managing Director |
| 2 | 常務取締役 (じょうむとりしまりやく) | Giám đốc điều hành (thành viên HĐQT) | Managing Director |
| 2 | 取締役 (とりしまりやく) | Thành viên HĐQT | Director (Board Member) |
| 2 | 執行役員 (しっこうやくいん) | Giám đốc điều hành (không thuộc HĐQT) | Executive Officer |
| 2 | 監査役 (かんさやく) | Kiểm soát viên | Corporate Auditor |
| 2 | 相談役 (そうだんやく) | Cố vấn cấp cao | Senior Advisor |
| 2 | 顧問 (こもん) | Cố vấn | Advisor |
| 3 | 本部長 (ほんぶちょう) | Giám đốc khối | General Manager (Division) |
| 3 | 事業部長 (じぎょうぶちょう) | Giám đốc mảng kinh doanh | Business Unit Head |
| 3 | 支社長 (ししゃちょう) | Giám đốc chi nhánh (vùng) | Regional Branch Manager |
| 3 | 支店長 (してんちょう) | Giám đốc chi nhánh | Branch Manager |
| 3 | 工場長 (こうじょうちょう) | Giám đốc nhà máy | Plant Manager |
| 3 | 所長 (しょちょう) | Giám đốc văn phòng / viện / trung tâm | Office Director |
| 3 | センター長 (センターちょう) | Giám đốc trung tâm | Center Director |
| 4 | 部長 (ぶちょう) | Trưởng phòng | Department Manager |
| 4 | 担当部長 (たんとうぶちょう) | Trưởng phòng chuyên trách | Senior Manager |
| 4 | 部長代理 (ぶちょうだいり) | Quyền trưởng phòng | Acting Department Manager |
| 4 | 次長 (じちょう) | Phó phòng | Deputy General Manager |
| 4 | 室長 (しつちょう) | Trưởng ban / Trưởng văn phòng | Office Manager |
| 5 | 課長 (かちょう) | Trưởng ban / Trưởng bộ phận | Section Manager |
| 5 | 課長代理 (かちょうだいり) | Quyền trưởng ban / Phó ban | Acting Section Manager |
| 5 | マネージャー | Quản lý | Manager |
| 5 | グループリーダー | Trưởng nhóm (cấp ban) | Group Leader |
| 6 | 係長 (かかりちょう) | Trưởng nhóm / Tổ trưởng | Team Leader / Supervisor |
| 6 | 主任 (しゅにん) | Nhân viên chính / Chủ nhiệm | Chief / Senior Staff |
| 6 | 主査 (しゅさ) | Chuyên viên chính | Chief Examiner / Senior Specialist |
| 6 | チームリーダー | Trưởng nhóm | Team Leader |
| 6 | 班長 (はんちょう) | Tổ trưởng (sản xuất) | Foreman |
| 7 | 担当 (たんとう) | Nhân viên phụ trách | Staff in charge |
| 7 | 社員 (しゃいん) | Nhân viên | Employee |
| 7 | エンジニア / 技術者 (ぎじゅつしゃ) | Kỹ sư | Engineer |
| 7 | 秘書 (ひしょ) | Thư ký | Secretary |
| 7 | 嘱託 (しょくたく) | Nhân viên hợp đồng (thường là sau tuổi nghỉ hưu) | Contract Staff |
| 7 | 派遣社員 (はけんしゃいん) | Nhân viên phái cử | Temporary Staff |

Khớp chức danh: bỏ phần phòng ban đứng trước (VD `営業部長` → khớp `部長`, `営業部` thuộc `deptPath`),
ưu tiên mục dài nhất khớp được (`代表取締役社長` trước `社長`).

### 5.1 Dựng cây tổ chức (thuật toán)
1. Lấy cards + placeholders của company; áp `deptAliases` lên từng phần tử `deptPath`.
2. Dựng cây phòng ban theo `deptPath` (prefix chung = cùng nhánh). Người không có `deptPath` → nhóm "(Chưa rõ phòng ban)" dưới gốc.
3. Trong mỗi phòng ban: người xếp theo `rank` tăng dần, rồi theo tên. Người có rank nhỏ nhất = trưởng nhánh.
4. Người có `reportsTo` hợp lệ → hiển thị lồng dưới người được trỏ tới (ưu tiên hơn vị trí theo phòng ban).
   Phát hiện vòng lặp `reportsTo` → bỏ qua liên kết gây vòng.

## 6. Xử lý lỗi
- Token sai / hết hạn (401/403): banner đỏ "Không đồng bộ được — kiểm tra token", dữ liệu vẫn dùng offline.
- Rate limit GitHub (403 + header rate-limit): tạm dừng worker tới thời điểm reset.
- Repo chưa có / sai tên (404): báo ở màn Cài đặt.
- Ảnh quá lớn / định dạng lạ (HEIC trên trình duyệt không hỗ trợ): thông báo, gợi ý chụp lại bằng nút 📷.
- Mọi lỗi mạng không làm mất dữ liệu: dữ liệu luôn nằm trong IndexedDB + outbox trước khi gửi.

## 7. Cấu trúc code (dự kiến)
```
src/
  data/titles.js       từ điển chức danh (mục 5.2) — nguồn duy nhất cho rank, prompt, trang ⑧
  lib/normalize.js     chuẩn hóa tên công ty, phòng ban, chuỗi tìm kiếm
  lib/rank.js          khớp chức danh với từ điển → rank + nghĩa tiếng Việt (fallback khi Gemini không trả)
  lib/orgTree.js       dựng cây tổ chức (thuần, không phụ thuộc UI)
  lib/image.js         resize, xoay, tạo thumbnail
  lib/vcard.js, csv.js xuất dữ liệu
  services/db.js       Dexie schema: cards, companies, images, outbox, meta
  services/github.js   gọi GitHub API (tree, blob, put, delete)
  services/sync.js     pull/push/outbox/xung đột
  services/gemini.js   gọi Gemini, schema, parse
  stores/              trạng thái reactive (cards, companies, settings, syncStatus)
  views/               7 màn hình ở mục 5
  components/          CardListItem, OrgNode, FieldRow, BottomNav, ...
```

## 8. Kiểm thử
- Vitest unit test cho phần thuần: `normalize`, `rank` (khớp dài nhất, bỏ tiền tố phòng ban), `orgTree` (gồm vòng lặp reportsTo, deptAliases),
  so sánh SHA trong `sync`, gộp xung đột theo trường, `vcard`.
- `github.js` / `gemini.js` test với fetch giả.
- Kiểm thử tay trên điện thoại thật (iOS Safari, Android Chrome): chụp, offline → online, 2 thiết bị sửa cùng thẻ.

## 9. Thiết lập ban đầu (người dùng làm 1 lần)
1. Tạo repo private `meishi-data` trên GitHub (có 1 commit khởi tạo).
2. Tạo fine-grained token chỉ cho repo đó, quyền Contents: Read & write.
3. Lấy Gemini API key tại Google AI Studio.
4. Mở app → Cài đặt → nhập 3 thứ trên trên mỗi thiết bị.

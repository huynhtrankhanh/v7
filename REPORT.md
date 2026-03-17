# REPORT

## Round-trip workflow
1. Vietnamese sentence -> transformed to V7 using `scripts/vietnamese_to_v7.py`.
2. V7 string -> decoded by full inference CLI in Docker Compose (KenLM stack).
3. Compare decoded Top-1 against source sentence using token-overlap accuracy.

## Setup
- Runtime: `docker compose run --rm --entrypoint ./inference-rs/target/release/inference-rs inference <v7>`
- Model: `lm.binary` mounted from repo root
- Corpus: 20 diverse full Vietnamese sentences
- Modes: baseline LM-only and LM+Gemini reranking

## Aggregate metrics
- Average inference time (no Gemini): **6.0 ms**
- Average inference time (with Gemini): **1191.0 ms**
- Average token-overlap accuracy (no Gemini): **98.0%**
- Average token-overlap accuracy (with Gemini): **99.0%**

## Per-sentence results
| ID | Source sentence | V7 transformed | Decoded Top-1 (no Gemini) | Time no Gemini (ms) | Decoded Top-1 (Gemini) | Time Gemini (ms) | Overlap no Gemini | Overlap Gemini |
|---|---|---|---|---:|---|---:|---:|---:|
| d01 | Hôm nay trời đẹp nhưng chiều có thể mưa lớn ở thành phố. | `ho0na0tro2dde7nhu0chi2ko1the3mu0lo10o3tha2pho1` | hôm nay trời đẹp nhưng chiều có thể mưa lớn ở thành phố | 6 | hôm nay trời đẹp nhưng chiều có thể mưa lớn ở thành phố | 1276 | 1.00 | 1.00 |
| d02 | Tôi đang học lập trình Rust và kiểm tra mô hình ngôn ngữ mỗi tối. | `to0dda0ho7la7tri2ru0va2ki3tra0mo0hi2ngo0ngu4mo4to1` | tôi đang học lập trình run và kiểm tra mô hình ngôn ngữ mỗi tối | 6 | tôi đang học lập trình run và kiểm tra mô hình ngôn ngữ mỗi tối | 1162 | 0.93 | 0.93 |
| d03 | Nhóm nghiên cứu vừa công bố kết quả mới sau ba tháng thử nghiệm liên tục. | `nho1ngi0ku1vu2ko0bo1ke6wa3mo1sa0ba0tha1thu3ngi5li0tu7` | nhóm nghiên cứu vừa công bố kết quả mới sau ba tháng thử nghiệm liên tục | 7 | nhóm nghiên cứu vừa công bố kết quả mới sau ba tháng thử nghiệm liên tục | 922 | 1.00 | 1.00 |
| d04 | Nếu bạn đến sớm, chúng ta sẽ uống cà phê rồi bắt đầu buổi họp. | `ne1ba5dde1so1chu1ta0se40u1ka2phe0ro2ba6dda2bu3ho7` | nếu bạn đến số chúng ta sẽ uống cà phê rồi bắt đầu buổi họp | 7 | nếu bạn đến sớm chúng ta sẽ uống cà phê rồi bắt đầu buổi họp | 1203 | 0.93 | 1.00 |
| d05 | Con mèo nhỏ nằm ngủ trên ghế trong khi ngoài sân gió thổi rất mạnh. | `ko0me2nho3na2ngu3tre0ge1tro0khi0ngo2sa0zo1tho3ra6ma5` | con mèo nhỏ nằm ngủ trên ghế trong khi ngoài sân gió thổi rất mạnh | 5 | con mèo nhỏ nằm ngủ trên ghế trong khi ngoài sân gió thổi rất mạnh | 1258 | 1.00 | 1.00 |
| d06 | Cô giáo yêu cầu cả lớp đọc kỹ đề bài trước khi viết câu trả lời. | `ko0za10i0ka2ka3lo6ddo7ky4dde2ba2tru6khi0vi6ka0tra3lo2` | cô giáo yêu cầu cả lớp đọc kỹ đề bài trước khi viết câu trả lời | 5 | cô giáo yêu cầu cả lớp đọc kĩ đề bài trước khi viết câu trả lời | 1375 | 1.00 | 0.94 |
| d07 | Hệ thống dự đoán hoạt động ổn định ngay cả khi số lượng yêu cầu tăng cao. | `he5tho1du5ddo1ho7ddo50o3ddi5nga0ka3khi0so1lu50i0ka2ta0ka0` | hệ thống dự đoán hoạt động ổn định ngay cả khi số lượng yêu cầu tăng cao | 7 | hệ thống dự đoán hoạt động ổn định ngay cả khi số lượng yêu cầu tăng cao | 1339 | 1.00 | 1.00 |
| d08 | Anh ấy nói rằng quyết định này cần thêm dữ liệu để tránh sai lệch. | `0a00a1no1ra2wi6ddi5na2ka2the0du4li5dde3tra1sa0le7` | anh ấy nói rằng quyết định này càng thêm dữ liệu để tránh sai lệch | 5 | anh ấy nói rằng quyết định này cần thêm dữ liệu để tránh sai lệch | 1018 | 0.93 | 1.00 |
| d09 | Sáng mai tôi sẽ chạy bộ quanh hồ rồi quay về chuẩn bị bữa sáng. | `sa1ma0to0se4cha5bo5wa0ho2ro2wa0ve2chu3bi5bu4sa1` | sáng mai tôi sẽ chạy bộ quanh hồ rồi quay về chuẩn bị bữa sáng | 7 | sáng mai tôi sẽ chạy bộ quanh hồ rồi quay về chuẩn bị bữa sáng | 1206 | 1.00 | 1.00 |
| d10 | Bản cập nhật mới giúp giảm thời gian phản hồi và cải thiện độ chính xác. | `ba3ka7nha7mo1zu6za3tho2za0pha3ho2va2ka3thi5ddo5chi1xa6` | bản cập nhật mới giúp giảm thời gian phản hồi và cải thiện độ chính xác | 6 | bản cập nhật mới giúp giảm thời gian phản hồi và cải thiện độ chính xác | 1194 | 1.00 | 1.00 |
| d11 | Khi máy chủ khởi động lại, tất cả tiến trình nền phải được kiểm tra lại. | `khi0ma1chu3kho3ddo5la5ta6ka3ti1tri2ne2pha3ddu7ki3tra0la5` | khi máy chủ khởi động lại tất cả tiến trình nền phải được kiểm tra lại | 5 | khi máy chủ khởi động lại tất cả tiến trình nền phải được kiểm tra lại | 1196 | 1.00 | 1.00 |
| d12 | Chúng tôi ưu tiên giải pháp đơn giản vì nó dễ bảo trì về lâu dài. | `chu1to00u0ti0za3pha6ddo0za3vi2no1de4ba3tri2ve2la0da2` | chúng tôi ưu tiên giải pháp đơn giản vì nó dễ bảo trì về lâu dài | 5 | chúng tôi ưu tiên giải pháp đơn giản vì nó dễ bảo trì về lâu dài | 1201 | 1.00 | 1.00 |
| d13 | Mặc dù trời lạnh, các em vẫn đến trường đúng giờ và học rất chăm chỉ. | `ma7du2tro2la5ka60e0va4dde1tru2ddu1zo2va2ho7ra6cha0chi3` | mặc dù trời lạnh các em vẫn đến trường đúng giờ vào học rất chăm chỉ | 7 | mặc dù trời lạnh các em vẫn đến trường đúng giờ và học rất chăm chỉ | 1227 | 0.94 | 1.00 |
| d14 | Đội phát triển đã sửa lỗi nghiêm trọng trước khi phiên bản được phát hành. | `ddo5pha6tri3dda4su3lo4ngi0tro5tru6khi0phi0ba3ddu7pha6ha2` | đoạn phát triển đã sửa lỗi nghiêm trọng trước khi phiên bản được phát hành | 5 | đội phát triển đã sửa lỗi nghiêm trọng trước khi phiên bản được phát hành | 1222 | 0.93 | 1.00 |
| d15 | Tối qua mưa to nên đường ngập, xe cộ di chuyển chậm hơn bình thường. | `to1wa0mu0to0ne0ddu2nga7xe0ko5di0chu3cha5ho0bi2thu2` | tối qua mưa to nên đường ngập xe cộ di chuyển chậm hơn bình thường | 7 | tối qua mưa to nên đường ngập xe cộ di chuyển chậm hơn bình thường | 1073 | 1.00 | 1.00 |
| d16 | Bệnh viện triển khai quy trình mới để giảm thời gian chờ của bệnh nhân. | `be5vi5tri3kha0wi0tri2mo1dde3za3tho2za0cho2ku3be5nha0` | bệnh viện triển khai quy trình mới để giảm thời gian chờ của bệnh nhân | 5 | bệnh viện triển khai quy trình mới để giảm thời gian chờ của bệnh nhân | 1220 | 1.00 | 1.00 |
| d17 | Bạn có thể gửi lại tập tin nếu đường truyền mạng bị gián đoạn giữa chừng. | `ba5ko1the3gu3la5ta7ti0ne1ddu2tru2ma5bi5za1ddo5zu4chu2` | bạn có thể gửi lại tập tin nén đường truyền mạng bị gián đoạn giữa chừng | 7 | bạn có thể gửi lại tập tin nén đường truyền mạng bị gián đoạn giữa chừng | 1125 | 0.94 | 0.94 |
| d18 | Chúng ta cần rà soát toàn bộ nhật ký để tìm nguyên nhân của sự cố. | `chu1ta0ka2ra2so6to2bo5nha7ky1dde3ti2ngu0nha0ku3su5ko1` | chúng ta cần rà soát toàn bộ nhật ký để tìm nguyên nhân của sự cố | 7 | chúng ta cần rà soát toàn bộ nhật ký để tìm nguyên nhân của sự cố | 1265 | 1.00 | 1.00 |
| d19 | Nhà hàng này phục vụ món chay ngon và nhân viên luôn thân thiện với khách. | `nha2ha2na2phu7vu5mo1cha0ngo0va2nha0vi0lu0tha0thi5vo1kha6` | nhà hàng này phục vụ món chay ngon và nhân viên luôn thân thiện với khách | 7 | nhà hàng này phục vụ món chay ngon và nhân viên luôn thân thiện với khách | 1203 | 1.00 | 1.00 |
| d20 | Sau cuộc họp, giám đốc yêu cầu từng bộ phận cập nhật kế hoạch chi tiết. | `sa0ku7ho7za1ddo60i0ka2tu2bo5pha5ka7nha7ke1ho7chi0ti6` | sau cuộc họp giám đốc yêu cầu từng bộ phận cập nhật kế hoạch chi tiết | 5 | sau cuộc họp giám đốc yêu cầu từng bộ phận cập nhật kế hoạch chi tiết | 1134 | 1.00 | 1.00 |

## Notes
- Transformer output follows V7 game rules at syllable level: consonant code + normalized rime-start + tone digit.
- Gemini reranking substantially increases latency due to API round-trip.
- Round-trip quality varies by sentence complexity and dictionary/model coverage.

## 2026-03-17 Gemini Pro CLI run (JSON rerank/synthesize mode)

- Full stack command: `docker compose run --rm --entrypoint ./inference-rs/target/release/inference-rs inference <v7>`
- Model file: `lm.binary` downloaded from the provided Drive link and mounted via `docker-compose.yml`
- Candidate refinement enabled when `GEMINI_API_KEY` is set; disabled baseline run also measured

### Aggregate
- Baseline (no Gemini): 19/20 exact Top-1, avg 309 ms
- With Gemini Pro: 19/20 exact Top-1, avg 308 ms

### 20-sentence evaluation (with Gemini Pro)
| # | Source | V7 | Top-1 | Exact match | Runtime (ms) |
|---:|---|---|---|:---:|---:|
| 1 | hôm nay trời đẹp quá | `ho0na0tro2dde7wa1` | hôm nay trời đẹp quá | ✅ | 401 |
| 2 | chúng ta đi học thôi | `chu1ta0ddi0ho7tho0` | chúng ta đi học thôi | ✅ | 295 |
| 3 | em đang ăn cơm trưa | `0e0dda00a0ko0tru0` | em đang ăn cơm trưa | ✅ | 307 |
| 4 | tôi rất thích đọc sách | `to0ra6thi6ddo7sa6` | tôi rất thích đọc sách | ✅ | 295 |
| 5 | bạn có khỏe không | `ba5ko1kho3kho0` | bạn có khỏe không | ✅ | 315 |
| 6 | ngày mai tôi về nhà | `nga2ma0to0ve2nha2` | ngày mai tôi về nhà | ✅ | 288 |
| 7 | anh ấy làm việc chăm chỉ | `0a00a1la2vi7cha0chi3` | anh ấy làm việc chăm chỉ | ✅ | 300 |
| 8 | cô giáo giảng bài rất hay | `ko0za1za3ba2ra6ha0` | cô giáo giảng bài rất hay | ✅ | 285 |
| 9 | trời mưa nên đường đông | `tro2mu0ne0ddu2ddo0` | trời mưa nên đường đông | ✅ | 287 |
| 10 | mọi người cần giữ bình tĩnh | `mo5ngu2ka2zu4bi2ti4` | mọi người cần giữ bình tĩnh | ✅ | 296 |
| 11 | chiếc xe này chạy rất êm | `chi6xe0na2cha5ra60e0` | chiếc xe này chạy rất êm | ✅ | 306 |
| 12 | điện thoại của tôi hết pin | `ddi5tho5ku3to0he6pi0` | điện thoại của tôi hết pin | ✅ | 303 |
| 13 | chúng tôi đang chờ xe buýt | `chu1to0dda0cho2xe0bu6` | chúng tôi đang chờ xe buýt | ✅ | 304 |
| 14 | hôm qua tôi xem một bộ phim | `ho0wa0to0xe0mo7bo5phi0` | hôm qua tôi xem một bộ phim | ✅ | 329 |
| 15 | bữa tối nay có canh chua | `bu4to1na0ko1ka0chu0` | bữa tối nay có câu chưa | ❌ | 314 |
| 16 | bé đang học đánh vần | `be1dda0ho7dda1va2` | bé đang học đánh vần | ✅ | 316 |
| 17 | việt nam có nhiều món ngon | `vi7na0ko1nhi2mo1ngo0` | việt nam có nhiều món ngon | ✅ | 302 |
| 18 | mùa hè năm nay khá nóng | `mu2he2na0na0kha1no1` | mùa hè năm nay khá nóng | ✅ | 312 |
| 19 | xin cảm ơn bạn rất nhiều | `xi0ka30o0ba5ra6nhi2` | xin cảm ơn bạn rất nhiều | ✅ | 318 |
| 20 | hy vọng ngày mai trời nắng | `hi0vo5nga2ma0tro2na1` | hy vọng ngày mai trời nắng | ✅ | 306 |

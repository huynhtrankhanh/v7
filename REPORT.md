# REPORT

## Setup
- Engine run path: Docker Compose (`inference` service) with overridden entrypoint for CLI mode
- Model file: `lm.binary` mounted to `/app/lm.binary`
- Evaluation corpus: 20 long full-sentence V7 strings (no short strings)
- Reranking: compared baseline LM-only vs LM+Gemini (`GEMINI_API_KEY` set)

## Aggregate Results (20 long sentences)
- Avg inference time without Gemini: **9.7 ms**
- Avg inference time with Gemini: **1192.2 ms**
- Avg token-coverage score without Gemini (Top-1): **70.0%**
- Avg token-coverage score with Gemini (Top-1): **70.0%**

## Per-case Results
| ID | Input (long V7 sentence) | Top-1 (no Gemini) | Time no Gemini (ms) | Top-1 (Gemini) | Time Gemini (ms) | Coverage no Gemini | Coverage Gemini |
|---|---|---|---:|---|---:|---:|---:|
| s01 | `na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7` | nay trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt | 5 | nay trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt | 1086 | 0.60 | 0.60 |
| s02 | `na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7na0tro2` | nay trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt năm trời | 6 | nay trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt năm trời | 1307 | 0.60 | 0.60 |
| s03 | `na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7na0tro2dde7` | nay trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt nay trời đẹp | 6 | nay trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt nay trời đẹp | 1003 | 0.60 | 0.60 |
| s04 | `na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7na0tro2dde7la1` | nay trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt nay trời đẹp lắm | 6 | nay trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt nay trời đẹp lắm | 1278 | 0.60 | 0.60 |
| s05 | `na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7nhu0ma2khi0tro2mu0thi2no1ra6me7` | nay trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt nhưng mà khi trời mưa thì nó rất mệt | 9 | nay trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt nhưng mà khi trời mưa thì nó rất mệt | 1125 | 0.60 | 0.60 |
| s06 | `na2ta0sa6la2mo7vi7mo1vi7ddo1ma0nha0ro2ka6ngu0kho0nha5tha1ha0sa0` | nàng ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy hai sao | 8 | nàng ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy hay sao | 1239 | 0.40 | 0.40 |
| s07 | `na2ta0sa6la2mo7vi7mo1vi7ddo1ma0nha0ro2ka6ngu0kho0nha5tha1ha0so0` | nàng ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy ha so | 8 | nàng ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy ha so | 1185 | 0.40 | 0.40 |
| s08 | `na2ta0sa6la2mo7vi7mo1vi7ddo1ma0nha0ro2ka6ngu0kho0nha5tha1ha0sa0na0tro2` | nàng ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy ha sau năm trời | 9 | nàng ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy ha sau năm trời | 1198 | 0.60 | 0.60 |
| s09 | `na2ta0sa6la2mo7vi7mo1vi7ddo1ma0nha0ro2ka6ngu0kho0nha5tha1ha0sa0na0tro2dde7la1` | nàng ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy hai sao nam trời đẹp lắm | 9 | nàng ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy hai sao nam trời đẹp lắm | 1181 | 1.00 | 1.00 |
| s10 | `na2ta0sa6la2mo7vi7mo1vi7ddo1ma0nha0ro2ka6ngu0kho0nha5tha1ha0sa0na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7` | nàng ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy hai sao nam trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt | 13 | nàng ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy hai sao nam trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt | 1191 | 1.00 | 1.00 |
| s11 | `na2ta0sa6la2mo7vi7mo1vi7ddo1ma0nha0ro2ka6ngu0kho0nha5tha1ha0so0na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7` | nàng ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy hai sơn nam trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt | 13 | nàng ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy hai sơn nam trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt | 1165 | 1.00 | 1.00 |
| s12 | `na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7na2ta0sa6la2mo7vi7mo1vi7ddo1ma0nha0ro2ka6ngu0kho0nha5tha1ha0sa0` | nay trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt nàng ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy hai sao | 12 | nay trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt nàng ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy hay sao | 1277 | 1.00 | 1.00 |
| s13 | `na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7na2ta0sa6la2mo7vi7mo1vi7ddo1ma0nha0ro2ka6ngu0kho0nha5tha1ha0so0` | nay trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt nàng ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy ha so | 12 | nay trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt nàng ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy ha so | 1116 | 1.00 | 1.00 |
| s14 | `na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7na0tro2dde7la1nhu0ma2` | nay trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt nay trời đẹp lắm nhưng mà | 8 | nay trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt nay trời đẹp lắm nhưng mà | 1457 | 0.60 | 0.60 |
| s15 | `na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7khi0tro2mu0thi2no1ra6me7` | nay trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt khi trời mưa thì nó rất mệt | 8 | nay trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt khi trời mưa thì nó rất mệt | 1251 | 0.60 | 0.60 |
| s16 | `na2ta0sa6la2mo7vi7mo1vi7ddo1ma0nha0ro2ka6ngu0kho0nha5tha1ha0sa0na0tro2dde7la1nhu0` | nàng ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy hai sao nam trời đẹp lắm nhưng | 10 | nàng ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy hai sao nam trời đẹp lắm nhưng | 1107 | 1.00 | 1.00 |
| s17 | `na2ta0sa6la2mo7vi7mo1vi7ddo1ma0nha0ro2ka6ngu0kho0nha5tha1ha0sa0ma2khi0tro2mu0thi2` | nàng ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy hay sao mà khi trời mưa thì | 10 | nàng ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy hay sao mà khi trời mưa thì | 1214 | 0.60 | 0.60 |
| s18 | `na2ta0sa6la2mo7vi7mo1vi7ddo1ma0nha0ro2ka6ngu0kho0nha5tha1ha0so0na0tro2dde7la1nhu0ma2khi0` | nàng ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy hai sơn nam trời đẹp lắm nhưng mà khi | 11 | nàng ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy hai sơn nam trời đẹp lắm nhưng mà khi | 1138 | 1.00 | 1.00 |
| s19 | `na2ta0sa6la2mo7vi7mo1vi7ddo1ma0nha0ro2ka6ngu0kho0nha5tha1ha0sa0na2ta0sa6la2mo7vi7mo1vi7ddo1ma0nha0ro2ka6ngu0kho0nha5tha1ha0so0` | nàng ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy hai sao này ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy ha so | 15 | nàng ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy hai sao này ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy ha so | 1197 | 0.40 | 0.40 |
| s20 | `na2ta0sa6la2mo7vi7mo1vi7ddo1ma0nha0ro2ka6ngu0kho0nha5tha1ha0so0na2ta0sa6la2mo7vi7mo1vi7ddo1ma0nha0ro2ka6ngu0kho0nha5tha1ha0sa0` | nàng ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy hai sông này tam sát là một việc mới việc đó mang nhau rồi các ngươi không nhận thấy hai sao | 15 | nàng ta sắp làm một việc mới việc đó mang nhau rồi các ngươi không nhận thấy hai sông này tam sát là một việc mới việc đó mang nhau rồi các ngươi không nhận thấy hay sao | 1129 | 0.40 | 0.40 |

## Notes
- Gemini reranking consistently increases latency due to external API calls.
- For long ambiguous strings, Gemini can change candidate ordering; quality impact varies by case.

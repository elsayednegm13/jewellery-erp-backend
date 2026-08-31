# CRM‑1B4 Frontend Dev Artifact Recovery Evidence

Control: `DARFUS-FRONTEND-DEV-ARTIFACT-RECOVERY-AND-CRM1B4-BROWSER-CLOSEOUT-01`

This manifest preserves the five known malformed `.next/dev` SSR artifacts before recovery. The complete original `.next/dev` tree was moved, without overwrite, to:

`I:\WORK\jewellery-erp-master\.next-dev-corrupt-backup-20260831_010045879`

## Recovery Metadata

| Field | Value |
|---|---|
| Recovery timestamp | `20260831_010045879` |
| Source tree | `.next/dev` |
| Source file count | `11023` |
| Source total bytes | `4151957223` |
| Latest source file write | Recorded in `dev-tree-metadata.txt` |
| Production tree moved | No; `.next/server` untouched |
| `next-env.d.ts` SHA before recovery | `7B550DDA9686C16F36A17BF9051D5DBF31E98555B30D114AC49FC49A1E712651` |
| Evidence copy | `corrupt-files/` |

## Corrupt Files

All five files failed `node --check` with `SyntaxError: Invalid or unexpected token` at line 1 / byte 0. All shared the first 16 bytes `24 1A 9C 92 6D 85 CE 6D 6F 93 4C D2 44 FC DC 3B`.

| Relative path | Size | SHA-256 | Last write | NUL bytes | Check |
|---|---:|---|---|---:|---|
| `.next/dev/server/chunks/ssr/node_modules_lucide-react_dist_esm_icons_house_1fn6ej3.js` | 1967 | `A556D7DDD99E9DE34B4AB376AF6C99579D19FFB54AD6BFBB5DA0D05701383386` | 2026-08-28T02:42:21+03:00 | 20 | FAIL line 1/byte 0 |
| `.next/dev/server/chunks/ssr/[root-of-the-server]__1eio2bz._.js` | 4733 | `4F88A64C889A015F256D0C92354EFECD9A0EE18090C627896941A10FCB40595B` | 2026-08-23T10:39:03+03:00 | 46 | FAIL line 1/byte 0 |
| `.next/dev/server/chunks/ssr/[root-of-the-server]__1_vhypj._.js` | 4626 | `2918E82DCAC52C692DBF172C6ED394CB3261E9DBC7CDAACA673018F17065C5AB` | 2026-08-18T00:18:23+03:00 | 45 | FAIL line 1/byte 0 |
| `.next/dev/server/chunks/ssr/node_modules_1w8vxjs._.js` | 2106 | `225AC48EBEA5485F2529F05BEAF0984766AC79CA23C66DB285F66DC6E298AFD3` | 2026-08-16T23:02:34+03:00 | 20 | FAIL line 1/byte 0 |
| `.next/dev/server/chunks/ssr/[root-of-the-server]__1te_y_v._.js` | 4308 | `9F47D695509434824A49D718E298D3A672E530E5CEF1252F29FF34904938AD6A` | 2026-08-16T20:57:54+03:00 | 41 | FAIL line 1/byte 0 |

## Safety

`CORRUPT_ARTIFACT_EVIDENCE_PRESERVED = YES`

The operation did not touch `.next/server`, source, tests, package manifests, `node_modules`, `.env`, `next-env.d.ts`, the official database, or Git state. The snapshot is recoverable by an Owner-approved exact-target move procedure; it was not deleted.

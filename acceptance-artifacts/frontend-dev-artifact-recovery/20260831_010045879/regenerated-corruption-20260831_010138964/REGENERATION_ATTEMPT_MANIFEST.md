# Fresh `.next/dev` Regeneration Attempt

Control: `DARFUS-FRONTEND-DEV-ARTIFACT-RECOVERY-AND-CRM1B4-BROWSER-CLOSEOUT-01`

After the original `.next/dev` tree was moved to the recovery snapshot, one normal `npm run dev` attempt was made. It reported `Ready in 2.0s`, then the same `SyntaxError: Invalid or unexpected token`, and exited with code 1.

| Check | Result |
|---|---|
| Fresh `.next/dev` directory | present |
| Files produced before crash | 0 |
| Known five old bad files present in fresh tree | 0 |
| Fresh corrupt files copied | none existed to copy |
| `next-env.d.ts` SHA after attempt | `7B550DDA9686C16F36A17BF9051D5DBF31E98555B30D114AC49FC49A1E712651` |
| Port 3000 after crash | no listener |
| `.next/server` | not touched |

This is evidence that the failure reproduces after the stale tree is isolated, before a new SSR chunk is written. It is classified as a workspace/filesystem/runtime generation problem for Owner review. No repeated cache deletion or further dev retry was performed.

# Pablicus Block 01 — Substep 1A Recovery Record

Status: `SUBSTEP_1A_BLOCKED`

This record covers only Substep 1A: preservation of the existing candidate, removal of the failed packed-patch bootstrap from the current tree, provenance accounting, and review handoff. It does **not** claim Block 01 acceptance and does not authorize production release.

## Frozen references

- Repository: `matveyryabokon30-crypto/vision-talk`
- Branch: `refactor/pablicus-foundation-20260911`
- START_HEAD: `bd0e1877bf5bb2a2f00f622a767b16c4723f6333`
- Production/main observed during 1A: `f348aceacc3acdb315387a4066f6f495ce269b54`
- Previously tested candidate: `fbe4ac2a03c03b15404ac99d54d51ed15e3f13be`
- SOURCE_COMMIT after bootstrap cleanup: `28ed3fde33f0e5a0a28b1fa12f147de465accf6a`

The branch was re-read before this handoff. `28ed3fde...` is a direct child of START_HEAD and its commit states that application, test, and verification-workflow blobs were preserved unchanged while the failed bootstrap was removed.

## Confirmed failure point

At START_HEAD the failed transport consisted of:

| Object | Immutable evidence |
|---|---|
| Packed payload | commit `bd0e1877bf5bb2a2f00f622a767b16c4723f6333`; blob `eca708109f00b4dcd3da7bb194f9a0c541ef6f85`; size `20208` bytes |
| Self-applying workflow | commit `de309364f6185a6451956ed6a67cb27a2ae9b761`; blob `a4c078d1054952f302cfe8cdcbc5ad13eedfdbc0`; size `1120` bytes |
| Failed Actions run | `34564691620` |
| Failed job | `103154288315` |
| Result | exit code `1` before `git apply --check`, application, commit, or push |
| Error | `base64: invalid input`; `gzip: stdin: unexpected end of file` |

A SHA-256 of the exact payload bytes was **not computed** in 1A. The Git blob SHA and byte size above are the preserved immutable identifiers; no SHA-256 is invented.

The failed payload remains available in Git history at START_HEAD. It is intentionally absent from SOURCE_COMMIT. The failed workflow is likewise retained in history but absent from SOURCE_COMMIT.

## Recovery provenance table

| Path / logical change | Confirmed source | State at START_HEAD | 1A decision | Status |
|---|---|---|---|---|
| Existing Block 01 application candidate, including `pablicus/app-controller.js`, `pablicus/chat-list-view.js`, `pablicus/bots-nav.js` and the other application changes already committed before `fbe4ac2...` | ordinary Git source at `fbe4ac2a03c03b15404ac99d54d51ed15e3f13be`; independent failure review confirms later pre-cleanup commits changed only transport/bootstrap | already present | preserve byte-for-byte; do not reapply | `ALREADY_PRESENT` |
| `pablicus/app-controller.js` | Git blob `bd8d48338ee9376f9fd10730f344d2f8c5346653` at both `fbe4ac2...` and SOURCE_COMMIT | present | no write | `ALREADY_PRESENT` |
| `pablicus/chat-list-view.js` | Git blob `2698bc203b237d7662f8b0ace727fb2096d9e5e5` at SOURCE_COMMIT | present | no write | `ALREADY_PRESENT` |
| `pablicus/bots-nav.js` | Git blob `efb648ca4b6bfeac4b7b61d25fe89219a25db378` at SOURCE_COMMIT | present | no write | `ALREADY_PRESENT` |
| `tests/engineering/block-01/test_block01.py` | Git blob `d42961bd29621ee9217f92468de809d5e0fb84df` at SOURCE_COMMIT | present | no write; weaknesses remain for later substeps | `ALREADY_PRESENT` |
| `.github/workflows/pablicus-foundation.yml` | Git blob `09fe0e8203b08fd665f310f433bcac5ab8355e21` at SOURCE_COMMIT | present | keep as read-only verification workflow | `ALREADY_PRESENT` |
| `.engineering/block01.patch.gz.b64` | blob `eca708109f00b4dcd3da7bb194f9a0c541ef6f85`, 20208 bytes | present and invalid for intended pipeline | preserve in history, remove from current tree | `OUT_OF_SCOPE` transport removed |
| `.github/workflows/block01-apply.yml` | blob `a4c078d1054952f302cfe8cdcbc5ad13eedfdbc0` | present | preserve in history, remove from current tree | `OUT_OF_SCOPE` bootstrap removed |
| Additional intended plaintext delta represented only by the failed packed payload | no complete plaintext source found in surviving working files, repository history inspected for this work, CI artifact metadata, conversation files, or Library search | not applied | do not infer, reconstruct, or partially apply lost bytes | `NOT_RECOVERED` |
| Controller race/lifecycle corrections R1–R4 identified by independent review | independent review diagnostics | not resolved by 1A | leave unchanged for 1B | `OUT_OF_SCOPE` |
| Stronger integrated acceptance / positive-negative controls | independent review findings | old suite remains insufficient | leave unchanged for 1C | `OUT_OF_SCOPE` |

No application bytes were newly written during 1A. There was no complete `RECOVERABLE` source delta that was both missing from the branch and safe to copy verbatim.

## What 1A removed from the current tree

Commit `28ed3fde33f0e5a0a28b1fa12f147de465accf6a` removed only:

- `.engineering/block01.patch.gz.b64`
- `.github/workflows/block01-apply.yml`

Direct reads at SOURCE_COMMIT return `404` for both paths. Their historical commits/blobs remain available for review.

The older `.github/workflows/block01-apply-candidate.yml` had already been removed in commit `39000712ace0809e1dd005dc5d27dc510620c7dd`; 1A did not restore it.

## Minimal integrity checks

| Check | Result | Evidence / boundary |
|---|---|---|
| Read current branch and production heads | `PASS` | START_HEAD recorded; current source cleanup commit `28ed3fde...`; `main` observed unchanged at `f348ace...` |
| Preserve exact failure provenance | `PASS` | payload blob `eca708...`, 20208 bytes; workflow blob `a4c078...`; run/job `34564691620` / `103154288315`; exit 1 and exact decode/decompress errors |
| Existing candidate survives cleanup | `PASS` | `pablicus/app-controller.js` has identical blob `bd8d483...` at tested `fbe4ac2...` and SOURCE_COMMIT; compare/review establishes later changes are transport/bootstrap only |
| Packed bootstrap absent from current tree | `PASS` | both bootstrap paths return 404 at SOURCE_COMMIT |
| Ordinary verification workflow remains directly readable | `PASS` | `.github/workflows/pablicus-foundation.yml`, blob `09fe0e8...`, `contents: read` and no code-writing/deploy step |
| Old candidate evidence remains identifiable | `PASS` as provenance only | run `34563633361`, artifact `10185261699`, artifact digest `sha256:b63a504a7aa1b0e8714e30bc4cd3589a5ca6206d071d284cc6ba4b56d690988c`; this is not Block 01 acceptance |
| Syntax check of executable files newly restored in 1A | `NOT_RUN` | 1A restored no executable source file; runtime candidate bytes were not modified in this substep |
| `git diff --check` for 1A docs/runtime | `NOT_RUN` for a local checkout | no writable local repository checkout was available; GitHub diffs and post-commit reads are used for the handoff |

## Why status remains BLOCKED

The transparent Git candidate that actually exists is now unambiguous: the preserved source candidate plus bootstrap cleanup at SOURCE_COMMIT. However, the failed payload was explicitly staged as an **additional** candidate patch and no full plaintext source for that additional delta was recovered. Because 1A rules prohibit guessing missing bytes, it is not possible to prove that every intended post-`fbe4ac2...` source change has been recovered.

Therefore Substep 1A is `SUBSTEP_1A_BLOCKED`, not `READY_FOR_REVIEW` as a completed recovery. The preserved candidate is suitable for independent inspection and for deciding whether the unrecovered delta should be abandoned or supplied from an authoritative source.

## Remaining work — not performed in 1A

### 1B
- Add independent failing scenarios for controller race/lifecycle defects R1–R4.
- Correct transition latest-wins semantics, cleanup normalization, cancellation/session changes, and contracts only after review authorization.

### 1C
- Strengthen integrated real-module/browser tests and positive/negative controls.
- Validate lifecycle resource counts, actual storage/outbox behavior, account-switch races, and real entrypoint routes on synthetic data.

No 1B or 1C code change is included here.

## Rollback of 1A only

1A made no data, Auth, Supabase, RLS, PWA identity, or production change. To reverse only the current-tree cleanup, revert commit `28ed3fde33f0e5a0a28b1fa12f147de465accf6a`; this would restore the failed packed payload and self-applying workflow from history and is **not recommended for execution**. The handoff-document commit can be reverted independently without changing application source.

Production was not published by this substep.

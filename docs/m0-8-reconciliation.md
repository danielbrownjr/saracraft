# M0.8 source reconciliation

## Source identity and scope

The implementation branch starts at reviewed M0.7 head `4cdaba24fc590921b7453658705deba299207c2f` from draft PR [#5](https://github.com/danielbrownjr/saracraft/pull/5). Its reviewed navigation safety implementation and regression suite remain the baseline; the historical recovery does not supersede them.

Recovery source: Techbenders personal Drive, `Projects / saracraft`, [SaraCraft-M0.8-source-recovery-2026-11-22.zip](https://drive.google.com/file/d/1AHe0Im3bZsc5pKEXIUanU6vM_OOh95F_/view). The actual downloaded ZIP was checked before extraction: SHA-256 `5c23c9c4e062a58167a2ad93bed8ececb309c75fa63666438f2f68a4a9988cee`. Extraction inspected member paths and file sizes. It contains exactly 16 regular files: 12 source, test and dependency files plus four recovery documents. `sha256sum -c SHA256SUMS` verified all 12 payload entries. The immutable recovered copies remain outside the development repository.

The original source had no Git metadata and originated at `/home/sara/saracraft-first-login/controller`. Recovery establishes file identity; it does not establish that the exact recovered revision produced the recorded historical gameplay outcomes. Recovered source was inspected as historical evidence before selective integration, and its launcher was never executed.

`SOURCE-INVENTORY.tsv` reports three original files matching M0.7, seven differing and two absent. Sanitized copies have the same comparison counts. Nine copied files preserve original bytes; `connection/main.js`, `connection/connection.js` and `connection/movement.test.js` replace private configuration literals with documentation fixtures. Those fixtures are not runtime defaults.

## File-by-file decisions

All paths in the first column are relative to `controller/` unless marked as recovery documents.

| Recovered file | M0.7 comparison | Reconciliation decision |
| --- | --- | --- |
| `package.json` | Matches | Retain the baseline dependency-free controller manifest. |
| `src/controller.js` | Differs | Merge the come-here lifecycle selectively; implement bounded deadline, halt and STOP settlement corrections with regression coverage. Preserve command admission and first terminal reason. |
| `src/bridge.js` | Matches | Retain the baseline trusted-envelope boundary; name-only chat remains insufficient. |
| `src/commands.js` | Differs | Import only deterministic come-here aliases and supported command kind while retaining strict UUID/envelope and gather validation. |
| `test/controller.test.js` | Matches | Preserve baseline tests and extend for C1/C2, bounded waits and cancellation races. |
| `connection/main.js` | Differs | Selectively integrate explicit walk-mode setup and signed-chat certificate handling. Require a validated external commander UUID for movement before accessing authentication paths; never import the sanitized commander as a default. Preserve baseline identity/target pins. Do not execute the launcher during offline verification. |
| `connection/connection.js` | Differs | Selectively integrate bounded interactive-session support and closing halt. Preserve baseline identity/target pins and connection lifecycle behavior instead of importing sanitized placeholders. The commander comes from explicit validated movement configuration in the launcher. |
| `connection/movement.js` | Absent | Import the adapter's command admission, replay, follow/come-here, replacement and bounded-radius structure. Integrate the reviewed per-task safety monitor and guarded Mineflayer actuation. Replace unsupported safety assumptions and stuck-jump recovery with fail-closed handling. |
| `connection/connection.test.js` | Differs | Retain M0.7 heartbeat-tolerant lifecycle event ordering; the recovered strict event list is older. Extend tests for scoped session/configuration behavior. |
| `connection/movement.test.js` | Absent | Retain useful recovered admission and water-recognition fixtures; extend mock-client/world tests for safety integration and lifecycle races. Change STOP messaging to distinguish acknowledgement from observed movement cessation. |
| `connection/package.json` | Differs | Import the exact recovered manifest: only functional dependency addition is `mineflayer-pathfinder` pinned at `2.4.5`; existing pins unchanged. |
| `connection/package-lock.json` | Differs | Import the exact recovered lock. Every existing package record is identical to M0.7; only pathfinder's package record and root dependency entry are added. Preserve integrity/resolution fields. |
| `SOURCE-INVENTORY.tsv` (recovery document) | No repository counterpart | Retain in the original recovery archive as provenance. Use its original/copied identity and sanitization record; do not substitute it for direct source comparison. |
| `SHA256SUMS` (recovery document) | No repository counterpart | Verify all 12 recovered payload files before integration; retain in the original archive. Its hashes describe recovery inputs, not subsequently edited implementation files. |
| `LAUNCHER-SANITIZED.md` (recovery document) | Historical README omitted | Use as launcher/development evidence; do not adopt its documentation-only endpoint or identities as defaults. Retain the original document in the archive. |
| `PROVENANCE.md` (recovery document) | No repository counterpart | Preserve source origin, sanitization and historical-evidence limitations in this reconciliation and engineering report; retain the original archive. |

The reviewed `navigation/safety.js`, its R1 exception handling, R2 actuation contract and `navigation/safety.test.js` are not recovered files and must not be overwritten. Controller, command, connection and admission improvements are retained through selective merges.

## Input hashes

These are SHA-256 values, computed directly from the exact baseline Git blobs and downloaded recovery bytes. Recovery paths below are relative to the archive root; prefix `controller/` for baseline repository paths.

| Archive path | M0.7 SHA-256 | Recovered SHA-256 |
| --- | --- | --- |
| `package.json` | `4c9630e10bb2059c36096d9760d2d97f27a51c196c9705dff8cc028ba4062408` | `4c9630e10bb2059c36096d9760d2d97f27a51c196c9705dff8cc028ba4062408` |
| `src/controller.js` | `5d018cc485953fa3ad2510b893574dca396752e864e8881af1c546d11d861692` | `fb92bbd408b2222102d6a77a3f3c31372fec431e2acb34d7b096467aeb8aa511` |
| `src/bridge.js` | `86c6df06601b6c3dd7d1681ad50a6b1cea03df59f5e1eedf50b67f8f23d42337` | `86c6df06601b6c3dd7d1681ad50a6b1cea03df59f5e1eedf50b67f8f23d42337` |
| `src/commands.js` | `dc7636e571a3958d113a395d5d99910e940be458f5e2b47034ef992cdf97e631` | `b9659ca5d463606511305bb1d7174da4c3a5dd774065c3e32f8c763cad17ccc4` |
| `test/controller.test.js` | `ceb957f994d0e07d8a4fceca94ee3e323e43d41d9c106f6e3ecf77b024516687` | `ceb957f994d0e07d8a4fceca94ee3e323e43d41d9c106f6e3ecf77b024516687` |
| `connection/main.js` | `c6c12067a1c4cf644b4b506df7570e1d36bde856035de350c0ba335b1a6d593c` | `430902be86506886dba89108220fadc3fb3f6c732ef6d53d3d66e0f0aceac600` |
| `connection/connection.js` | `5ffa65474e2201bc64100de9ba74b1f7b183a29bc20f43b5b677c2fcd30782fe` | `27f3364a506bc647141e8641852a406d0ad7be635fcb4e7452e07bf4adaa86f7` |
| `connection/movement.js` | `absent` | `bdb239ceb8c416dbf35a5d485f0eae98278531dc01037906c3a75d8613fe8f14` |
| `connection/connection.test.js` | `0676c6d3250a1bb7959c7389d82a369c412a39f08049177c17e0def63e2aad3c` | `7a3d420d3a9b63da893179d944f31255ddf4b36e1c700567b7f4f0eb42c356c0` |
| `connection/movement.test.js` | `absent` | `35f6214870b7113ce786ae6de96fded16b5415d95781ecc9d913691965c81718` |
| `connection/package.json` | `6bb127d1cfa98075c0774c415ae2dd25d23a786cf02a8dc7c529d45c2179a9a4` | `a64971600ef29f50574908321a5b5413b602e6f2002d011eeb328bd39337551c` |
| `connection/package-lock.json` | `4ed23a2da849dfe78d8a6086102d98f7d699598b6a9a5b9a93a3dad03c6cf54e` | `2810d61db621928afd6ddba7262a404770b35bf3c53383b44e8af87b1dc8eec7` |
| `SOURCE-INVENTORY.tsv` | No counterpart | `02a4fab5ba8c2aa6954accd5ee287381cd9ae408e542e22c9ba891f7a7fe0b78` |
| `SHA256SUMS` | No counterpart | `5400db72fa49285a54be28a2aa12892f10d6ca5d8614c7882032c355419bcbc0` |
| `LAUNCHER-SANITIZED.md` | No counterpart | `a73176f4006110077664b9ff3d5e447bee4ef316ae193e3ac08ed64a08cf48ba` |
| `PROVENANCE.md` | No counterpart | `e1d1901b06519029f2ec758bb5a2f97fa27bfa158085ad2352e7e002fdd2b77c` |

## Dependencies and isolated installation

The recovered manifest and lock retain Mineflayer `4.39.0`, mineflayer-pathfinder `2.4.5`, prismarine-auth `3.1.1`, minecraft-protocol `1.68.0`, minecraft-data `3.119.0`, prismarine-physics `1.11.1` and vec3 `0.1.10`. No unrelated dependency was upgraded to suppress warnings.

The shell initially exposed Node `24.22.3` and npm `11.19.1`. Offline verification instead uses a workspace-local official Node `22.23.5` distribution with bundled npm `10.9.9`. The `node-v22.23.5-linux-x64.tar.xz` archive SHA-256 `cdeb8670a0c81f51b4dc4ac61919f9b1ad917b304bf8221eb939570663d240f8` was checked against the official `https://nodejs.org/dist/v22.23.5/SHASUMS256.txt` before extraction. No system runtime was changed.

Installation command from `controller/connection`:

```sh
export PATH=/workspace/toolchains/node-v22.23.5-linux-x64/bin:$PATH
npm ci --ignore-scripts --no-audit --no-fund
```

Result: 92 packages installed, lifecycle scripts disabled, exit 0. Both manifest and lock retained their recovered hashes after installation. npm warned that transitive `uuid@8.3.2` and `uuid@10.0.0` are deprecated and printed an npm-major-update notice. The dependency tree was not modified to hide those warnings. This installation performs no Minecraft login or bot connection; test execution is recorded separately in the engineering report.

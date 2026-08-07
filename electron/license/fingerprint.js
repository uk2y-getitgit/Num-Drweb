/* electron/license/fingerprint.js — 기기 지문 생성
   - 1순위: Windows 레지스트리 MachineGuid (재설치·부품교체에 강함)
   - 2순위: hostname + CPU 모델 + 총 메모리(GB) + 아키텍처
   - 두 경우 모두 고정 salt HMAC-SHA256 → hex 64자
     원본 값(레지스트리 GUID·호스트명)은 서버로 나가지 않는다.
   - 개인정보(사용자명·이메일·파일경로)는 포함하지 않는다.
   - 메인보드/디스크 시리얼은 쓰지 않는다 — 포맷·부품교체 시 정품이 풀린다.
*/
'use strict';

const crypto = require('crypto');
const os     = require('os');
const fs     = require('fs');
const path   = require('path');
const { execFileSync } = require('child_process');

const SALT = 'NumDraw/device-fingerprint/v1';

let _cache = null;

/* reg.exe 절대경로 확정.
   Windows 실행파일 탐색은 CWD 를 System32 보다 먼저 본다 → 'reg' 만 넘기면
   공격자가 놓아둔 폴더에서 앱을 실행했을 때 그 폴더의 reg.exe 가 메인 프로세스 권한으로 돈다.
   경로를 고정하고, 실제로 존재하는 파일일 때만 실행한다(없으면 폴백 지문으로 간다). */
let _regExe;   // undefined = 아직 찾지 않음, null = 없음
function _regExePath() {
  if (_regExe !== undefined) return _regExe;
  _regExe = _findRegExe();
  return _regExe;
}

function _findRegExe() {
  const roots = [process.env.SystemRoot, process.env.windir, 'C:\\Windows'];
  for (const root of roots) {
    if (typeof root !== 'string' || !root.trim()) continue;
    /* 환경변수가 오염돼 상대경로를 가리키면 무시한다 */
    if (!path.isAbsolute(root)) continue;
    const exe = path.join(root, 'System32', 'reg.exe');
    try {
      if (fs.statSync(exe).isFile()) return exe;
    } catch { /* 다음 후보 */ }
  }
  return null;
}

/* Windows 레지스트리에서 MachineGuid 조회 (실패하면 null) */
function _machineGuid() {
  if (process.platform !== 'win32') return null;
  const regExe = _regExePath();
  if (!regExe) return null;
  /* 32비트 프로세스에서도 64비트 뷰를 보도록 /reg:64 지정 */
  for (const view of ['/reg:64', '/reg:32']) {
    try {
      const out = execFileSync(
        regExe,
        ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', view],
        { encoding: 'utf8', windowsHide: true, timeout: 5000 }
      );
      const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9A-Fa-f-]{30,})/);
      if (m) return m[1].trim().toLowerCase();
    } catch { /* 다음 뷰 시도 */ }
  }
  return null;
}

/* 폴백 원본 — 메모리는 GB 단위로 반올림해 예약 메모리 변동에 흔들리지 않게 한다 */
function _fallbackSource() {
  const cpus  = os.cpus();
  const model = (cpus && cpus.length ? cpus[0].model : 'unknown-cpu').trim().replace(/\s+/g, ' ');
  const memGB = Math.round(os.totalmem() / (1024 * 1024 * 1024));
  return ['fallback', os.hostname(), model, String(memGB), os.arch()].join('|');
}

/* 지문 hex 64자 반환 */
function get() {
  if (_cache) return _cache;
  const guid = _machineGuid();
  const src  = guid ? ('machineguid|' + guid) : _fallbackSource();
  _cache = crypto.createHmac('sha256', SALT).update(src, 'utf8').digest('hex');
  return _cache;
}

/* 어떤 소스를 썼는지 (디버깅·지원 문의용 — 원본 값은 노출하지 않는다) */
function getSourceKind() {
  return _machineGuid() ? 'machineguid' : 'fallback';
}

module.exports = { get, getSourceKind };

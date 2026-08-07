-- NumDraw 활성화 서버 D1 스키마
-- 유료화_Phase1_구현계획.md 6장 그대로.
-- 적용: wrangler d1 execute numdraw-license --local --file=schema.sql (로컬)
--       wrangler d1 execute numdraw-license --remote --file=schema.sql (실서비스, 최초 1회)

CREATE TABLE licenses (
  key_hash    TEXT PRIMARY KEY,              -- sha256(정규화 키). 평문 키는 저장하지 않음
  key_masked  TEXT NOT NULL,                 -- 'ND2-A7K3M-****-****-9QX2' 운영자 식별용
  buyer_name  TEXT,
  buyer_email TEXT,
  memo        TEXT,                          -- 입금일·금액 등 운영 메모
  max_seats   INTEGER NOT NULL DEFAULT 2,
  status      TEXT NOT NULL DEFAULT 'active',-- active | revoked
  issued_at   TEXT NOT NULL
);

CREATE TABLE activations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash     TEXT NOT NULL,
  device_hash  TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  released_at  TEXT                           -- 좌석 반납(PC 교체) 시각
);

-- 부분 유니크 인덱스: "현재 활성 상태(released_at IS NULL)"인 행에 대해서만
-- (key_hash, device_hash) 중복을 막는다. 반납된(released_at IS NOT NULL) 이력 행은
-- 얼마든지 쌓일 수 있어야 같은 기기가 반납 후 재활성화될 때 UNIQUE 위반이 나지 않는다.
-- (예전 버전은 released_at 조건 없는 전체 UNIQUE(key_hash, device_hash)였음 —
--  반납 후 같은 기기 재활성화 시 500 오류로 영구 차단되는 버그가 있었다. H-2 수정.)
CREATE UNIQUE INDEX idx_activations_active_device
  ON activations(key_hash, device_hash)
  WHERE released_at IS NULL;

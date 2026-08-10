/* server/test/d1-adapter.mjs — Node 내장 node:sqlite 위에 D1 API를 흉내 내는 얇은 어댑터
 *
 * 왜 있는가:
 *   이 프로젝트를 만든 Windows 환경에서 `wrangler dev`(workerd)가 access violation으로
 *   기동하지 않는다 (server/README.md 9장). 그래서 라우트 코드를 **한 글자도 고치지 않고**
 *   Node에서 그대로 돌리기 위해 env.DB 자리에 끼울 D1 호환 객체를 만든다.
 *
 * 지원 범위 — 라우트가 실제로 쓰는 것만:
 *   db.prepare(sql).bind(...).first() / .all() / .run()
 *   run() 결과의 meta.changes  ← H-1(원자적 조건부 INSERT) 판정에 쓰인다
 *
 * ── 동시성 재현에 관한 중요한 주의 ──
 *   node:sqlite는 동기 API다. 어댑터 메서드를 단순히 async로만 감싸면 await가 전부
 *   마이크로태스크로 즉시 풀려서, 한 요청이 DB 호출 여러 개를 **한 번도 양보하지 않고**
 *   연달아 끝내버린다. 그 상태에서는 "COUNT → 판정 → INSERT" 3왕복짜리 구버전 코드조차
 *   경쟁 조건이 재현되지 않는다 — 실제로 확인했다(구버전을 넣어도 테스트가 통과했다).
 *
 *   그래서 매 DB 호출 앞에 setImmediate로 **매크로태스크 경계**를 강제로 넣는다.
 *   그러면 Promise.all로 띄운 요청들이 DB 호출 단위로 반드시 인터리빙되고,
 *   여러 왕복에 걸친 판정은 깨지지만 단일 SQL 문은 원자적으로 유지된다
 *   (= 실제 D1/SQLite의 단일 writer 의미와 같다).
 *
 *   이건 현실보다 **더 가혹한** 스케줄러다. 여기서 통과한다고 실환경 동시성이 증명되는 것은
 *   아니지만, 여기서 깨지는 코드는 실환경에서도 반드시 깨진다. 배포 후 실환경 재검증은
 *   여전히 필요하다 (server/README.md 9장).
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const yieldToOtherRequests = () => new Promise((r) => setImmediate(r));

class D1Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  #stmt() {
    return this.db.prepare(this.sql);
  }

  async first() {
    await yieldToOtherRequests();
    const row = this.#stmt().get(...this.args);
    return row === undefined ? null : row; // D1은 없으면 null
  }

  async all() {
    await yieldToOtherRequests();
    return { results: this.#stmt().all(...this.args), success: true };
  }

  async run() {
    await yieldToOtherRequests();
    const r = this.#stmt().run(...this.args);
    return {
      success: true,
      meta: {
        changes: Number(r.changes ?? 0),
        last_row_id: Number(r.lastInsertRowid ?? 0),
      },
    };
  }
}

export class D1Database {
  constructor(schemaPath) {
    this.db = new DatabaseSync(':memory:');
    if (schemaPath) this.db.exec(readFileSync(schemaPath, 'utf8'));
  }

  prepare(sql) {
    return new D1Statement(this.db, sql);
  }

  /* 테스트에서 DB 상태를 직접 들여다볼 때 쓴다 (라우트 코드는 쓰지 않음) */
  query(sql, ...args) {
    return this.db.prepare(sql).all(...args);
  }

  close() {
    this.db.close();
  }
}

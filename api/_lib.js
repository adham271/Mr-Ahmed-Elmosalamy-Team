const { Client } = require("@notionhq/client");
const notion = new Client({ auth: process.env.NOTION_TOKEN });

// Database IDs (taken from your Notion export). Can be overridden with env vars.
const ID = {
  students: process.env.NOTION_STUDENTS_DB_ID || "ab0e8ddbd534834b877101cbb717e54f",
  quizG: process.env.NOTION_QUIZ_G_DB_ID || "64fe8ddbd534828f94db814dbb80e085",
  hwG: process.env.NOTION_HW_G_DB_ID || "bade8ddbd5348223b4a981bfa5154e6c",
  quizzes: process.env.NOTION_QUIZ_DB_ID || "693e8ddbd53482fca2cb018ca5fe8830",
  homework: process.env.NOTION_HW_DB_ID || "a6de8ddbd534825db6e3815b7e108693"
};
const LB_QUIZ = process.env.LEADERBOARD_QUIZ || "Quiz 1";

function val(p) {
  if (!p) return "";
  const j = a => (a || []).map(t => t.plain_text).join("");
  switch (p.type) {
    case "title": return j(p.title);
    case "rich_text": return j(p.rich_text);
    case "number": return p.number !== null ? String(p.number) : "";
    case "select": return p.select?.name || "";
    case "status": return p.status?.name || "";
    case "phone_number": return p.phone_number || "";
    case "formula": {
      const f = p.formula;
      return f.type === "string" ? f.string || "" : f.type === "number" && f.number !== null ? String(f.number) : "";
    }
    case "rollup": {
      const r = p.rollup;
      if (r.type === "number") return r.number !== null ? String(r.number) : "";
      if (r.type === "array") return r.array.map(val).filter(Boolean).join(", ");
      return "";
    }
    default: return "";
  }
}
const num = s => { const n = parseFloat(s); return isNaN(n) ? null : n; };
const digits = s => String(s || "").replace(/\D/g, "");
const titleOf = props => val(Object.values(props).find(p => p.type === "title"));
const relId = p => p?.relation?.[0]?.id || null;

async function all(db) {
  const out = [];
  let cursor;
  do {
    const r = await notion.databases.query({ database_id: db, start_cursor: cursor, page_size: 100 });
    out.push(...r.results);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return out;
}

let cache = null;
async function load() {
  if (cache && Date.now() - cache.t < 120000) return cache.d;
  const [st, qg, hg, qs, hs] = await Promise.all([
    all(ID.students), all(ID.quizG), all(ID.hwG), all(ID.quizzes), all(ID.homework)
  ]);
  const students = new Map(st.map(p => {
    const pr = p.properties;
    return [p.id, {
      id: p.id,
      name: titleOf(pr),
      code: val(pr["Code"]).trim().toUpperCase(),
      school: val(pr["School"]),
      pin: val(pr["PIN"]).trim(),
      phones: [val(pr["P1 Phone"]), val(pr["P2 Phone"])].map(digits).filter(d => d.length >= 8)
    }];
  }));
  const types = pages => new Map(pages.map(p => [p.id, { id: p.id, title: titleOf(p.properties).trim(), full: num(val(p.properties["Mark"])) }]));
  const rows = pages => pages.map(p => ({
    student: relId(p.properties["Student"]), type: relId(p.properties["Type"]),
    s: num(val(p.properties["S Mark"])), f: num(val(p.properties["F Mark"])),
    status: val(p.properties["Status"]), note: val(p.properties["Note"]), created: p.created_time
  }));
  const d = { students, quizTypes: types(qs), hwTypes: types(hs), qRows: rows(qg), hRows: rows(hg) };
  cache = { t: Date.now(), d };
  return d;
}

const isTeacher = req => !!process.env.TEACHER_PASSWORD && req.headers["x-teacher-password"] === process.env.TEACHER_PASSWORD;
const pinOf = s => s.pin || (s.phones[0] ? s.phones[0].slice(-4) : "");

function report(d, st) {
  const mk = (rows, types) => rows.filter(r => r.student === st.id).map(r => {
    const t = types.get(r.type);
    const f = r.f ?? t?.full ?? null;
    return { typeId: r.type, title: t?.title || "Assessment", s: r.s, f, status: r.status, note: r.note, created: r.created,
      pct: r.s !== null && f > 0 ? Math.round((r.s / f) * 100) : null };
  });
  const quizzes = mk(d.qRows, d.quizTypes).sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
  const homework = mk(d.hRows, d.hwTypes).sort((a, b) => a.created.localeCompare(b.created));
  const missing = (types, got) => [...types.values()].filter(t => t.full !== null && !got.some(g => g.typeId === t.id))
    .map(t => t.title).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return {
    student: { name: st.name, code: st.code, school: st.school },
    quizzes, homework,
    missing: { quizzes: missing(d.quizTypes, quizzes), homework: missing(d.hwTypes, homework) }
  };
}

function leaderboard(d, teacher) {
  return d.qRows
    .filter(r => d.quizTypes.get(r.type)?.title === LB_QUIZ && r.s !== null && r.f > 0 && d.students.get(r.student))
    .map(r => { const s = d.students.get(r.student); return { code: s.code, school: s.school, pct: Math.round((r.s / r.f) * 100) }; })
    .sort((a, b) => b.pct - a.pct).slice(0, 10)
    .map(x => ({ ...x, code: teacher ? x.code : x.code.slice(0, 2) + "•••" }));
}

module.exports = { load, report, leaderboard, isTeacher, pinOf };

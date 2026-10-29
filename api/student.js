const L = require("./_lib");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const code = String(req.query.code || "").trim().toUpperCase();
  const pin = String(req.query.pin || "").trim();
  if (!code) return res.status(400).json({ error: "Missing student code." });
  try {
    const d = await L.load();
    const st = [...d.students.values()].find(s => s.code === code);
    const teacher = L.isTeacher(req);
    const real = st ? L.pinOf(st) : "";
    if (!st || (!teacher && (!real || pin !== real))) {
      return res.status(404).json({ error: "Student not found, or the PIN is incorrect." });
    }
    const out = L.report(d, st);
    if (teacher) out.phone = st.phones[0] || "";
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: "Failed to fetch data from Notion." });
  }
};

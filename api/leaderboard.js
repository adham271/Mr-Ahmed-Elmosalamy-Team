const L = require("./_lib");

module.exports = async (req, res) => {
  const teacher = L.isTeacher(req);
  if (req.headers["x-teacher-password"] && !teacher) return res.status(401).json({ error: "Wrong password." });
  res.setHeader("Cache-Control", teacher ? "no-store" : "s-maxage=300, stale-while-revalidate=600");
  try {
    return res.status(200).json({ top: L.leaderboard(await L.load(), teacher) });
  } catch (e) {
    return res.status(500).json({ error: "Failed to fetch data from Notion." });
  }
};

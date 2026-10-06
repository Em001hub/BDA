export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  res.status(200).json({ status: "ok", data_mode: "real_mumbai_only", processing_engine: "R + Apache Spark" });
}

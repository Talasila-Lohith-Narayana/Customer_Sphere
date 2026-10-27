export function getChurnRiskLevel(probability) {
  if (probability == null || probability === "") return null;
  const score = Number(probability);
  if (!Number.isFinite(score) || score < 0 || score > 1) return null;
  if (score >= 0.7) return "high";
  if (score >= 0.3) return "medium";
  return "low";
}

export function getChurnRiskLabel(probability) {
  const level = getChurnRiskLevel(probability);
  if (level === "high") return "High Risk";
  if (level === "medium") return "Medium Risk";
  if (level === "low") return "Low Risk";
  return "Unavailable";
}

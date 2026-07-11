const POSITIVE = new Set(
  "amazing awesome best beautiful brilliant enjoyable excellent fun great love loved masterpiece polished recommend solid stunning wonderful".split(
    " ",
  ),
);
const NEGATIVE = new Set(
  "awful bad boring broken bug bugs crash crashes disappointing hate hated lag poorly refund shit terrible trash unplayable worst".split(
    " ",
  ),
);

export function lexiconSentiment(text: string) {
  const tokens = text.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/);
  let pos = 0;
  let neg = 0;
  for (const t of tokens) {
    if (POSITIVE.has(t)) pos += 1;
    if (NEGATIVE.has(t)) neg += 1;
  }
  const score = pos - neg;
  const label =
    score > 0 ? "positive" : score < 0 ? "negative" : "neutral";
  return { score, pos, neg, label };
}

// This code returns a score indicating how bad the inference algorithm is.
// The lower the score, the better the inference quality.

const evaluate = async (
  text: string,
  inference: (request: string[]) => string[],
): number => {
  const segmenter = new Intl.Segmenter("en", { granularity: "word" });
  const parts = [...segmenter.segment(text)].map((x) => x.segment);
};

// This code returns a score indicating how bad the inference algorithm is.
// The lower the score, the better the inference quality.

const evaluate = async (
  text: string,
  inference: (request: string[]) => string[],
): number => {};

---
qid: Q812535
title: Bayesian inference
url: https://en.wikipedia.org/wiki/Bayesian_inference
state: shaky
first_probed: 2026-08-03
last_probed: 2026-08-03
sessions: 1
source_revid: 1364298666
prerequisites: [Q21045424, Q182505, Q4165283, Q842217, Q17100952, Q1988242, Q4874474, Q245652, Q812534, Q4874481, Q4894580, Q715108, Q3711784, Q1054106, Q4439221, Q5187655, Q177571, Q5374241, Q55643021, Q115806048, Q45284, Q13200161, Q6760420, Q1191869, Q745328, Q635384, Q17148751, Q7234227, Q278079, Q1661371, Q1417473, Q278090, Q195771, Q938438, Q12483, Q7915794]
adjacent: [Q6760420, Q45284, Q7234227, Q1192065, Q3711784, Q1188504, Q5051810, Q4894580, Q5280766, Q1275153, Q4874474, Q4704939]
---

No article text was shown at any point in this session. Every judgement below is on
unaided output.

## Can explain unaided

- Stated the core purpose correctly and without prompting, in free recall before any
  exposure: "when you have more information about an event, it can lead to updating the
  probability of the outcome."
  Matches: "a method of statistical inference in which Bayes' theorem is used to calculate
  a probability of a hypothesis, given prior evidence, and update it as more information
  becomes available" — `cache/wikipedia/Q812535.md` (revid 1364298666)  (2026-08-03)
- **Did not fall into base-rate neglect.** On a 1%-prevalence / 9%-false-positive test
  problem, concluded unaided that a positive result meant "very low chance you have it."
  This is the canonical failure mode of the problem and he avoided it. The qualitative
  read was right even while the arithmetic was wrong — worth noting, because it means the
  intuition is ahead of the machinery.  (2026-08-03)
- Ran a falsification test on his own formula once handed the test case, and accepted the
  result rather than patching again: "P(B) = the same then so 0.8, so in this case I guess
  it's not right."  (2026-08-03)

## Gaps

- **Cannot state Bayes' theorem.** Free recall gave "if a given b divided by a and b."
  Asked to write it in symbols, produced `P(A|B) = P(A)/(1-P(A)P(B))` ("or something like
  that"), then patched to `P(A)/(1-P(B))`. Both are inventions; neither has the likelihood
  or the prior in it anywhere.
  Source: "P(H∣E) = P(E∣H)·P(H) / P(E)" — `cache/wikipedia/Q812535.md` (revid 1364298666)  (2026-08-03)

- **No vocabulary for the three parts.** Free recall contained the words *prior*,
  *likelihood* and *posterior* zero times. Everything was phrased as "A" and "B" — generic
  conditional probability, with no distinction between the hypothesis and the evidence.
  Source: "Bayesian inference derives the posterior probability as a consequence of two
  antecedents: a prior probability and a 'likelihood function' derived from a statistical
  model for the observed data." — `cache/wikipedia/Q812535.md` (revid 1364298666)  (2026-08-03)

- **The direction-flip never came up.** The point of the theorem — that it converts
  P(evidence | hypothesis), which you can measure, into P(hypothesis | evidence), which you
  want — was absent from free recall and never surfaced on its own during the worked
  example. His description ("if A happens and we know B has already happened, then we need
  to update") is symmetric in A and B, which is exactly the thing Bayes' theorem is not.
  Source: "The likelihood function is a function of the evidence, E, while the posterior
  probability is a function of the hypothesis, H." — `cache/wikipedia/Q812535.md` (revid 1364298666)  (2026-08-03)

- **Denominator is the specific hole.** Every wrong formula he wrote had something
  invented on the bottom — `1-P(A)P(B)`, then `1-P(B)`. On the worked example he built the
  ratio as `.09/(1-.0098)`, putting the *false-positive* mass in the numerator. The
  denominator is a normalisation over all the ways the evidence could have arisen, and
  that idea was not present.
  Source: "P(E) is sometimes termed the marginal likelihood or 'model evidence'" and
  "P(E)=P(E∣H)P(H)+P(E∣¬H)P(¬H)" — `cache/wikipedia/Q812535.md` (revid 1364298666)  (2026-08-03)

- **Got there only on rails.** The correct answer (~10%) came after being given the
  "take 10,000 people" framing *and* having both of his counts corrected (891 not 990;
  100 not 90). Frequency framing did unlock the right structure — that is a real and useful
  finding about how to teach him this — but the final number is not unaided and is not
  evidence of storage.  (2026-08-03)

- **Misread a stated likelihood.** Told the test is *always* positive given the disease, he
  used 91% for that branch. The 91% is `1 − 0.09`, i.e. the false-positive rate carried over
  from the wrong branch. Suggests the two conditional probabilities were not being held
  apart as separate quantities.  (2026-08-03)

## Confidently wrong

- **"0.8/(1-0.2) = 1"** — stated flat, with an equals sign and no hedge, when the setup was
  B = A and P(A) = 0.8, so P(B) = 0.8 and the expression is 0.8/0.2 = 4. He had substituted
  the complement of P(A) for P(B).
  Note the contrast with the surrounding turns, which were all hedged ("or something like
  that", "I guess"): the confidence appeared precisely at the arithmetic step, not at the
  conceptual ones. Self-corrected immediately when asked "what is P(B)?".  (2026-08-03)

## Open questions raised

- None. Across the whole session he asked no question about the concept. The one
  interrogative — "shouldn't we update it since maybe it's P(A)/(1-P(B))" — was another
  formula guess, not a question about meaning.
- The dominant pattern to probe next time: **he patches symbols rather than reasoning from
  what the quantities mean.** Three successive formulas were produced by adjusting the
  previous one until it looked plausible. Worth testing directly whether he can derive
  rather than recall — the frequency framing worked, so start there.

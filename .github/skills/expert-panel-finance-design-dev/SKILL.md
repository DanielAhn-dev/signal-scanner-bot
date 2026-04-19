---
name: expert-panel-finance-design-dev
description: 'Multi-expert workflow for finance specialist, design specialist, and development specialist collaboration. Use for product strategy, feature planning, risk review, UX direction, and implementation roadmap with trade-off analysis and decision-ready output.'
argument-hint: 'Topic, goal, constraints, and target audience'
user-invocable: true
disable-model-invocation: false
---

# Expert Panel: Finance + Design + Development

## What This Skill Produces
- A decision-ready expert panel brief with three specialist perspectives.
- A reconciled recommendation with trade-offs, risks, and next actions.
- A concrete execution plan that balances business value, UX quality, and engineering feasibility.

## When to Use
- You need cross-functional decisions for product, bot, or feature strategy.
- You need to resolve conflicting priorities across ROI, user experience, and technical complexity.
- You want a structured recommendation instead of fragmented advice.

## Required Inputs
- Topic and objective (what decision must be made).
- Constraints (time, budget, compliance, platform, team capacity).
- Target users and success metrics.
- Known assumptions and unknowns.

## Workflow
1. Define the decision frame.
- Restate the decision in one sentence.
- List constraints, deadline, and non-negotiables.
- Define success criteria and failure conditions.

2. Run finance specialist analysis.
- Evaluate expected value, cost profile, downside risk, and sensitivity drivers.
- Provide at least three scenarios: base, upside, downside.
- Identify risk controls (position sizing, limits, guardrails, fallback plan).

Decision branch:
- If assumptions are weak or data quality is low, mark confidence as low and request minimum additional data before recommending irreversible actions.

3. Run design specialist analysis.
- Translate objective into user journeys, UX priorities, and interaction model.
- Identify usability risks, cognitive load issues, and accessibility constraints.
- Propose a clear UI direction and rationale aligned with user outcomes.

Decision branch:
- If user context is unclear, create two design variants (conservative vs ambitious) and define validation tests.

4. Run development specialist analysis.
- Map solution architecture, implementation options, and technical dependencies.
- Estimate complexity, delivery sequence, and operational risk.
- Specify observability, failure handling, rollback, and test requirements.

Decision branch:
- If delivery risk is high, split into phased rollout (MVP, hardening, scale) with explicit go/no-go gates.

5. Synthesize panel output.
- Build a trade-off matrix (value, UX impact, effort, risk, time-to-impact).
- Reconcile disagreements and present a single recommended path.
- Include one backup option and rejection reasons for discarded options.

6. Produce action plan.
- Week-by-week or milestone-based plan.
- Owners, dependencies, acceptance criteria, and measurable checkpoints.
- Immediate next 3 actions.

## Quality Criteria (Completion Checks)
- All three specialist views are present and non-duplicative.
- Recommendation includes explicit assumptions and confidence level.
- Trade-offs are quantified or clearly ranked.
- Risks include mitigation and trigger thresholds.
- Plan has testable acceptance criteria and rollback considerations.
- Output is concise enough for stakeholder review and specific enough for execution.

## Output Format
Use this section order in the final answer:
1. Decision summary
2. Finance specialist view
3. Design specialist view
4. Development specialist view
5. Trade-off matrix
6. Final recommendation
7. Execution plan and next 3 actions
8. Open risks and required follow-up data

## Example Invocation
- /expert-panel-finance-design-dev Launch recommendation for a new signal scoring feature under 4-week timeline and limited data quality.
- /expert-panel-finance-design-dev Decide whether to prioritize onboarding redesign or strategy accuracy improvements for short-term retention.

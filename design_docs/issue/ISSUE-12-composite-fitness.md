# ISSUE-12：无综合 Fitness 输出

- **设计出处**：工程方案 §13（可形成综合 Fitness，不必过度数学化）
- **严重度**：低
- **状态**：已修复

## 现象

EvaluationResult 输出 taskSuccess/testPassRate/regressionRate/stability 等离散字段，
泛化阈值逐项检查，但没有任何综合适应度数值供排序/选择使用。演化循环需要
"哪个 agent 表现更好"的标量比较时无据可依。

## 修复方案

新增 `src/evaluation/fitness.ts` `computeFitness(evaluation, weights?)`：
默认 0.4·taskSuccess + 0.3·testPassRate + 0.2·stability − 0.4·regressionRate
+ humanAcceptance 加成（accept/4-5 分正向），输出 [0,1] 标量与分项明细，
供演化循环选择繁殖/淘汰对象，同时保留全部原始指标防止刷分。
